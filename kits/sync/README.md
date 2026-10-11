# Sync

Pick where a value lives by who must see it. If everyone must see it, put it in a shared document or collection (`useSharedDoc`, `useSharedCollection`). If only you must see it and it should still be there after a reload, use `useMyState(key, initial)`. If only you must see it in this tab, plain `useState` is enough. If everyone must see it right now but nobody needs it later, use presence (`useMe().setPresence`) or `useBroadcast`.

Never put ClickUp data (anything from `@kits/clickup`) into shared state. Every viewer can read the shared state, whatever their own ClickUp permissions are. Store only the ids your code already hardcodes and fetch the rest live. Per-user `useMyState` is fine, because only that viewer sees it.

The kit is in every project as `kits/sync`. Shared state is a tree of documents and collections, addressed by paths like Firestore: `game/state` is a document, `cards` is a collection, `cards/${id}/steps` is a subcollection. Every write shows up for you right away and is merged with what everyone else writes.

```jsx
import { useSharedDoc, useSharedCollection, useMyState, deleteField, sharedText, increment, arrayUnion, arrayRemove, SharedInput, SharedTextarea, useMe, useCollaborators, useBroadcast, useUndo, useSharedStatus, shared } from "@kits/sync";

const me = useMe(); // me.user is the viewer (clickup.viewer); me.presence is what the others see of you
const game = useSharedDoc("game/state", { phase: "lobby", paused: false }); // the defaults fill in missing fields when reading; they are never written
game.exists; // false until set() creates the document; game.data.id is "state"
game.set({ phase: "voting", paused: false }); // creates the document, or replaces all of it
game.update({ phase: "results" }); // changes only these fields; throws if the document does not exist yet
game.update((current) => ({ paused: !current.paused })); // a function gets the latest document

const cards = useSharedCollection("cards"); // cards.items is the list of card documents, in order
const id = cards.add({ title: sharedText("New"), column: "todo", likes: increment(0), tags: arrayUnion() }); // adds a card at the end and returns its id; the title is text people type in together, likes is a counter, tags is a list
cards.update(id, { [`votes.${me.user.id}`]: true }); // a dotted key sets one nested value and leaves the others alone; deleteField() removes it; { votes: {} } replaces the whole object
cards.update(id, { title: "Generated…" }); // replaces the text's content; people can still type in it
cards.update(id, { likes: increment(1), tags: arrayUnion("bug") }); // adds to the counter and the list without losing what others add at the same time; arrayRemove() removes
cards.move(id, { before: otherId }); // or { after: otherId }, or an index
useSharedCollection(open ? `cards/${open}/steps` : null); // with a null path there are no items and the methods do nothing (useSharedDoc too)
<SharedInput doc={`cards/${id}`} field="title" />; // an input for a sharedText() field; SharedTextarea for several lines

me.setPresence((current) => ({ ...current, editing: id })); // everyone else sees this right away; it is never saved; a plain value would replace the whole presence
const collaborators = useCollaborators(); // everyone else here right now, as [{ user, presence }]; who is here is [me, ...collaborators]
const editors = useCollaborators((all) => all.filter((c) => c.presence.editing === id)); // with a selector, re-renders only when its result changes
shared.broadcast("buzz", { team: "red" }); // sends an event to everyone else here right now; it is never saved, so latecomers never see it
useBroadcast("buzz", (payload, from) => flash(from.name, payload.team)); // runs for each buzz someone else sends
const [tab, setTab] = useMyState("tab", "board"); // like useState, but saved for this viewer across reloads
const { undo, redo, canUndo, canRedo } = useUndo(); // undo and redo your own changes
const { connection, canEdit, outdated } = useSharedStatus(); // when outdated is true a newer build is live: ask the viewer to reload
shared.collection("cards").items; shared.doc("game/state").data; shared.me; shared.collaborators; // the same state outside React, always current, for a draw loop or a keydown listener; inside components use the hooks
```

A kanban board: the columns are constants in code, the cards are one collection with a `column` field, and each title is text people type in together.

```jsx
const COLUMNS = ["todo", "doing", "done"];
export default function Board() {
  const cards = useSharedCollection("cards");
  return COLUMNS.map((column) => (
    <section key={column}>
      <h2>{column}</h2>
      {cards.items.filter((card) => card.column === column).map((card) => (
        <SharedInput key={card.id} doc={`cards/${card.id}`} field="title" />
      ))}
      <button onClick={() => cards.add({ title: sharedText("New card"), column })}>Add card</button>
    </section>
  ));
}
```

Rules:

- Change counters and lists with `increment()`, `arrayUnion()` and `arrayRemove()`, never with `likes + 1` or `[...tags, "bug"]`. Reading a value and writing it back loses whatever someone else wrote in between.
- There are no transactions or locks. To decide who gets something, let everyone write their own document (`claims/${me.user.id}`) and compute the same winner in render. Store facts, like the time a timer ends, and compute the rest (the countdown, totals, scores) when rendering.
- Keep lists flat. A kanban board is one `cards` collection where every card has a `column` field, not one list per column; the column names live in your code. To reorder, call `move()`; never store your own order arrays.
- Name `useMyState` keys like shared paths (`draft`, `cards/42`); names starting with `#` belong to the kit.

To see it as two people, run `artifact cdp -c "text=Add card" --as Bob -s`: it clicks as you, then screenshots Bob's tab (`--as me` switches back).

Formatted text (mentions, a slash menu) everyone works on is the `Editor` of `@kits/components/editor`; it creates its own field, the COMPONENTS skill explains it.

The full API is in `kits/sync/docs/shared.d.ts`; the props of `SharedInput` and `SharedTextarea` are in `kits/sync/docs/components.d.ts`.
