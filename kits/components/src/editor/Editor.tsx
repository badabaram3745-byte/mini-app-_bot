import type { Editor as TiptapEditor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import type { ReactElement, ReactNode } from "react";
import type { LocalBinding, SharedBinding } from "../binding";
import type { EditorOptions } from "./options";
import { Toolbar } from "./Toolbar";
import { useEditor, useSharedEditor } from "./useEditor";

interface EditorBaseProps extends EditorOptions {
  /** Classes on the wrapper. Content typography is yours, e.g. `prose dark:prose-invert` for a document; the editor's own chrome follows the shadcn tokens. */
  className?: string;
  /** `"bubble"` over the selection (default), `"fixed"` above the content, `false` none; `single` defaults to `false`. */
  toolbar?: "bubble" | "fixed" | false;
  /** Rendered above the content, with the editor for `BubbleMenu` / `FloatingMenu`. */
  children?: (editor: TiptapEditor) => ReactNode;
}

export type EditorProps = EditorBaseProps &
  (LocalBinding<string> | SharedBinding);

/** Rich text with formatting, links, lists, tasks, a `/` menu and `@` mentions; `value`/`onChange` are Markdown, or bind `doc`/`field` to a `sharedRichText()` for live shared editing. */
export function Editor(props: EditorProps): ReactElement {
  if (typeof props.doc === "string") {
    return <Shared {...props} />;
  }
  if (typeof props.onChange !== "function") {
    throw new Error(
      "Editor needs value and onChange to own its state, or doc and field to share it.",
    );
  }
  return <Local {...props} />;
}

function Local({
  value,
  onChange,
  ...rest
}: EditorBaseProps & LocalBinding<string>): ReactElement {
  const editor = useEditor({ ...rest, value, onChange });
  return <Surface editor={editor} {...rest} />;
}

function Shared({
  doc,
  field,
  ...rest
}: EditorBaseProps & SharedBinding): ReactElement {
  const editor = useSharedEditor(doc, field, rest);
  return <Surface editor={editor} {...rest} />;
}

function Surface({
  editor,
  className,
  toolbar,
  children,
  single = false,
}: EditorBaseProps & { editor: TiptapEditor }): ReactElement {
  const placement = toolbar ?? (single ? false : "bubble");
  return (
    <div
      className={className ? `ck-editor ${className}` : "ck-editor"}
      data-toolbar={placement || undefined}
    >
      {children?.(editor)}
      {placement && (
        <Toolbar blocks={!single} editor={editor} placement={placement} />
      )}
      <EditorContent className="ck-content" editor={editor} />
    </div>
  );
}
