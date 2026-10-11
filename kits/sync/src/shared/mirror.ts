import type * as Y from "yjs";
import type { Room } from "../room";
import type { DocumentSnapshot, LeafStore, Leaves } from "./fields";
import {
  applyPatch,
  deepEqual,
  documentSnapshot,
  ORDER_KEY,
  topOf,
} from "./fields";
import { applyTextDiff, Kinds, type Opaque } from "./kinds";
import { appendKey, compareOrdered, indexOf, rankOf } from "./order";
import { parentCollectionOf } from "./paths";

const REGISTRY_NAME = "#d";
const META_NAME = "#m";
const BUILD_KEY = "build";
const LOCAL_ORIGIN = { origin: "sync" };
/** The origin of writes inside an opaque field, which the kit's undo does not track. */
const OPAQUE_ORIGIN = { origin: "sync:opaque" };
const UNDO_CAPTURE_MS = 500;
/** Changed members a cached collection absorbs one by one before it is rebuilt whole. */
const REBASE_LIMIT = 64;
export const NO_ITEMS: readonly DocumentSnapshot[] = Object.freeze([]);

type DocumentMap = Y.Map<unknown>;

/**
 * One room's documents, the `#d` registry keyed by full path, read through
 * cached snapshots and written with undo over this client's own changes.
 * `onChange` fires after every transaction with the documents it touched,
 * once the undo stack reflects it.
 */
export class Mirror {
  readonly undo: Y.UndoManager;
  /** True once a newer build than this client's is live; it then only reads. */
  outdated = false;
  private readonly kinds: Kinds;
  private readonly registry: Y.Map<DocumentMap>;
  private readonly meta: Y.Map<unknown>;
  /** Each collection's document paths. */
  private readonly members = new Map<string, Set<string>>();
  private readonly documents = new Map<string, DocumentSnapshot | null>();
  private readonly collections = new Map<string, readonly DocumentSnapshot[]>();
  /** Per cached document behind the registry, the top-level fields that changed, or null for all of them. */
  private readonly staleFields = new Map<string, Set<string> | null>();
  /** Per cached collection behind the registry, the members that changed, each with the snapshot the collection holds for it. */
  private readonly staleMembers = new Map<
    string,
    Map<string, DocumentSnapshot | null>
  >();
  /** The documents the current transaction changed, reported once it ends. */
  private readonly touched = new Set<string>();
  private unwatchBuild: (() => void) | undefined;

  constructor(
    readonly room: Room,
    private readonly onChange: (paths: ReadonlySet<string>) => void,
  ) {
    this.kinds = new Kinds(room.Y, room.doc.clientID);
    this.registry = room.doc.getMap(REGISTRY_NAME) as Y.Map<DocumentMap>;
    this.meta = room.doc.getMap(META_NAME);
    this.undo = new room.Y.UndoManager(this.registry, {
      captureTimeout: UNDO_CAPTURE_MS,
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
    this.registry.forEach((_, path) => this.enroll(path));
    this.registry.observeDeep(this.markStale);
    room.doc.on("afterTransaction", this.flush);
  }

  dispose(): void {
    this.registry.unobserveDeep(this.markStale);
    this.unwatchBuild?.();
    this.room.doc.off("afterTransaction", this.flush);
    this.undo.destroy();
  }

  private readonly flush = () => {
    this.onChange(this.touched);
    this.touched.clear();
  };

  private readonly markStale = (
    events: Array<Y.YEvent<Y.AbstractType<unknown>>>,
  ) => {
    for (const event of events) {
      if (event.target === this.registry) {
        for (const [path, change] of event.changes.keys) {
          if (change.action === "delete") {
            this.members.get(parentCollectionOf(path))?.delete(path);
          } else {
            this.enroll(path);
          }
          this.invalidate(path, null);
        }
      } else if (typeof event.path[0] === "string") {
        // A document's own map names the changed fields; a nested type names its field.
        const [path, field] = event.path;
        this.invalidate(
          path,
          field === undefined
            ? (event as Y.YMapEvent<unknown>).keysChanged
            : [String(field)],
        );
      }
    }
  };

  private enroll(path: string) {
    const collection = parentCollectionOf(path);
    const paths = this.members.get(collection) ?? new Set<string>();
    paths.add(path);
    this.members.set(collection, paths);
  }

  /** Notes that `path` changed in the given keys' top-level fields, or in all of them for null. */
  private invalidate(path: string, keys: Iterable<string> | null) {
    this.touched.add(path);
    if (this.documents.has(path)) {
      const fields = this.staleFields.get(path);
      if (keys === null || fields === null) {
        this.staleFields.set(path, null);
      } else {
        const tops = fields ?? new Set<string>();
        for (const key of keys) {
          tops.add(topOf(key));
        }
        this.staleFields.set(path, tops);
      }
    }
    const collection = parentCollectionOf(path);
    if (this.collections.has(collection)) {
      const members =
        this.staleMembers.get(collection) ??
        new Map<string, DocumentSnapshot | null>();
      if (!members.has(path)) {
        members.set(path, this.documents.get(path) ?? null);
      }
      if (members.size > REBASE_LIMIT) {
        this.collections.delete(collection);
        this.staleMembers.delete(collection);
      } else {
        this.staleMembers.set(collection, members);
      }
    }
  }

  has(path: string): boolean {
    return this.registry.has(path);
  }

  /** The document at `path`, or null when it does not exist; unchanged fields keep their objects, and a document that still reads the same keeps its snapshot. */
  document(path: string): DocumentSnapshot | null {
    let snapshot = this.documents.get(path);
    const stale = this.staleFields.get(path);
    if (snapshot === undefined || stale !== undefined) {
      const map = this.registry.get(path);
      const previous =
        snapshot && stale ? { data: snapshot.data, changed: stale } : undefined;
      const rebuilt = map
        ? documentSnapshot(
            path,
            this.fieldsOf(map, previous?.changed),
            previous,
          )
        : null;
      if (
        !snapshot ||
        rebuilt?.data !== snapshot.data ||
        rebuilt.order !== snapshot.order
      ) {
        snapshot = rebuilt;
      }
      this.staleFields.delete(path);
      this.documents.set(path, snapshot);
    }
    return snapshot;
  }

  /** The direct children of `path`, in order; unchanged members keep their snapshots. */
  collection(path: string): readonly DocumentSnapshot[] {
    let items = this.collections.get(path);
    const stale = this.staleMembers.get(path);
    if (items === undefined || stale !== undefined) {
      items =
        (items && stale && this.rebased(items, stale)) ?? this.built(path);
      this.staleMembers.delete(path);
      this.collections.set(path, items);
    }
    return items;
  }

  private built(path: string): readonly DocumentSnapshot[] {
    const items: DocumentSnapshot[] = [];
    for (const member of this.members.get(path) ?? []) {
      const snapshot = this.document(member);
      if (snapshot) {
        items.push(snapshot);
      }
    }
    return items.length === 0
      ? NO_ITEMS
      : Object.freeze(items.sort(compareOrdered));
  }

  /** `items` with each changed member replaced, moved, inserted or dropped in place, `items` itself when none changed; undefined once they no longer match. */
  private rebased(
    items: readonly DocumentSnapshot[],
    members: Map<string, DocumentSnapshot | null>,
  ): readonly DocumentSnapshot[] | undefined {
    let next: DocumentSnapshot[] | undefined;
    for (const [path, previous] of members) {
      const snapshot = this.document(path);
      if (snapshot === previous) {
        continue;
      }
      next ??= [...items];
      if (previous) {
        const index = indexOf(next, previous);
        if (index === -1) {
          return undefined;
        }
        if (snapshot?.order === previous.order) {
          next[index] = snapshot;
          continue;
        }
        next.splice(index, 1);
      }
      if (snapshot) {
        next.splice(rankOf(next, snapshot), 0, snapshot);
      }
    }
    if (!next) {
      return items;
    }
    return next.length === 0 ? NO_ITEMS : Object.freeze(next);
  }

  /** The text a field holds, or undefined when it holds anything else. */
  textAt(path: string, field: string): Y.Text | undefined {
    const value = this.registry.get(path)?.get(field);
    return value instanceof this.room.Y.Text ? value : undefined;
  }

  /** The opaque field a field holds, its labels and Y type, or undefined when it holds anything else. */
  opaqueAt(path: string, field: string): Opaque | undefined {
    return this.kinds.opaqueOf(this.registry.get(path)?.get(field));
  }

  /** A place in a text that survives edits around it. */
  anchor(path: string, field: string, index: number): unknown {
    const text = this.textAt(path, field);
    return text && this.room.Y.createRelativePositionFromTypeIndex(text, index);
  }

  indexOf(anchor: unknown): number | undefined {
    return this.room.Y.createAbsolutePositionFromRelativePosition(
      anchor as Y.RelativePosition,
      this.room.doc,
    )?.index;
  }

  /** Runs `change` as one transaction, undoable where it touches documents. */
  transact(change: () => void): void {
    this.room.doc.transact(change, LOCAL_ORIGIN);
  }

  /** Runs `change` as one transaction the kit's undo ignores. */
  transactOpaque(change: () => void): void {
    this.room.doc.transact(change, OPAQUE_ORIGIN);
  }

  /** Writes `fields` into the existing document's map as `update()` would and removes every field it does not name; an equal set writes nothing. A missing document is created, a plain value taking the kind `kindsLike` holds for that field. */
  setDocument(path: string, fields: Leaves, kindsLike?: string): void {
    const existing = this.registry.get(path);
    if (!existing) {
      fields.set(ORDER_KEY, this.orderOf(path));
      const kinds = kindsLike ? this.registry.get(kindsLike) : undefined;
      this.registry.set(path, this.mapOf(fields, kinds));
      return;
    }
    const leaves = this.leavesOf(existing);
    for (const key of [...existing.keys()]) {
      if (!key.startsWith("#") && !fields.has(key)) {
        leaves.delete(key);
      }
    }
    for (const [key, leaf] of fields) {
      leaves.set(key, leaf);
    }
  }

  /** Merges into an existing document, touching only the fields the patch names; a patch that cannot apply writes nothing. */
  updateDocument(path: string, patch: Leaves): void {
    const map = this.registry.get(path);
    if (map) {
      applyPatch(this.fieldsOf(map), patch);
      applyPatch(this.leavesOf(map), patch);
    }
  }

  /** Deletes the document and every descendant document. */
  deleteDocument(path: string): void {
    const doomed = [path];
    const under = `${path}/`;
    for (const [collection, paths] of this.members) {
      if (collection.startsWith(under)) {
        doomed.push(...paths);
      }
    }
    for (const key of doomed) {
      this.registry.delete(key);
    }
  }

  setOrder(path: string, order: string): void {
    this.registry.get(path)?.set(ORDER_KEY, order);
  }

  /** Applies one edit as the minimal diff; nothing when the field holds no text. */
  editText(path: string, field: string, next: string, caret: number): void {
    const text = this.textAt(path, field);
    if (text) {
      applyTextDiff(text, next, caret);
    }
  }

  /** Keeps `#m.build` at the newest live build, when this client may write; `outdated` once a build above `build` is live. Watches once. */
  watchBuild(build: number): void {
    if (this.unwatchBuild) {
      return;
    }
    const reconcile = () => {
      const live = Number(this.meta.get(BUILD_KEY) ?? 0);
      if (live > build) {
        this.outdated = true;
      } else if (live < build && !this.room.status.readOnly) {
        this.transact(() => this.meta.set(BUILD_KEY, build));
      }
    };
    this.meta.observe(reconcile);
    this.unwatchBuild = () => this.meta.unobserve(reconcile);
    reconcile();
  }

  /** The document's current order key, or one after the last item of its collection. */
  private orderOf(path: string): string {
    const current = this.registry.get(path)?.get(ORDER_KEY);
    return typeof current === "string"
      ? current
      : appendKey(this.collection(parentCollectionOf(path)));
  }

  /** The live map as a patch's target: reads are JSON; a write a field's kind accepts is applied to it, an equal write is skipped, anything else replaces the field. */
  private leavesOf(map: DocumentMap): LeafStore {
    const { kinds } = this;
    return {
      keys: () => map.keys(),
      has: (key) => map.has(key),
      get: (key) => kinds.read(map.get(key)),
      set: (key, leaf) => {
        const current = map.get(key);
        const kind = kinds.kindOf(current);
        if (kind?.accepts(leaf, current)) {
          kind.apply(current, leaf);
        } else if (!deepEqual(kinds.read(current), leaf)) {
          map.set(key, kinds.stored(leaf, kinds.read(current)));
        }
      },
      delete: (key) => map.delete(key),
    };
  }

  /** A map's entries as JSON, every nested type read as its plain value; with `tops`, only the `#` keys and the leaves under those top-level fields. */
  private fieldsOf(map: DocumentMap, tops?: ReadonlySet<string>): Leaves {
    const fields: Leaves = new Map();
    map.forEach((value, key) => {
      if (!tops || key.startsWith("#") || tops.has(topOf(key))) {
        fields.set(key, this.kinds.read(value));
      }
    });
    return fields;
  }

  /** A new document's map of `fields`; a plain value for a field `kinds`, the document it was spread from, holds as a nested type recreates that kind over a copy of the type there. */
  private mapOf(fields: Leaves, kinds?: DocumentMap): DocumentMap {
    const map = new this.room.Y.Map<unknown>();
    for (const [key, value] of fields) {
      const current = kinds?.get(key);
      const kind = this.kinds.kindOf(current);
      const leaf = kind?.recreate(value) ?? value;
      map.set(key, this.kinds.stored(leaf, kind ? current : undefined));
    }
    return map;
  }
}
