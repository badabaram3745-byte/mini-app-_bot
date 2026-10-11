import type { Editor as TiptapEditor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { BubbleMenu } from "./menus";

interface ToolbarProps {
  editor: TiptapEditor;
  placement: "bubble" | "fixed";
  /** Whether the block tools are shown. */
  blocks: boolean;
}

interface Tool {
  id: string;
  label: string;
  icon: typeof Bold;
  block?: true;
  active: (editor: TiptapEditor) => boolean;
  /** Absent only for the link tool, which opens the URL field. */
  run?: (editor: TiptapEditor) => void;
}

const TOOLS: readonly Tool[] = [
  {
    id: "bold",
    label: "Bold",
    icon: Bold,
    active: (e) => e.isActive("bold"),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    id: "italic",
    label: "Italic",
    icon: Italic,
    active: (e) => e.isActive("italic"),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    id: "strike",
    label: "Strikethrough",
    icon: Strikethrough,
    active: (e) => e.isActive("strike"),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    id: "code",
    label: "Code",
    icon: Code,
    active: (e) => e.isActive("code"),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    id: "link",
    label: "Link",
    icon: Link,
    active: (e) => e.isActive("link"),
  },
  {
    id: "h1",
    label: "Heading 1",
    icon: Heading1,
    block: true,
    active: (e) => e.isActive("heading", { level: 1 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Heading 2",
    icon: Heading2,
    block: true,
    active: (e) => e.isActive("heading", { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    label: "Heading 3",
    icon: Heading3,
    block: true,
    active: (e) => e.isActive("heading", { level: 3 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: "bullets",
    label: "Bullet list",
    icon: List,
    block: true,
    active: (e) => e.isActive("bulletList"),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "numbers",
    label: "Numbered list",
    icon: ListOrdered,
    block: true,
    active: (e) => e.isActive("orderedList"),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "tasks",
    label: "Task list",
    icon: ListChecks,
    block: true,
    active: (e) => e.isActive("taskList"),
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: "quote",
    label: "Quote",
    icon: Quote,
    block: true,
    active: (e) => e.isActive("blockquote"),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
];

export function Toolbar(props: ToolbarProps): ReactElement | null {
  const { editor, placement } = props;
  const [link, setLink] = useState<string | null>(null);
  const tools = TOOLS.filter((tool) => props.blocks || !tool.block);
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      tools.map((tool) => (current.isEditable ? tool.active(current) : false)),
  });
  const editable = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });
  if (!editable) {
    return null;
  }
  const close = () => {
    setLink(null);
    editor.commands.focus();
  };
  const bar =
    link === null ? (
      <div
        aria-label="Formatting"
        className="ck-toolbar"
        data-placement={placement}
        role="toolbar"
      >
        {tools.map((tool, index) => {
          const Icon = tool.icon;
          return (
            <button
              aria-label={tool.label}
              aria-pressed={active[index] ?? false}
              key={tool.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                tool.run
                  ? tool.run(editor)
                  : setLink(
                      (editor.getAttributes("link").href as
                        | string
                        | undefined) ?? "",
                    )
              }
              title={tool.label}
              type="button"
            >
              <Icon aria-hidden="true" />
            </button>
          );
        })}
      </div>
    ) : (
      <form
        className="ck-toolbar"
        data-placement={placement}
        onSubmit={(event) => {
          event.preventDefault();
          applyLink(editor, link);
          close();
        }}
      >
        <input
          aria-label="Link URL"
          autoFocus
          onChange={(event) => setLink(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              close();
            }
          }}
          inputMode="url"
          placeholder="https://"
          type="text"
          value={link}
        />
        <button aria-label="Apply link" title="Apply link" type="submit">
          <Link aria-hidden="true" />
        </button>
      </form>
    );
  return placement === "bubble" ? (
    <BubbleMenu editor={editor} options={{ placement: "top", offset: 8 }}>
      {bar}
    </BubbleMenu>
  ) : (
    bar
  );
}

function applyLink(editor: TiptapEditor, href: string): void {
  const chain = editor.chain().focus().extendMarkRange("link");
  if (href.trim() === "") {
    chain.unsetLink().run();
  } else {
    chain.setLink({ href: href.trim() }).run();
  }
}
