import type { FieldValue } from "@kits/sync";
import type { AnyExtension, Editor as TiptapEditor } from "@tiptap/core";
import type { BubbleMenuPluginProps } from "@tiptap/extension-bubble-menu";
import type { FloatingMenuPluginProps } from "@tiptap/extension-floating-menu";
import type { ReactElement, ReactNode } from "react";

export type { Editor as TiptapEditor, JSONContent } from "@tiptap/core";
export { createBlockMarkdownSpec, createInlineMarkdownSpec, Extension, Mark, mergeAttributes, Node, } from "@tiptap/core";
export { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditorState, } from "@tiptap/react";

/** Own the state with `value`/`onChange`, or share it with `doc`/`field` on a `@kits/sync` document. */
interface LocalBinding<T> {
    value: T;
    onChange: (value: T) => void;
    doc?: never;
    field?: never;
}
interface SharedBinding {
    /** The document path, like `cards/${card.id}`. */
    doc: string;
    field: string;
    value?: never;
    onChange?: never;
}

export interface MentionItem {
    id: string;
    label: string;
}
export type MentionSource = MentionItem[] | ((query: string) => MentionItem[] | Promise<MentionItem[]>);
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

interface EditorBaseProps extends EditorOptions {
    /** Classes on the wrapper. Content typography is yours, e.g. `prose dark:prose-invert` for a document; the editor's own chrome follows the shadcn tokens. */
    className?: string;
    /** `"bubble"` over the selection (default), `"fixed"` above the content, `false` none; `single` defaults to `false`. */
    toolbar?: "bubble" | "fixed" | false;
    /** Rendered above the content, with the editor for `BubbleMenu` / `FloatingMenu`. */
    children?: (editor: TiptapEditor) => ReactNode;
}
export type EditorProps = EditorBaseProps & (LocalBinding<string> | SharedBinding);
/** Rich text with formatting, links, lists, tasks, a `/` menu and `@` mentions; `value`/`onChange` are Markdown, or bind `doc`/`field` to a `sharedRichText()` for live shared editing. */
export declare function Editor(props: EditorProps): ReactElement;

export interface LocalEditorOptions extends EditorOptions {
    /** Markdown; `onChange` gets Markdown after every edit. */
    value: string;
    onChange: (value: string) => void;
}
/** The editor instance over `value`/`onChange`, to render with `EditorContent`. */
export declare function useEditor(options: LocalEditorOptions): TiptapEditor;
/** The editor instance over a `sharedRichText()` field, to render with `EditorContent`; suspends until shared state has loaded. */
export declare function useSharedEditor(doc: string, field: string, options?: EditorOptions): TiptapEditor;

/** Creates rich text everyone edits together with the `Editor`: `add({ body: sharedRichText("# Notes") })`. The Markdown is the starting content; `richText(doc, field).setMarkdown()` replaces it later. */
export declare function sharedRichText(markdown?: string): FieldValue;
export interface RichText {
    /** Plain text, one line per block; `""` while the field is missing or a plain value. */
    text(): string;
    html(): string;
    markdown(): string;
    /** Replaces the field's content in one write no undo reverts; a no-op while the field is missing or the viewer cannot edit. */
    setMarkdown(markdown: string): void;
}
/** Reads and replaces a `sharedRichText()` field outside render; pass the editor's `extensions` so both use one schema. Throws, naming the kit to use, when another kit's field is there. */
export declare function richText(doc: string, field: string, options?: Pick<EditorOptions, "extensions">): RichText;

type MenuOptions<Props> = Omit<Props, "editor" | "element" | "pluginKey">;
export interface BubbleMenuProps extends MenuOptions<BubbleMenuPluginProps> {
    editor: TiptapEditor;
    className?: string;
    children: ReactNode;
}
export interface FloatingMenuProps extends MenuOptions<FloatingMenuPluginProps> {
    editor: TiptapEditor;
    className?: string;
    children: ReactNode;
}
/** Your own menu over the selection. */
export declare function BubbleMenu(props: BubbleMenuProps): ReactElement | null;
/** Your own menu beside an empty line. */
export declare function FloatingMenu(props: FloatingMenuProps): ReactElement | null;
