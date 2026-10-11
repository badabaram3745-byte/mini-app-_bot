import type { AnyExtension, Editor as TiptapEditor } from "@tiptap/core";

export interface MentionItem {
  id: string;
  label: string;
}

export type MentionSource =
  | MentionItem[]
  | ((query: string) => MentionItem[] | Promise<MentionItem[]>);

/** An entry of the `/` menu; `run` gets the editor with the slash and query already deleted. */
export interface SlashItem {
  id: string;
  label: string;
  /** Extra search words, space-separated. */
  keywords?: string;
  /** One line under the label. */
  description?: string;
  run: (editor: TiptapEditor) => void;
}

export interface EditorOptions {
  placeholder?: string;
  autoFocus?: boolean;
  /** Forced on while the viewer cannot edit or the shared field is not a `sharedRichText()`. */
  readOnly?: boolean;
  /** One paragraph: Enter calls `onSubmit`, Shift+Enter is a soft break, pasted blocks fold into the line. */
  single?: boolean;
  /** Enter in `single` mode, Cmd/Ctrl+Enter otherwise. */
  onSubmit?: (editor: TiptapEditor) => void;
  /** `false` hides the `/` menu, an array adds entries to it; off in `single`. */
  slash?: false | SlashItem[];
  /** The `@` menu; default: the other people in the room when shared, none when local. */
  mentions?: MentionSource | false;
  /** Tiptap extensions appended to the kit's; every editor and `richText()` on one field must pass the same ones. A custom block (`Node.create`) needs a Markdown spec (`createBlockMarkdownSpec`) to survive `value`/`onChange` and `markdown()`, and a `/` entry via `slash`. */
  extensions?: AnyExtension[];
  onReady?: (editor: TiptapEditor) => void;
}
