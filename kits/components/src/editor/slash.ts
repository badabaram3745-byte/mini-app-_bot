import { Extension, type Editor as TiptapEditor } from "@tiptap/core";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { PluginKey, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import Suggestion from "@tiptap/suggestion";
import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Shapes,
  Table,
  Type,
} from "lucide-react";
import type { SlashItem } from "./options";
import { menuRenderer, type MenuItem, popupOptions } from "./suggestions";

export interface SlashOptions {
  /** The author's entries, listed under "More". */
  items: SlashItem[];
  /** Whether the built-in blocks are listed. */
  blocks: boolean;
}

interface SlashEntry extends SlashItem, MenuItem {}

interface SlashState {
  active: boolean;
  range: { from: number; to: number };
}

const setBlock =
  (type: string, attrs?: Record<string, unknown>) => (e: TiptapEditor) =>
    e.chain().focus().clearNodes().setNode(type, attrs).run();

const wrapList = (list: string, item: string) => (e: TiptapEditor) => {
  if (!e.isActive(list)) {
    e.chain().focus().clearNodes().toggleList(list, item).run();
  }
};

const BLOCKS: readonly SlashEntry[] = [
  {
    id: "text",
    label: "Text",
    description: "Plain paragraph text.",
    keywords: "paragraph plain p",
    group: "Basic blocks",
    icon: Type,
    run: setBlock("paragraph"),
  },
  {
    id: "h1",
    label: "Heading 1",
    description: "Big section heading.",
    keywords: "h1 title",
    hint: "#",
    group: "Basic blocks",
    icon: Heading1,
    run: setBlock("heading", { level: 1 }),
  },
  {
    id: "h2",
    label: "Heading 2",
    description: "Medium section heading.",
    keywords: "h2 subtitle",
    hint: "##",
    group: "Basic blocks",
    icon: Heading2,
    run: setBlock("heading", { level: 2 }),
  },
  {
    id: "h3",
    label: "Heading 3",
    description: "Small section heading.",
    keywords: "h3",
    hint: "###",
    group: "Basic blocks",
    icon: Heading3,
    run: setBlock("heading", { level: 3 }),
  },
  {
    id: "quote",
    label: "Quote",
    description: "A highlighted quotation.",
    keywords: "blockquote citation",
    hint: ">",
    group: "Basic blocks",
    icon: Quote,
    run: (e) => e.chain().focus().clearNodes().wrapIn("blockquote").run(),
  },
  {
    id: "divider",
    label: "Divider",
    description: "A line between blocks.",
    keywords: "hr rule line separator",
    hint: "---",
    group: "Basic blocks",
    icon: Minus,
    run: (e) => e.chain().focus().clearNodes().setHorizontalRule().run(),
  },
  {
    id: "bullets",
    label: "Bullet list",
    description: "A simple bulleted list.",
    keywords: "bulleted unordered ul",
    hint: "-",
    group: "Lists",
    icon: List,
    run: wrapList("bulletList", "listItem"),
  },
  {
    id: "numbers",
    label: "Numbered list",
    description: "A list with numbering.",
    keywords: "ordered ol",
    hint: "1.",
    group: "Lists",
    icon: ListOrdered,
    run: wrapList("orderedList", "listItem"),
  },
  {
    id: "tasks",
    label: "Task list",
    description: "Tasks with checkboxes.",
    keywords: "todo to-do checkbox checklist",
    hint: "[]",
    group: "Lists",
    icon: ListChecks,
    run: wrapList("taskList", "taskItem"),
  },
  {
    id: "code",
    label: "Code block",
    description: "Code in monospace.",
    keywords: "pre snippet",
    hint: "```",
    group: "Advanced",
    icon: Code,
    run: setBlock("codeBlock"),
  },
  {
    id: "table",
    label: "Table",
    description: "Rows and columns.",
    keywords: "grid rows columns",
    group: "Advanced",
    icon: Table,
    run: (e) =>
      e
        .chain()
        .focus()
        .clearNodes()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
];

/** The `/` menu: opens on a typed `/`, filters as the query grows, replaces `/query` with the pick. */
export const Slash = Extension.create<SlashOptions>({
  name: "slash",

  addOptions() {
    return { items: [], blocks: true };
  },

  addProseMirrorPlugins() {
    const key = new PluginKey<SlashState>("slash");
    const entries: SlashEntry[] = [
      ...(this.options.blocks ? BLOCKS : []),
      ...this.options.items.map((item) => ({
        group: "More",
        icon: Shapes,
        ...item,
      })),
    ];
    return [
      Suggestion<SlashEntry, SlashEntry>({
        ...popupOptions,
        editor: this.editor,
        pluginKey: key,
        char: "/",
        allowSpaces: true,
        allowedPrefixes: null,
        allow: ({ state, range }) => {
          const $caret = state.doc.resolve(range.to);
          return (
            !$caret.parent.type.spec.code &&
            !$caret.marks().some((mark) => mark.type.spec.code)
          );
        },
        shouldShow: ({ editor, range, query, transaction }) => {
          if (/^\s/.test(query) || query.includes("/")) {
            return false;
          }
          const before = key.getState(editor.state);
          return before?.active && sameSlash(before, range, transaction)
            ? staysOpen(entries, query)
            : typedSlash(transaction);
        },
        items: ({ query }) => rank(entries, query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: menuRenderer<SlashEntry>(key, "slash"),
      }),
    ];
  },
});

/** Whether the match is still the `/` the menu opened on. */
function sameSlash(
  before: SlashState,
  range: { from: number },
  transaction: Transaction,
): boolean {
  return (
    isChangeOrigin(transaction) ||
    transaction.mapping.map(before.range.from) === range.from
  );
}

function staysOpen(entries: SlashEntry[], query: string): boolean {
  return !(/\s/.test(query) && rank(entries, query).length === 0);
}

/** Whether this transaction is the person typing a `/`, not a paste, an undo or a remote edit. */
function typedSlash(transaction: Transaction): boolean {
  const [step] = transaction.steps;
  return (
    transaction.steps.length === 1 &&
    step instanceof ReplaceStep &&
    !transaction.getMeta("uiEvent") &&
    !isChangeOrigin(transaction) &&
    step.slice.content.textBetween(0, step.slice.content.size).endsWith("/")
  );
}

/** The entries matching `query`, groups ordered by their best score and entries by score within a group; ties keep listed order. */
function rank(entries: SlashEntry[], query: string): SlashEntry[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) {
    return entries;
  }
  const hits = entries
    .map((entry, index) => ({ entry, index, score: score(entry, wanted) }))
    .filter((hit) => hit.score < Infinity);
  const groups = new Map<string | undefined, { best: number; first: number }>();
  for (const { entry, index, score: hitScore } of hits) {
    const group = groups.get(entry.group);
    if (!group) {
      groups.set(entry.group, { best: hitScore, first: index });
    } else {
      group.best = Math.min(group.best, hitScore);
    }
  }
  return hits
    .sort((a, b) => {
      if (a.entry.group !== b.entry.group) {
        const groupA = groups.get(a.entry.group)!;
        const groupB = groups.get(b.entry.group)!;
        return groupA.best - groupB.best || groupA.first - groupB.first;
      }
      return a.score - b.score || a.index - b.index;
    })
    .map((hit) => hit.entry);
}

function score(entry: SlashEntry, wanted: string): number {
  const label = entry.label.toLowerCase();
  const words = [
    ...label.split(/\s+/),
    ...(entry.keywords ?? "").toLowerCase().split(/\s+/),
  ].filter(Boolean);
  if (label.startsWith(wanted)) {
    return 0;
  }
  if (words.some((word) => word.startsWith(wanted))) {
    return 1;
  }
  if (wanted.length < 2) {
    return Infinity;
  }
  if (label.includes(wanted)) {
    return 2;
  }
  return inOrder(wanted.replace(/\s/g, ""), label.replace(/\s/g, ""))
    ? 3
    : Infinity;
}

function inOrder(letters: string, text: string): boolean {
  let at = 0;
  for (const letter of letters) {
    at = text.indexOf(letter, at) + 1;
    if (at === 0) {
      return false;
    }
  }
  return true;
}
