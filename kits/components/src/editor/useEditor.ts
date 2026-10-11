import { shared } from "@kits/sync";
import { useOpaqueField } from "@kits/sync/internal";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useEditor as useTiptapEditor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { bindOpaque } from "../bindOpaque";
import { warnOnce } from "../warn";
import { editorExtensions, matching } from "./extensions";
import type { EditorOptions, SlashItem } from "./options";
import { adoptEditorStyles } from "./styles";

export interface LocalEditorOptions extends EditorOptions {
  /** Markdown; `onChange` gets Markdown after every edit. */
  value: string;
  onChange: (value: string) => void;
}

/** The editor instance over `value`/`onChange`, to render with `EditorContent`. */
export function useEditor(options: LocalEditorOptions): TiptapEditor {
  const latest = useLatest(options);
  const emitted = useRef(options.value);
  const editor = useTiptapEditor(
    {
      ...instanceOptions(latest),
      extensions: editorExtensions(stableCallbacks(options, latest)),
      content: options.value,
      contentType: "markdown",
      editable: !options.readOnly,
      onUpdate: ({ editor }) => {
        const value = editor.getMarkdown();
        emitted.current = value;
        latest.current.onChange(value);
      },
    },
    signatureOf(options),
  );
  useEffect(() => {
    if (options.value !== emitted.current) {
      emitted.current = options.value;
      editor.commands.setContent(options.value, {
        contentType: "markdown",
        emitUpdate: false,
      });
    }
  }, [editor, options.value]);
  useLayoutEffect(adoptEditorStyles, []);
  useEditable(editor, !options.readOnly);
  return editor;
}

/** The editor instance over a `sharedRichText()` field, to render with `EditorContent`; suspends until shared state has loaded. */
export function useSharedEditor(
  doc: string,
  field: string,
  options: EditorOptions = {},
): TiptapEditor {
  const bound = bindOpaque(
    field,
    useOpaqueField(doc, field, "xml", "prosemirror"),
  );
  const latest = useLatest(options);
  const editable = !options.readOnly && bound.canEdit;
  const editor = useTiptapEditor(
    {
      ...instanceOptions(latest),
      extensions: editorExtensions(stableCallbacks(options, latest), bound),
      editable,
    },
    [bound.value, bound.awareness, ...signatureOf(options)],
  );
  useLayoutEffect(adoptEditorStyles, []);
  useEditable(editor, editable);
  useEffect(() => {
    if (bound.value === undefined && shared.doc(doc).exists) {
      warnOnce(
        `editor:${doc}:${field}`,
        `"${field}" on "${doc}" holds no rich text; write sharedRichText() to it, then change it only through the Editor or richText().setMarkdown().`,
      );
    }
  }, [bound.value, doc, field]);
  return editor;
}

function useLatest<T>(value: T) {
  const latest = useRef(value);
  latest.current = value;
  return latest;
}

const INLINE_RULES = ["bold", "italic", "strike", "code", "underline", "link"];

function instanceOptions(latest: { current: EditorOptions }) {
  return {
    immediatelyRender: true as const,
    autofocus: latest.current.autoFocus ? ("end" as const) : false,
    enableInputRules: latest.current.single ? INLINE_RULES : true,
    onCreate: ({ editor }: { editor: TiptapEditor }) =>
      latest.current.onReady?.(editor),
  };
}

function stableCallbacks<T extends EditorOptions>(
  options: T,
  latest: { current: EditorOptions },
): T {
  const { mentions, slash } = options;
  return {
    ...options,
    onSubmit:
      options.onSubmit &&
      ((editor: TiptapEditor) => latest.current.onSubmit?.(editor)),
    mentions:
      mentions === undefined || mentions === false
        ? mentions
        : (query: string) => {
            const current = latest.current.mentions;
            return typeof current === "function"
              ? current(query)
              : matching(Array.isArray(current) ? current : [], query);
          },
    slash: Array.isArray(slash)
      ? slash.map((item) => ({
          ...item,
          run: (editor: TiptapEditor) =>
            latestSlashItem(latest.current.slash, item.id)?.run(editor),
        }))
      : slash,
  };
}

function latestSlashItem(
  slash: EditorOptions["slash"],
  id: string,
): SlashItem | undefined {
  return Array.isArray(slash)
    ? slash.find((item) => item.id === id)
    : undefined;
}

/** The deps that rebuild the editor. */
function signatureOf(options: EditorOptions): unknown[] {
  return [
    Boolean(options.single),
    options.placeholder,
    JSON.stringify(options.slash ?? null),
    options.mentions === false,
    Boolean(options.onSubmit),
    (options.extensions ?? []).map((extension) => extension.name).join(","),
  ];
}

function useEditable(editor: TiptapEditor, editable: boolean) {
  useEffect(() => {
    if (editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);
}
