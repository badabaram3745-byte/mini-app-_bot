import type { FieldValue, JsonValue } from "@kits/sync";
import {
  opaque,
  opaqueField,
  type OpaqueNode,
  type OpaqueTextRun,
} from "@kits/sync/internal";
import type { JSONContent } from "@tiptap/core";
import { Editor as TiptapEditor, getHTMLFromFragment } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import {
  prosemirrorJSONToYXmlFragment,
  yXmlFragmentToProsemirrorJSON,
} from "@tiptap/y-tiptap";
import { bindOpaque } from "../bindOpaque";
import { editorExtensions } from "./extensions";
import type { EditorOptions } from "./options";
import { plainTextOf } from "./plainText";

/** Creates rich text everyone edits together with the `Editor`: `add({ body: sharedRichText("# Notes") })`. The Markdown is the starting content; `richText(doc, field).setMarkdown()` replaces it later. */
export function sharedRichText(markdown?: string): FieldValue {
  if (markdown !== undefined && typeof markdown !== "string") {
    throw new Error(
      `sharedRichText() expects Markdown to start with, got ${typeof markdown}.`,
    );
  }
  if (!markdown) {
    return opaque("xml", "prosemirror");
  }
  return opaque(
    "xml",
    "prosemirror",
    withEditor({}, (editor) =>
      nodesOf(PMNode.fromJSON(editor.schema, editor.markdown!.parse(markdown))),
    ),
  );
}

function nodesOf(parent: PMNode): OpaqueNode[] {
  const nodes: OpaqueNode[] = [];
  let runs: OpaqueTextRun[] | undefined;
  parent.forEach((child) => {
    if (child.isText) {
      if (!runs) {
        runs = [];
        nodes.push({ text: runs });
      }
      runs.push(runOf(child));
    } else {
      runs = undefined;
      nodes.push(elementOf(child));
    }
  });
  return nodes;
}

function elementOf(node: PMNode): OpaqueNode {
  const attrs: Record<string, JsonValue> = {};
  for (const [name, value] of Object.entries(node.attrs)) {
    if (value !== null) {
      attrs[name] = value as JsonValue;
    }
  }
  return { type: node.type.name, attrs, children: nodesOf(node) };
}

function runOf(node: PMNode): OpaqueTextRun {
  const attributes: Record<string, JsonValue> = {};
  for (const mark of node.marks) {
    attributes[mark.type.name] = mark.attrs as Record<string, JsonValue>;
  }
  return { insert: node.text!, attributes };
}

function withEditor<T>(
  options: Pick<EditorOptions, "extensions">,
  use: (editor: TiptapEditor) => T,
): T {
  const editor = new TiptapEditor({
    element: null,
    extensions: editorExtensions(options),
  });
  try {
    return use(editor);
  } finally {
    editor.destroy();
  }
}

export interface RichText {
  /** Plain text, one line per block; `""` while the field is missing or a plain value. */
  text(): string;
  html(): string;
  markdown(): string;
  /** Replaces the field's content in one write no undo reverts; a no-op while the field is missing or the viewer cannot edit. */
  setMarkdown(markdown: string): void;
}

/** Reads and replaces a `sharedRichText()` field outside render; pass the editor's `extensions` so both use one schema. Throws, naming the kit to use, when another kit's field is there. */
export function richText(
  doc: string,
  field: string,
  options: Pick<EditorOptions, "extensions"> = {},
): RichText {
  const bound = bindOpaque(
    field,
    opaqueField(doc, field, "xml", "prosemirror"),
  );
  const json = (): JSONContent => {
    const { value } = bound;
    return value
      ? (yXmlFragmentToProsemirrorJSON(value) as JSONContent)
      : { type: "doc", content: [] };
  };
  return {
    text: () => (bound.value ? plainTextOf(bound.value) : ""),
    html: () =>
      withEditor(options, (editor) =>
        getHTMLFromFragment(
          PMNode.fromJSON(editor.schema, json()).content,
          editor.schema,
        ),
      ),
    markdown: () =>
      withEditor(options, (editor) => editor.markdown!.serialize(json())),
    setMarkdown: (markdown) =>
      withEditor(options, (editor) => {
        const { value } = bound;
        if (!value || !bound.canEdit) {
          return;
        }
        const content = editor.markdown!.parse(markdown);
        bound.write(() =>
          prosemirrorJSONToYXmlFragment(editor.schema, content, value),
        );
      }),
  };
}
