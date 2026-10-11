import type { Awareness } from "y-protocols/awareness";
import type { RoomSession } from "../room";
import { hostRoom } from "../room";
import type { User } from "../user";
import { viewer } from "../viewer";
import type { Base, DocumentSnapshot, Leaves, OpaqueY } from "./fields";
import {
  applyPatch,
  baseOf,
  deepEqual,
  isPlainObject,
  normalizePatch,
  own,
} from "./fields";
import type { Opaque } from "./kinds";
import { Mirror, NO_ITEMS } from "./mirror";
import { indexOf, placeAt } from "./order";
import { childDocumentPath, parentCollectionOf, validateName } from "./paths";
import { PresenceStore } from "./presence";
import type { DocData, Fields, SharedStatus } from "./shared";

/** A text control's handle on one field: its value, its edits, and caret anchors that survive remote edits. */
export interface TextBinding {
  editable(): boolean;
  value(): string;
  edit(next: string, caret: number): void;
  anchor(index: number): unknown;
  indexOf(anchor: unknown): number | undefined;
}

/** What a kit binds to for an `opaque(y, of)` field of its own; getters read the current state. */
export interface OpaqueField<T> {
  /** The instance while the field holds an opaque `y` of `of`; otherwise undefined. */
  readonly value: T | undefined;
  /** What the field holds when it is opaque of another `y`/`of`, for the caller's error message. */
  readonly holds: { y: OpaqueY; of: string } | undefined;
  /** False while `value` is undefined, the room is read-only or this build is outdated; true without a value only on a host without collaboration, where edits stay in this tab. */
  readonly canEdit: boolean;
  /** Undefined until the room is open. */
  readonly awareness: Awareness | undefined;
  /** Runs `change` as one transaction the kit's undo ignores, when writes are allowed. */
  write(change: () => void): void;
}

export const NO_DATA: ReadonlyArray<DocData> = Object.freeze([]);

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 10;
const itemsOf = new WeakMap<
  readonly DocumentSnapshot[],
  ReadonlyArray<DocData>
>();

/** Subscription keys beside document and collection paths; `#any` is told on every change. */
export const PRESENCE_KEY = "#presence";
export const STATUS_KEY = "#status";
export const HISTORY_KEY = "#history";
export const ANY_KEY = "#any";

/**
 * Shared state over one room: every write is validated at its call site and
 * applied as its own transaction, and one event handler's writes form one
 * undo step. Listeners subscribe by key, a document or collection path or one
 * of the `#` keys, and are told only when that key changed.
 */
export class SharedStore {
  status: SharedStatus = {
    connection: "connecting",
    canEdit: false,
    outdated: false,
  };
  history = { canUndo: false, canRedo: false };
  readonly presence: PresenceStore;
  private readonly listeners = new Map<string, Set<() => void>>();
  private mirror: Mirror | undefined;
  private grouping = false;

  constructor(
    private readonly session: RoomSession,
    private readonly build: number,
    viewer: User,
  ) {
    this.presence = new PresenceStore(viewer, () =>
      this.notify([PRESENCE_KEY]),
    );
    session.subscribe(() => this.sync());
    this.sync();
  }

  subscribe(key: string, listener: () => void): () => void {
    const listeners = this.listeners.get(key) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  /** Resolves once the room is usable, or has failed to open; it stays resolved. */
  ready(): Promise<void> {
    return this.session.ready();
  }

  /** Throws `ready()` for React to suspend on until the room is usable. */
  suspendUntilSynced(): void {
    if (!this.session.isReady()) {
      throw this.ready();
    }
  }

  /** True on a host without collaboration: no document will ever load, so a text editor edits locally, for this tab. */
  get standalone(): boolean {
    return this.session.state.kind === "unavailable";
  }

  undo(): void {
    if (this.status.canEdit) {
      this.mirror?.undo.undo();
    }
  }

  redo(): void {
    if (this.status.canEdit) {
      this.mirror?.undo.redo();
    }
  }

  /** The document's data, or null when it does not exist. */
  data(path: string): DocData | null {
    return this.mirror?.document(path)?.data ?? null;
  }

  /** The collection's items, one frozen array per collection state. */
  items(path: string): ReadonlyArray<DocData> {
    const snapshots = this.mirror?.collection(path) ?? NO_ITEMS;
    let items = itemsOf.get(snapshots);
    if (!items) {
      items = Object.freeze(snapshots.map((snapshot) => snapshot.data));
      itemsOf.set(snapshots, items);
    }
    return items;
  }

  set(path: string, fields: Fields): void {
    const base = baseOf(fields);
    const patch = documentPatch(fields);
    this.write((mirror) => {
      const current = mirror.document(path)?.data;
      if (current && base?.path === path) {
        for (const key of untouched(patch, base)) {
          const now = own(current, key);
          if (now === undefined) {
            patch.delete(key);
          } else {
            patch.set(key, now);
          }
        }
      }
      const leaves: Leaves = new Map();
      applyPatch(leaves, patch);
      mirror.setDocument(path, leaves, base?.path);
    });
  }

  update(path: string, patch: Fields | ((current: DocData) => Fields)): void {
    const resolved =
      typeof patch === "function" ? patch : intendedPatch(path, patch);
    this.write((mirror) => {
      if (!mirror.has(path)) {
        throw new Error(
          `update() failed: "${path}" does not exist. Create it with set() or add() first, or check exists.`,
        );
      }
      mirror.updateDocument(
        path,
        typeof resolved === "function"
          ? intendedPatch(path, resolved(mirror.document(path)!.data))
          : resolved,
      );
    });
  }

  delete(path: string): void {
    this.write((mirror) => mirror.deleteDocument(path));
  }

  add(collection: string, fields: Fields): string {
    const chosen =
      isPlainObject(fields) && fields.id !== baseOf(fields)?.data.id
        ? fields.id
        : undefined;
    const id =
      chosen === undefined ? generateId() : validateName(chosen, "An id");
    this.set(childDocumentPath(collection, id), fields);
    return id;
  }

  move(collection: string, id: string, target: MoveTarget): void {
    const path = childDocumentPath(collection, id);
    const placement = placementOf(collection, target);
    this.write((mirror) => {
      const items = mirror.collection(collection);
      const at = (member: string) => {
        const snapshot = mirror.document(member);
        return snapshot ? indexOf(items, snapshot) : -1;
      };
      const from = at(path);
      if (from === -1) {
        throw new Error(`move() failed: "${path}" does not exist.`);
      }
      let index: number;
      if ("index" in placement) {
        index = Math.max(0, Math.min(placement.index, items.length - 1));
      } else {
        const to = at(placement.neighbour);
        if (to === -1) {
          throw new Error(
            `move() failed: the neighbour "${placement.neighbour}" does not exist.`,
          );
        }
        if (to === from) {
          return;
        }
        index = (to > from ? to - 1 : to) + (placement.after ? 1 : 0);
      }
      if (index === from) {
        return;
      }
      const { key, repairs } = placeAt(items, from, index);
      for (const write of [{ id, order: key }, ...repairs]) {
        mirror.setOrder(childDocumentPath(collection, write.id), write.order);
      }
    });
  }

  text(path: string, field: string): TextBinding {
    return {
      editable: () => this.mirror?.textAt(path, field) !== undefined,
      value: () => this.mirror?.textAt(path, field)?.toString() ?? "",
      edit: (next, caret) =>
        this.apply((mirror) => mirror.editText(path, field, next, caret)),
      anchor: (index) => this.mirror?.anchor(path, field, index),
      indexOf: (anchor) => (anchor ? this.mirror?.indexOf(anchor) : undefined),
    };
  }

  /** What `field` holds as an opaque field, whatever its labels. */
  opaqueAt(path: string, field: string): Opaque | undefined {
    return this.mirror?.opaqueAt(path, field);
  }

  /** The field for the kit driving an opaque `y` of `of` there; `holds` keeps one object while the labels it names stay. */
  opaque<T>(
    path: string,
    field: string,
    y: OpaqueY,
    of: string,
  ): OpaqueField<T> {
    const store = this;
    const mine = (held: Opaque) => held.y === y && held.of === of;
    let holds: OpaqueField<T>["holds"];
    return {
      get value() {
        const held = store.opaqueAt(path, field);
        return held && mine(held) ? (held.value as T) : undefined;
      },
      get holds() {
        const held = store.opaqueAt(path, field);
        if (!held || mine(held)) {
          return undefined;
        }
        if (holds?.y !== held.y || holds.of !== held.of) {
          holds = { y: held.y, of: held.of };
        }
        return holds;
      },
      get canEdit() {
        return this.value !== undefined
          ? store.status.canEdit
          : store.standalone;
      },
      get awareness() {
        return store.mirror?.room.awareness;
      },
      write: (change) => {
        const mirror = this.mirror;
        if (mirror && this.status.canEdit) {
          mirror.transactOpaque(change);
        }
      },
    };
  }

  /** Runs one change as its own transaction, when writes are allowed. */
  private apply(change: (mirror: Mirror) => void) {
    const mirror = this.mirror;
    if (mirror && this.status.canEdit) {
      mirror.transact(() => change(mirror));
    }
  }

  /** A document write: the first of a tick starts a new undo step and the tick's end closes it; a tick that wrote nothing leaves the previous step open. */
  private write(change: (mirror: Mirror) => void) {
    this.apply((mirror) => {
      if (!this.grouping) {
        this.grouping = true;
        const { undo } = mirror;
        const lastChange = undo.lastChange;
        undo.stopCapturing();
        queueMicrotask(() => {
          this.grouping = false;
          if (undo.lastChange === 0) {
            undo.lastChange = lastChange;
          } else {
            undo.stopCapturing();
          }
        });
      }
      change(mirror);
    });
  }

  /** Follows the session: a new room gets a new mirror and every hook is told; the build is judged once the room has synced. */
  private sync() {
    const state = this.session.state;
    const room = state.kind === "open" ? state.room : undefined;
    const changed = this.mirror?.room !== room;
    if (changed) {
      this.mirror?.dispose();
      this.mirror = room && new Mirror(room, (paths) => this.changed(paths));
      this.presence.bind(room);
    }
    if (this.mirror && room?.status.synced && this.build > 0) {
      this.mirror.watchBuild(this.build);
    }
    const keys = this.refresh();
    this.notify(changed ? this.listeners.keys() : keys);
  }

  /** Notifies the changed documents, their collections, and whatever status and history moved. */
  private changed(paths: ReadonlySet<string>) {
    const keys = this.refresh();
    for (const path of paths) {
      keys.push(path, parentCollectionOf(path));
    }
    this.notify(keys);
  }

  /** Recomputes status and history, keeping their identity while unchanged; returns the keys of what changed. */
  private refresh(): string[] {
    const state = this.session.state;
    const synced =
      state.kind === "open" && state.room.status.synced
        ? state.room.status
        : undefined;
    const outdated = this.mirror?.outdated ?? false;
    const status: SharedStatus = {
      connection: synced
        ? (synced.upstream ?? (synced.connected ? "connected" : "disconnected"))
        : state.kind === "unavailable"
          ? "disconnected"
          : "connecting",
      canEdit: Boolean(synced && !synced.readOnly && !outdated),
      outdated,
    };
    const keys: string[] = [];
    if (!deepEqual(this.status, status)) {
      this.status = status;
      keys.push(STATUS_KEY);
    }
    const history = {
      canUndo: status.canEdit && Boolean(this.mirror?.undo.canUndo()),
      canRedo: status.canEdit && Boolean(this.mirror?.undo.canRedo()),
    };
    if (!deepEqual(this.history, history)) {
      this.history = history;
      keys.push(HISTORY_KEY);
    }
    return keys;
  }

  private notify(keys: Iterable<string>) {
    const changed = new Set(keys);
    if (changed.size > 0) {
      changed.add(ANY_KEY);
    }
    for (const key of changed) {
      this.listeners.get(key)?.forEach((listener) => listener());
    }
  }
}

/** A validated document patch without `id`. */
function documentPatch(patch: unknown): Leaves {
  const leaves = normalizePatch(patch);
  leaves.delete("id");
  return leaves;
}

/** A document patch without the fields a spread of `path`'s snapshot left as they were. */
function intendedPatch(path: string, fields: unknown): Leaves {
  const leaves = documentPatch(fields);
  const base = baseOf(fields);
  if (base?.path === path) {
    for (const key of untouched(leaves, base)) {
      leaves.delete(key);
    }
  }
  return leaves;
}

/** The keys of `patch` still holding what `base` showed. */
function untouched(patch: Leaves, base: Base): string[] {
  const keys: string[] = [];
  for (const [key, value] of patch) {
    if (deepEqual(value, own(base.data, key))) {
      keys.push(key);
    }
  }
  return keys;
}

type MoveTarget = number | { before: string } | { after: string };
type Placement = { index: number } | { neighbour: string; after: boolean };

/** A move target as an index, or a neighbour's path and a side; throws on anything else. */
function placementOf(collection: string, target: MoveTarget): Placement {
  if (typeof target === "number" && Number.isInteger(target)) {
    return { index: target };
  }
  const named: Record<string, unknown> = isPlainObject(target) ? target : {};
  const after = typeof named.before !== "string";
  const id = after ? named.after : named.before;
  if (typeof id !== "string") {
    throw new Error(
      `move() expects an index or { before: id } / { after: id }, got ${JSON.stringify(target)}.`,
    );
  }
  return { neighbour: childDocumentPath(collection, id), after };
}

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  return Array.from(
    bytes,
    (byte) => ID_ALPHABET[byte % ID_ALPHABET.length],
  ).join("");
}

let store: SharedStore | undefined;

/** The page's one store, opened on first use. */
export function getStore(): SharedStore {
  if (!store) {
    const host = globalThis as { __ARTIFACT_BUILD__?: unknown };
    const build = Number(host.__ARTIFACT_BUILD__ ?? 0);
    store = new SharedStore(
      hostRoom(),
      Number.isFinite(build) ? build : 0,
      viewer(),
    );
  }
  return store;
}
