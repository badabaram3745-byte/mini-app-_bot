import { useEffect, useMemo, useRef } from "react";
import type { User } from "../user";
import {
  arrayRemove as removeMarker,
  arrayUnion as unionMarker,
  deepEqual,
  deleteField as deleteMarker,
  increment as incrementMarker,
  sharedText as textMarker,
} from "./fields";
import { collectionHandle, docHandle } from "./handles";
import { collectionPath, documentPath } from "./paths";
import {
  ANY_KEY,
  getStore,
  HISTORY_KEY,
  PRESENCE_KEY,
  STATUS_KEY,
} from "./store";
import { useStable, useStoreValue } from "./useStoreValue";

export type { MyState } from "./myState";
export { myState, useMyState } from "./myState";

/** What a field can hold. Store dates as ISO strings or numbers. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

export interface JsonObject {
  [field: string]: JsonValue;
}

/** A document's fields plus its `id`, the last path segment; read-only. */
export interface DocData extends JsonObject {
  id: string;
}

export type FieldValue =
  | { "#delete": true }
  | { "#text": string }
  | { "#opaque": { y: "xml" | "map"; of: string } }
  | { "#increment": number }
  | { "#union": JsonValue[] }
  | { "#remove": JsonValue[] };

/**
 * The fields to write, each key on its own: a dotted key like `"votes.u1"`
 * sets one nested value, a plain object replaces the whole nested object, a
 * marker (`deleteField()`, `sharedText()`, `increment()`, `arrayUnion()`,
 * `arrayRemove()` or another kit's) creates or changes that kind of field,
 * and `undefined` is skipped. `id` is ignored, so an item can be spread back
 * in; only the fields the spread changed are written.
 */
export interface Fields {
  [field: string]: JsonValue | FieldValue | undefined;
}

/** Removes a field: `update({ [`votes.${uid}`]: deleteField() })`. */
export function deleteField(): FieldValue {
  return deleteMarker();
}

/** Creates a text everyone can type in together: `add({ body: sharedText() })`. Edit it with `SharedTextarea` or `SharedInput`; the field reads and writes as a string. */
export function sharedText(initial?: string): FieldValue {
  return textMarker(initial);
}

/** Adds to a number without losing anyone else's additions: `update({ likes: increment(1) })`; negative subtracts. The field reads as a number, and writing a plain number to it adjusts it by the difference. */
export function increment(by: number): FieldValue {
  return incrementMarker(by);
}

/** Adds values to an array, each once, without losing anyone else's: `update({ tags: arrayUnion("bug") })`, or `arrayUnion(...tags)` for several. The field reads as an array in the order values were added, and writing a plain array to it adds and removes the difference. */
export function arrayUnion(...values: JsonValue[]): FieldValue {
  return unionMarker(...values);
}

/** Removes values from an array: `update({ tags: arrayRemove("bug") })`. */
export function arrayRemove(...values: JsonValue[]): FieldValue {
  return removeMarker(...values);
}

export interface SharedDoc {
  /** False until the document is created with `set`; `update` throws before that. */
  exists: boolean;
  data: DocData;
  /** Creates or replaces the whole document. */
  set(fields: Fields): void;
  /** Merges into the document; throws if it does not exist. */
  update(fields: Fields | ((current: DocData) => Fields)): void;
  /** Deletes the document and its subcollections; nothing happens if it does not exist. */
  delete(): void;
}

/**
 * One document at a path like `game/state` or `cards/k3f9`; `defaults` fill
 * in missing top-level fields and are never written. A null path gives empty
 * data and methods that do nothing; suspends until the shared state has
 * loaded.
 */
export function useSharedDoc(
  path: string | null | undefined,
  defaults?: Fields,
): SharedDoc {
  const key = path == null ? null : documentPath(path);
  const stableDefaults = useStable(defaults);
  const doc = useMemo(
    () => docHandle(key, stableDefaults),
    [key, stableDefaults],
  );
  if (key !== null) {
    getStore().suspendUntilSynced();
  }
  const data = useStoreValue(key, () => doc.data);
  return { ...doc, data };
}

export interface SharedCollection {
  /** The child documents, in order, as of this render; `shared.collection(path).items` is always current. */
  items: readonly DocData[];
  /** Adds a document at the end and returns its id. Pass `id` in the fields to choose it. */
  add(fields: Fields): string;
  /** Creates or replaces the document with this `id`; returns the id. */
  set(id: string, fields: Fields): string;
  /** Merges into the item; throws if the id is unknown. */
  update(id: string, fields: Fields | ((current: DocData) => Fields)): void;
  /** Deletes the item and its subcollections; nothing happens if the id is unknown. */
  delete(id: string): void;
  /** Moves an item to an index, or before or after another item; `items` returns the new order. Throws if either id is unknown. */
  move(id: string, to: number | { before: string } | { after: string }): void;
}

/**
 * The documents at a collection path like `cards` or `cards/k3f9/steps`, in
 * order, and the methods to change them. A null path gives no items and
 * methods that do nothing; suspends until the shared state has loaded.
 */
export function useSharedCollection(
  path: string | null | undefined,
): SharedCollection {
  const key = path == null ? null : collectionPath(path);
  const collection = useMemo(() => collectionHandle(key), [key]);
  if (key !== null) {
    getStore().suspendUntilSynced();
  }
  const items = useStoreValue(key, () => collection.items);
  return { ...collection, items };
}

export type { User } from "../user";

/** One person viewing the artifact right now: who they are and their presence. */
export interface Collaborator {
  user: User;
  /** Their presence; `{}` until they set one. */
  presence: JsonObject;
}

/**
 * This viewer: `user` is `clickup.viewer`, `presence` is what everyone else
 * sees of them live, `{}` until set, never saved.
 */
export function useMe(): Collaborator & {
  /** Sets what everyone else sees of you, like a `useState` setter: pass a new value or a function of the current one. Spread the current one to keep the keys other components write: `cursor`, `message` and `selection` from `Cursors`, `slide` from a slides `Deck`. */
  setPresence(
    presence: JsonObject | ((current: JsonObject) => JsonObject),
  ): void;
} {
  return useStoreValue(PRESENCE_KEY, () => shared.me);
}

/**
 * Everyone else viewing the artifact right now, one entry per person. With
 * `select`, only what it returns, re-rendering when that changes:
 * `useCollaborators((all) => all.filter((c) => c.presence.editing === id))`.
 */
export function useCollaborators<T = readonly Collaborator[]>(
  select?: (collaborators: readonly Collaborator[]) => T,
): T {
  const last = useRef<{
    from: readonly Collaborator[];
    select: typeof select;
    value: T;
  }>();
  return useStoreValue(PRESENCE_KEY, () => {
    const from = shared.collaborators;
    if (!select) {
      return from as T;
    }
    const cached = last.current;
    if (cached && cached.from === from && cached.select === select) {
      return cached.value;
    }
    const next = select(from);
    const value = cached && deepEqual(cached.value, next) ? cached.value : next;
    last.current = { from, select, value };
    return value;
  });
}

/**
 * Runs `listener` for each `name` broadcast another person sends while
 * mounted, with the payload and who sent it:
 * `useBroadcast("buzz", (payload, from) => flash(from.name))`. Broadcasts
 * are for what happens, documents for what must survive; a listener runs on
 * every other page, so a write in it lands once per viewer.
 */
export function useBroadcast(
  name: string,
  listener: (payload: JsonValue, from: User) => void,
): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(
    () =>
      shared.onBroadcast(name, (payload, from) =>
        latest.current(payload, from),
      ),
    [name],
  );
}

/**
 * Undo and redo this viewer's own changes; all writes from one event handler
 * are one step. While `canEdit` is false, both do nothing and both flags are
 * false.
 */
export function useUndo(): {
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
} {
  return {
    ...useStoreValue(HISTORY_KEY, () => getStore().history),
    undo: shared.undo,
    redo: shared.redo,
  };
}

export interface SharedStatus {
  /** `connecting` until the shared state has loaded, and again while reconnecting; `disconnected` on a host without collaboration; otherwise the host's connection state. */
  connection: "connecting" | "connected" | "disconnected";
  /** False while loading, in read-only rooms and in outdated builds. Writes are then ignored. */
  canEdit: boolean;
  /** True when a newer build of this artifact is live. Ask the viewer to reload. */
  outdated: boolean;
}

/** Whether the shared state is connected, whether you can edit it, and whether a newer build is live. */
export function useSharedStatus(): SharedStatus {
  return useStoreValue(STATUS_KEY, () => shared.status);
}

/**
 * Shared state outside React: the same documents, collections, presence,
 * broadcasts, undo and status as the hooks, always current. Use it in a draw
 * loop or in an event listener set up outside a component; in render, use
 * the hooks.
 */
export const shared: {
  /** The document at `path`, as `useSharedDoc` gives it; `data` and `exists` read the current state. */
  doc(path: string | null | undefined, defaults?: Fields): SharedDoc;
  /** The collection at `path`, as `useSharedCollection` gives it; `items` reads the current state. */
  collection(path: string | null | undefined): SharedCollection;
  /** This viewer, as `useMe` gives them. */
  readonly me: Collaborator & {
    setPresence(
      presence: JsonObject | ((current: JsonObject) => JsonObject),
    ): void;
  };
  readonly collaborators: readonly Collaborator[];
  /** Sends `name` with `payload` to everyone else viewing the artifact right now; never saved, never replayed to anyone who arrives later. */
  broadcast(name: string, payload?: JsonValue): void;
  /** Calls `listener` with each `name` broadcast another person sends, as `useBroadcast` does. Returns a function that stops the calls. */
  onBroadcast(
    name: string,
    listener: (payload: JsonValue, from: User) => void,
  ): () => void;
  readonly status: SharedStatus;
  undo(): void;
  redo(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Calls `listener` after every change to documents, presence, status or history. Returns a function that stops the calls. */
  subscribe(listener: () => void): () => void;
  /** Resolves once the shared state has loaded; until then writes are ignored. */
  ready(): Promise<void>;
} = {
  doc: docHandle,
  collection: collectionHandle,
  get me() {
    return getStore().presence.me;
  },
  get collaborators() {
    return getStore().presence.collaborators;
  },
  broadcast: (name, payload) => getStore().presence.broadcast(name, payload),
  onBroadcast: (name, listener) =>
    getStore().presence.onBroadcast(name, listener),
  get status() {
    return getStore().status;
  },
  undo: () => getStore().undo(),
  redo: () => getStore().redo(),
  get canUndo() {
    return getStore().history.canUndo;
  },
  get canRedo() {
    return getStore().history.canRedo;
  },
  subscribe: (listener) => getStore().subscribe(ANY_KEY, listener),
  ready: () => getStore().ready(),
};
