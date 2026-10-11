# Components

`@kits/components` holds the larger building blocks. Today that is a rich-text editor at `@kits/components/editor`.

To share an editor, give it `doc` and `field`, which name a field on a `@kits/sync` document; the SYNC skill explains documents. The other props are the same either way. Buttons, inputs and dialogs come from `@kits/shadcn`, and ClickUp data and its UI come from `@kits/clickup`.

## Editor

The `Editor` edits rich text with bold, italic, strike, code, links, headings, lists, tasks, quotes and code blocks. People type `/` for a block menu and `@` to mention someone. Markdown shortcuts like `**bold**`, `# `, `- ` and `[ ] ` work as they type, and a formatting bubble appears over a selection. When the editor is shared, everyone's edits merge live and each person's caret shows in their avatar colour.

```jsx
import { Editor, richText, sharedRichText } from "@kits/components/editor";
import { sharedText, useSharedCollection } from "@kits/sync";

<Editor value={notes} onChange={setNotes} placeholder="Notes…" />; // A local editor holds its Markdown in value and calls onChange with Markdown after every edit.
cards.add({ title: sharedText("New card"), body: sharedRichText("# Notes") }); // To share, first create the field together with its document; the starting Markdown is optional.
<Editor doc={`cards/${card.id}`} field="body" placeholder="Details…" />; // Then render the editor on that field. It stays read-only until the field exists or while the viewer cannot edit.

<Editor doc="notes/main" field="body" toolbar="fixed" className="prose dark:prose-invert min-h-[60vh]" />; // A whole document gets a fixed toolbar and prose typography.
<Editor doc={`drafts/${me.user.id}`} field="text" single placeholder="Message…" onSubmit={send} />; // A chat composer keeps one paragraph. Enter calls onSubmit and Shift+Enter breaks the line.
```

Rules:

- To show rich text without editing, render `<Editor doc="…" field="…" readOnly toolbar={false} />`.
- To get the plain text, for search or a summary, call `richText(doc, field).text()`. Do not read `card.body` directly; it is not text.
- To start a field with content, pass it to the marker: `body: sharedRichText("# Notes")`. `richText(doc, field).setMarkdown(md)` replaces the content later.
- Cmd+Z inside an editor undoes typing in that editor. `useUndo()` undoes your other document writes; it does not undo what `setMarkdown()` wrote.
- For custom blocks, pass `extensions`; the `.d.ts` shows how.

The full API is in `kits/components/docs/editor.d.ts`.
