/** What a field can hold. Store dates as ISO strings or numbers. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
    [field: string]: JsonValue;
}
/** A document's fields plus its `id`, the last path segment; read-only. */
export interface DocData extends JsonObject {
    id: string;
}
export type FieldValue = {
    "#delete": true;
} | {
    "#text": string;
} | {
    "#opaque": {
        y: "xml" | "map";
        of: string;
    };
} | {
    "#increment": number;
} | {
    "#union": JsonValue[];
} | {
    "#remove": JsonValue[];
};
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
export declare function deleteField(): FieldValue;
/** Creates a text everyone can type in together: `add({ body: sharedText() })`. Edit it with `SharedTextarea` or `SharedInput`; the field reads and writes as a string. */
export declare function sharedText(initial?: string): FieldValue;
/** Adds to a number without losing anyone else's additions: `update({ likes: increment(1) })`; negative subtracts. The field reads as a number, and writing a plain number to it adjusts it by the difference. */
export declare function increment(by: number): FieldValue;
/** Adds values to an array, each once, without losing anyone else's: `update({ tags: arrayUnion("bug") })`, or `arrayUnion(...tags)` for several. The field reads as an array in the order values were added, and writing a plain array to it adds and removes the difference. */
export declare function arrayUnion(...values: JsonValue[]): FieldValue;
/** Removes values from an array: `update({ tags: arrayRemove("bug") })`. */
export declare function arrayRemove(...values: JsonValue[]): FieldValue;
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
export declare function useSharedDoc(path: string | null | undefined, defaults?: Fields): SharedDoc;
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
    move(id: string, to: number | {
        before: string;
    } | {
        after: string;
    }): void;
}
/**
 * The documents at a collection path like `cards` or `cards/k3f9/steps`, in
 * order, and the methods to change them. A null path gives no items and
 * methods that do nothing; suspends until the shared state has loaded.
 */
export declare function useSharedCollection(path: string | null | undefined): SharedCollection;
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
export declare function useMe(): Collaborator & {
    /** Sets what everyone else sees of you, like a `useState` setter: pass a new value or a function of the current one. Spread the current one to keep the keys other components write: `cursor`, `message` and `selection` from `Cursors`, `slide` from a slides `Deck`. */
    setPresence(presence: JsonObject | ((current: JsonObject) => JsonObject)): void;
};
/**
 * Everyone else viewing the artifact right now, one entry per person. With
 * `select`, only what it returns, re-rendering when that changes:
 * `useCollaborators((all) => all.filter((c) => c.presence.editing === id))`.
 */
export declare function useCollaborators<T = readonly Collaborator[]>(select?: (collaborators: readonly Collaborator[]) => T): T;
/**
 * Runs `listener` for each `name` broadcast another person sends while
 * mounted, with the payload and who sent it:
 * `useBroadcast("buzz", (payload, from) => flash(from.name))`. Broadcasts
 * are for what happens, documents for what must survive; a listener runs on
 * every other page, so a write in it lands once per viewer.
 */
export declare function useBroadcast(name: string, listener: (payload: JsonValue, from: User) => void): void;
/**
 * Undo and redo this viewer's own changes; all writes from one event handler
 * are one step. While `canEdit` is false, both do nothing and both flags are
 * false.
 */
export declare function useUndo(): {
    undo(): void;
    redo(): void;
    canUndo: boolean;
    canRedo: boolean;
};
export interface SharedStatus {
    /** `connecting` until the shared state has loaded, and again while reconnecting; `disconnected` on a host without collaboration; otherwise the host's connection state. */
    connection: "connecting" | "connected" | "disconnected";
    /** False while loading, in read-only rooms and in outdated builds. Writes are then ignored. */
    canEdit: boolean;
    /** True when a newer build of this artifact is live. Ask the viewer to reload. */
    outdated: boolean;
}
/** Whether the shared state is connected, whether you can edit it, and whether a newer build is live. */
export declare function useSharedStatus(): SharedStatus;
/**
 * Shared state outside React: the same documents, collections, presence,
 * broadcasts, undo and status as the hooks, always current. Use it in a draw
 * loop or in an event listener set up outside a component; in render, use
 * the hooks.
 */
export declare const shared: {
    /** The document at `path`, as `useSharedDoc` gives it; `data` and `exists` read the current state. */
    doc(path: string | null | undefined, defaults?: Fields): SharedDoc;
    /** The collection at `path`, as `useSharedCollection` gives it; `items` reads the current state. */
    collection(path: string | null | undefined): SharedCollection;
    /** This viewer, as `useMe` gives them. */
    readonly me: Collaborator & {
        setPresence(presence: JsonObject | ((current: JsonObject) => JsonObject)): void;
    };
    readonly collaborators: readonly Collaborator[];
    /** Sends `name` with `payload` to everyone else viewing the artifact right now; never saved, never replayed to anyone who arrives later. */
    broadcast(name: string, payload?: JsonValue): void;
    /** Calls `listener` with each `name` broadcast another person sends, as `useBroadcast` does. Returns a function that stops the calls. */
    onBroadcast(name: string, listener: (payload: JsonValue, from: User) => void): () => void;
    readonly status: SharedStatus;
    undo(): void;
    redo(): void;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    /** Calls `listener` after every change to documents, presence, status or history. Returns a function that stops the calls. */
    subscribe(listener: () => void): () => void;
    /** Resolves once the shared state has loaded; until then writes are ignored. */
    ready(): Promise<void>;
};

/** A person, the same shape as the ClickUp kit's `User`. */
export interface User {
    kind: "user";
    id: string;
    name: string;
    /** Link to the person's profile; empty when the host does not name one. */
    url: string;
    /** Avatar URL. */
    image?: string;
}

/** A stored value of mine outside React: `get()`, `set()` and `remove()`. */
export interface MyState<T> {
    /** The stored value, or `initial` while nothing is stored. */
    get(): T;
    /** Replaces the value; a function receives the current one, like a `useState` setter. */
    set(next: T | ((current: T) => T)): void;
    /** Deletes the key; `get()` returns `initial` again. */
    remove(): void;
}
/**
 * A value of mine that survives a reload, `useState` with a key:
 * `const [tab, setTab] = useMyState("tab", "board")`, stored per viewer per
 * artifact as JSON, up to 4,000 characters per key (`set` throws past that).
 * Suspends until the stored value has loaded, so the first render never shows
 * `initial` over a stored value; a key mounted later needs its own
 * `<Suspense>`.
 */
export declare function useMyState<T>(key: string, initial: T): [T, (next: T | ((current: T) => T)) => void];
/**
 * The same value outside React, always current: `myState("tab", "board").get()`
 * in a draw loop or event listener, `.set(v)` to write it, `.remove()` to
 * delete the key. Starts loading the value when called.
 */
export declare function myState<T>(key: string, initial: T): MyState<T>;
export declare function myState<T>(key: string): MyState<T | undefined>;
/** A value the kit keeps for this viewer under a `#` key, which authors are refused; resolves once the stored value has loaded. */
declare function kitState<T>(key: `#${string}`, initial: T): Promise<MyState<T>>;
