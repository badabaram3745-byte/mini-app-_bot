import { shared } from "@kits/sync";
import type { OpaqueField } from "@kits/sync/internal";
import {
  Extension,
  type AnyExtension,
  type Editor as TiptapEditor,
} from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Mention from "@tiptap/extension-mention";
import { TableKit } from "@tiptap/extension-table";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import type * as Y from "yjs";
import type { EditorOptions, MentionItem, MentionSource } from "./options";
import { Slash } from "./slash";
import { menuRenderer, popupOptions } from "./suggestions";
import { SyncCaret } from "./SyncCaret";

/** The kit's extensions; every editor and `richText()` reader registers the same nodes and marks, whatever the options. */
export function editorExtensions(
  options: EditorOptions,
  field?: OpaqueField<Y.XmlFragment>,
): AnyExtension[] {
  const { single = false } = options;
  const target = field?.value;
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      link: { openOnClick: false },
      undoRedo: target ? false : undefined,
      trailingNode: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image,
    TableKit.configure({ table: { resizable: false } }),
    mentionExtension(options.mentions ?? (target ? collaborators : false)),
    Markdown,
  ];
  if (options.placeholder) {
    extensions.push(
      Placeholder.configure({ placeholder: options.placeholder }),
    );
  }
  if (options.onSubmit || single) {
    extensions.push(Submit.configure({ single, onSubmit: options.onSubmit }));
  }
  if (single) {
    extensions.push(SingleLine);
  }
  const slash = options.slash ?? !single;
  if (slash) {
    extensions.push(
      Slash.configure({
        items: Array.isArray(slash) ? slash : [],
        blocks: !single,
      }),
    );
  }
  if (target) {
    extensions.push(
      Collaboration.configure({ fragment: target }),
      SyncCaret.configure({ awareness: field?.awareness ?? null }),
    );
  }
  return [...extensions, ...(options.extensions ?? [])];
}

interface SubmitOptions {
  single: boolean;
  onSubmit: ((editor: TiptapEditor) => void) | undefined;
}

const Submit = Extension.create<SubmitOptions>({
  name: "submit",
  priority: 1000,

  addOptions() {
    return { single: false, onSubmit: undefined };
  },

  addKeyboardShortcuts() {
    const submit = () => {
      this.options.onSubmit?.(this.editor);
      return true;
    };
    const shortcuts: Record<string, () => boolean> = {};
    if (this.options.onSubmit) {
      shortcuts["Mod-Enter"] = submit;
    }
    if (this.options.single) {
      shortcuts.Enter = submit;
    }
    return shortcuts;
  },
});

/** Folds pasted blocks into one paragraph, a soft break between them. */
const SingleLine = Extension.create({
  name: "singleLine",

  addProseMirrorPlugins() {
    const { schema } = this.editor;
    return [
      new Plugin({
        props: {
          transformPasted: (slice) => {
            const lines: Fragment[] = [];
            slice.content.descendants((node: PMNode) => {
              if (node.isTextblock) {
                lines.push(node.content);
              }
              return !node.isTextblock;
            });
            if (lines.length < 2) {
              return slice;
            }
            const inline = lines.reduce((joined, line) =>
              joined
                .append(Fragment.from(schema.nodes.hardBreak!.create()))
                .append(line),
            );
            return new Slice(
              Fragment.from(schema.nodes.paragraph!.create(null, inline)),
              0,
              0,
            );
          },
        },
      }),
    ];
  },
});

/** The `@` menu over `source`; with `false` the mention node stays in the schema but the menu never opens. */
function mentionExtension(source: MentionSource | false): AnyExtension {
  const key = new PluginKey("mention");
  return Mention.extend({
    renderMarkdown: ({ attrs }) => `@${attrs?.label ?? attrs?.id ?? ""}`,
  }).configure({
    HTMLAttributes: { class: "mention" },
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    suggestion: {
      ...popupOptions,
      char: "@",
      pluginKey: key,
      allow: () => source !== false,
      items: ({ query }) =>
        typeof source === "function"
          ? source(query)
          : matching(source || [], query),
      render: menuRenderer<MentionItem>(key, "mention"),
    },
  });
}

const collaborators: MentionSource = (query) =>
  matching(
    shared.collaborators.map(({ user }) => ({ id: user.id, label: user.name })),
    query,
  );

export function matching<Item extends { label: string }>(
  items: Item[],
  query: string,
): Item[] {
  const wanted = query.trim().toLowerCase();
  return items
    .filter((item) => item.label.toLowerCase().includes(wanted))
    .slice(0, 8);
}
