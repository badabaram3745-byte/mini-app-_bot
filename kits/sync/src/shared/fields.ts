import { idOfDocument, validateName } from "./paths";
import type { DocData, JsonValue } from "./shared";
import { warnOnce } from "./warn";

/** A document's fields as one flat map of dotted keys to JSON leaves, with Firestore's patch semantics; an empty nested object is itself a `{}` leaf, and the kit's own `#o` holds the document's place in its collection. */
export type Leaves = Map<string, unknown>;

export const ORDER_KEY = "#o";

/** The enumerable symbol every read carries its snapshot on; a spread copies it along. */
const BASE = Symbol.for("sync.base");

export interface Base {
  readonly path: string;
  readonly data: DocData;
}

type Stamped = { [BASE]?: Base };

/** Marks `data`, before it is frozen, as the read of `path`. */
function stamp(path: string, data: Record<string, unknown>): void {
  (data as Stamped)[BASE] = { path, data: data as DocData };
}

/** The snapshot `fields` was spread from, if any. */
export function baseOf(fields: unknown): Base | undefined {
  return isPlainObject(fields) ? (fields as Stamped)[BASE] : undefined;
}

/** What an absent document reads as: just its `id`. */
export function emptyDocument(path: string): DocData {
  const data: Record<string, unknown> = { id: idOfDocument(path) };
  stamp(path, data);
  return Object.freeze(data) as DocData;
}

/** The patch markers, each an object of one `#` key. */
export interface DeleteMarker {
  readonly "#delete": true;
}

export interface TextMarker {
  readonly "#text": string;
}

/** The Y type an opaque field holds for the kit that drives it. */
export type OpaqueY = "xml" | "map";

/** An element of an `"xml"` seed. */
export interface OpaqueElement {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, JsonValue>>;
  readonly children?: readonly OpaqueNode[];
}

/** One run of a text with its formatting, as a `Y.Text` delta insert. */
export interface OpaqueTextRun {
  readonly insert: string;
  readonly attributes?: Readonly<Record<string, JsonValue>>;
}

/** A text of an `"xml"` seed. */
export interface OpaqueText {
  readonly text: readonly OpaqueTextRun[];
}

export type OpaqueNode = OpaqueElement | OpaqueText;

/** What an opaque field is created holding: the nodes of an `"xml"` fragment, or the records of a `"map"` by key. */
export type OpaqueSeed =
  | readonly OpaqueNode[]
  | Readonly<Record<string, JsonValue>>;

export interface OpaqueMarker {
  readonly "#opaque": {
    readonly y: OpaqueY;
    readonly of: string;
    readonly seed?: OpaqueSeed;
  };
}

export interface IncrementMarker {
  readonly "#increment": number;
}

export interface UnionMarker {
  readonly "#union": JsonValue[];
}

export interface RemoveMarker {
  readonly "#remove": JsonValue[];
}

export type Marker =
  | DeleteMarker
  | TextMarker
  | OpaqueMarker
  | IncrementMarker
  | UnionMarker
  | RemoveMarker;
export type MarkerKey =
  | "#delete"
  | "#text"
  | "#opaque"
  | "#increment"
  | "#union"
  | "#remove";

const DELETE: DeleteMarker = Object.freeze({ "#delete": true as const });

export function deleteField(): DeleteMarker {
  return DELETE;
}

export function sharedText(initial = ""): TextMarker {
  if (typeof initial !== "string") {
    throw new Error(
      `sharedText() expects a string to start with, got ${describe(initial)}.`,
    );
  }
  return Object.freeze({ "#text": initial });
}

/** Marker creating an opaque field: a Y type the owning kit drives, `of` naming that kit's library and only ever compared. `seed` is written into the payload as it is created, never into a field already holding these labels. */
export function opaque(
  y: OpaqueY,
  of: string,
  seed?: OpaqueSeed,
): OpaqueMarker {
  if (!isOpaqueLabels({ y, of })) {
    throw new Error(
      `opaque() expects "xml" or "map" and the name of the library driving it, got ${JSON.stringify(y)} and ${JSON.stringify(of)}.`,
    );
  }
  if (seed !== undefined && !isOpaqueSeed(y, seed)) {
    throw new Error(
      y === "xml"
        ? `opaque("xml", …) starts with an array of nodes, each { type, attrs?, children? } or { text }, got ${describe(seed)}.`
        : `opaque("map", …) starts with an object of records by key, got ${describe(seed)}.`,
    );
  }
  return Object.freeze({
    "#opaque": Object.freeze(seed === undefined ? { y, of } : { y, of, seed }),
  });
}

/** True for a Y type name and a non-empty library name, the labels of an opaque field. */
export function isOpaqueLabels(
  value: unknown,
): value is { y: OpaqueY; of: string } {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === 2 &&
    (value.y === "xml" || value.y === "map") &&
    typeof value.of === "string" &&
    value.of.length > 0
  );
}

/** True for an opaque marker's payload: the labels, with a seed of the Y type's shape or none. */
function isOpaquePayload(value: unknown): value is OpaqueMarker["#opaque"] {
  if (!isPlainObject(value)) {
    return false;
  }
  const { seed, ...labels } = value;
  return (
    isOpaqueLabels(labels) &&
    (seed === undefined || isOpaqueSeed(labels.y, seed))
  );
}

function isOpaqueSeed(y: OpaqueY, seed: unknown): seed is OpaqueSeed {
  return y === "map" ? isPlainObject(seed) : Array.isArray(seed);
}

export function increment(by: number): IncrementMarker {
  if (typeof by !== "number" || !Number.isFinite(by)) {
    throw new Error(
      `increment() expects a finite number, got ${describe(by)}.`,
    );
  }
  return Object.freeze({ "#increment": by });
}

export function arrayUnion(...values: JsonValue[]): UnionMarker {
  return Object.freeze({ "#union": values });
}

export function arrayRemove(...values: JsonValue[]): RemoveMarker {
  return Object.freeze({ "#remove": values });
}

/** Per marker key: the function that makes it, what its payload must be, and what a field created from it reads as. */
const MARKERS = new Map<
  MarkerKey,
  {
    name: string;
    valid(payload: unknown): boolean;
    reads(payload: unknown): unknown;
  }
>([
  [
    "#delete",
    { name: "deleteField()", valid: (p) => p === true, reads: () => undefined },
  ],
  [
    "#text",
    {
      name: "sharedText()",
      valid: (p) => typeof p === "string",
      reads: (p) => p,
    },
  ],
  [
    "#opaque",
    {
      name: "opaque()",
      valid: isOpaquePayload,
      reads: (p) => {
        const { y, of } = p as OpaqueMarker["#opaque"];
        return opaque(y, of);
      },
    },
  ],
  [
    "#increment",
    { name: "increment()", valid: Number.isFinite, reads: (p) => p },
  ],
  [
    "#union",
    {
      name: "arrayUnion()",
      valid: Array.isArray,
      reads: (p) => distinct(p as JsonValue[]),
    },
  ],
  ["#remove", { name: "arrayRemove()", valid: Array.isArray, reads: () => [] }],
]);

/** The key of the marker `value` is, or undefined for anything else. */
export function markerOf(value: unknown): MarkerKey | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const keys = Object.keys(value);
  const key = keys[0] as MarkerKey;
  return keys.length === 1 && MARKERS.get(key)?.valid(value[key])
    ? key
    : undefined;
}

/** What a field created from the marker `value`, of the given `key`, reads as; a `deleteField()` reads as nothing. */
export function markerReads(key: MarkerKey, value: unknown): unknown {
  return MARKERS.get(key)!.reads((value as Record<string, unknown>)[key]);
}

/** `values` without repeats by canonical JSON, the first of each kept. */
export function distinct(values: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = canonicalKey(value);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** One string per JSON value, the same for equal values: object keys sorted at every level. */
export function canonicalKey(value: unknown): string {
  return JSON.stringify(value, (_, node: unknown) =>
    isPlainObject(node)
      ? Object.fromEntries(
          Object.keys(node)
            .sort()
            .map((key) => [key, node[key]]),
        )
      : node,
  );
}

/** A validated copy of a patch, `undefined` values skipped and every other value JSON or a marker; throws before anything is written. */
export function normalizePatch(patch: unknown): Leaves {
  const marker = markerOf(patch);
  if (marker) {
    const { name } = MARKERS.get(marker)!;
    throw new Error(
      `Expected an object of fields like { title: ${name} }, got ${name} on its own.`,
    );
  }
  if (!isPlainObject(patch)) {
    throw new Error(
      `Expected an object of fields like { title: "…" }, got ${describe(patch)}.`,
    );
  }
  const fields: Leaves = new Map();
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) {
      continue;
    }
    validateField(key);
    fields.set(key, normalizeLeaf(value, key));
  }
  return fields;
}

/** A marker as is, its values checked as JSON where it carries some; anything else as JSON. */
function normalizeLeaf(value: unknown, key: string): unknown {
  const marker = markerOf(value);
  if (marker === "#union" || marker === "#remove") {
    const values = (value as Record<string, unknown>)[marker];
    return Object.freeze({ [marker]: jsonValue(values, key) as JsonValue[] });
  }
  if (marker === "#opaque") {
    const { y, of, seed } = (value as OpaqueMarker)["#opaque"];
    return seed === undefined
      ? value
      : opaque(y, of, jsonValue(seed, key) as OpaqueSeed);
  }
  return marker ? value : jsonValue(value, key);
}

/** A `/`, a `#` or an empty segment anywhere in a dotted field key. */
const INVALID_FIELD = /[/#]|^\.|\.\.|\.$/;
/** A segment of a dotted field key that a missing value stringified to. */
const MISSING_FIELD =
  /(?:^|\.)(?:undefined|null|NaN|\[object Object\])(?:\.|$)/;

function validateField(key: string) {
  if (key.length === 0) {
    throw new Error("A field name must be a non-empty string.");
  }
  if (INVALID_FIELD.test(key)) {
    throw new Error(
      `The field "${key}" may not contain "/" or "#", or start or end with ".".`,
    );
  }
  if (MISSING_FIELD.test(key)) {
    throw new Error(
      `The field "${key}" has a missing value in it; check the variable it was built from.`,
    );
  }
}

/** The dotted keys, bucketed by their number of dots. */
type Dotted = string[][];

/** Where a patch lands: the leaves of a document, read as JSON; a plain `Map` or a live document. */
export interface LeafStore {
  keys(): Iterable<string>;
  has(key: string): boolean;
  get(key: string): unknown;
  set(key: string, leaf: unknown): void;
  delete(key: string): void;
}

/** Applies `patch` key by key; a later key wins where two overlap. Only the keys the patch touches are written. */
export function applyPatch(fields: LeafStore, patch: Leaves): void {
  const dotted: Dotted = [];
  for (const key of fields.keys()) {
    noteDotted(dotted, key);
  }
  for (const [path, value] of patch) {
    if (markerOf(value) === "#delete") {
      deleteLeaf(fields, dotted, path);
    } else {
      setLeaf(fields, dotted, path, value);
    }
  }
}

/** Removes a key and everything beneath it; a nested object left empty stays `{}`, as in Firestore. */
function deleteLeaf(fields: LeafStore, dotted: Dotted, path: string) {
  const under = keysUnder(fields, dotted, path);
  const removed = fields.has(path) || under.length > 0;
  for (const key of [path, ...under]) {
    fields.delete(key);
  }
  const dot = path.lastIndexOf(".");
  if (removed && dot !== -1) {
    const parent = path.slice(0, dot);
    if (
      !fields.has(parent) &&
      keysUnder(fields, dotted, parent, 1).length === 0
    ) {
      fields.set(parent, {});
    }
  }
}

/** Replaces a key and everything beneath it with the leaves of `value`; anything in the way above it goes, except an array, which is a single value. */
function setLeaf(
  fields: LeafStore,
  dotted: Dotted,
  path: string,
  value: unknown,
) {
  for (
    let dot = path.indexOf(".");
    dot !== -1;
    dot = path.indexOf(".", dot + 1)
  ) {
    const prefix = path.slice(0, dot);
    if (Array.isArray(fields.get(prefix))) {
      throw new Error(
        `Cannot update "${path}": "${prefix}" is an array. Arrays are single values; update the whole array, or use a keyed object or a subcollection for independently collaborative items.`,
      );
    }
    fields.delete(prefix);
  }
  const leaves: Leaves = new Map();
  forEachLeaf(path, value, (key, leaf) => leaves.set(key, leaf));
  for (const key of [path, ...keysUnder(fields, dotted, path)]) {
    if (!leaves.has(key)) {
      fields.delete(key);
    }
  }
  for (const [key, leaf] of leaves) {
    fields.set(key, leaf);
    noteDotted(dotted, key);
  }
}

/** The keys still present beneath `path`, at most `limit` of them. */
function keysUnder(
  fields: LeafStore,
  dotted: Dotted,
  path: string,
  limit = Infinity,
): string[] {
  const keys: string[] = [];
  for (let depth = countDots(path) + 1; depth < dotted.length; depth += 1) {
    for (const key of dotted[depth] ?? []) {
      if (fields.has(key) && isUnder(path, key) && keys.push(key) === limit) {
        return keys;
      }
    }
  }
  return keys;
}

function isUnder(path: string, key: string): boolean {
  return key.startsWith(path) && key[path.length] === ".";
}

function noteDotted(dotted: Dotted, key: string) {
  const depth = countDots(key);
  if (depth > 0) {
    (dotted[depth] ??= []).push(key);
  }
}

function countDots(key: string): number {
  let count = 0;
  for (
    let dot = key.indexOf(".");
    dot !== -1;
    dot = key.indexOf(".", dot + 1)
  ) {
    count += 1;
  }
  return count;
}

/** Calls `each` with `value` as dotted leaves under `path`; an empty object is itself a `{}` leaf, a marker stays whole. */
function forEachLeaf(
  path: string,
  value: unknown,
  each: (key: string, leaf: unknown) => void,
) {
  if (!isPlainObject(value) || markerOf(value)) {
    each(path, value);
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    each(path, {});
  }
  for (const key of keys) {
    forEachLeaf(`${path}.${key}`, value[key], each);
  }
}

/** Sets `value` at the dotted `key` in `root`, creating objects on the way; keys must arrive sorted. A scalar in the way of nested keys loses to them, and `onConflict` names the field. */
function nest(
  root: Record<string, unknown>,
  key: string,
  value: unknown,
  onConflict: (field: string) => void,
): void {
  let node = root;
  let start = 0;
  for (let dot = key.indexOf("."); dot !== -1; dot = key.indexOf(".", start)) {
    const segment = key.slice(start, dot);
    const existing = own(node, segment);
    if (isPlainObject(existing)) {
      node = existing;
    } else {
      if (existing !== undefined) {
        onConflict(topOf(key));
      }
      node = setOwn(node, segment, {});
    }
    start = dot + 1;
  }
  setOwn(node, key.slice(start), value);
}

function sortedFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(fields).sort()) {
    if (key !== "id") {
      setOwn(ordered, key, fields[key]);
    }
  }
  return ordered;
}

function onlyMeta(fields: ReadonlySet<string>): boolean {
  for (const field of fields) {
    if (!field.startsWith("#")) {
      return false;
    }
  }
  return true;
}

/** The first segment of a dotted key. */
export function topOf(key: string): string {
  const dot = key.indexOf(".");
  return dot === -1 ? key : key.slice(0, dot);
}

export interface DocumentSnapshot {
  readonly id: string;
  readonly order: string;
  readonly data: DocData;
}

/** A document's last data and the top-level fields that changed since. */
export interface Previous {
  readonly data: DocData;
  readonly changed: ReadonlySet<string>;
}

/**
 * A frozen read of one document: `#` keys stripped, dotted keys nested, `id`
 * attached. Given `previous`, `fields` holds only the leaves of its changed
 * top-level fields; every other field keeps its object, and data that still
 * reads the same keeps its identity.
 */
export function documentSnapshot(
  path: string,
  fields: Leaves,
  previous?: Previous,
): DocumentSnapshot {
  const id = idOfDocument(path);
  const order = fields.get(ORDER_KEY);
  let data = previous && onlyMeta(previous.changed) ? previous.data : undefined;
  if (!data) {
    const built: Record<string, unknown> = { ...previous?.data };
    for (const top of previous?.changed ?? []) {
      delete built[top];
    }
    const onConflict = (field: string) =>
      warnOnce(
        `conflict:${path}:${field}`,
        `"${field}" on "${path}" is stored both as a value and as nested fields; the nested fields win. Use a new field name when a field changes type.`,
      );
    for (const key of [...fields.keys()].sort()) {
      if (!key.startsWith("#")) {
        nest(built, key, jsonClone(fields.get(key)), onConflict);
      }
    }
    if (
      previous &&
      [...previous.changed].every((top) =>
        deepEqual(own(built, top), own(previous.data, top)),
      )
    ) {
      data = previous.data;
    } else {
      const ordered = previous ? sortedFields(built) : built;
      setOwn(ordered, "id", id);
      stamp(path, ordered);
      data = deepFreeze(ordered) as DocData;
    }
  }
  return { id, order: typeof order === "string" ? order : "", data };
}

/** `data` with `defaults` filling the top-level fields it lacks; a marker default reads as the field it would create. */
export function withDefaults(
  data: DocData,
  defaults: Readonly<Record<string, unknown>> = {},
): DocData {
  let filled: Record<string, unknown> | undefined;
  for (const key of Object.keys(defaults)) {
    const value = defaults[key];
    const marker = markerOf(value);
    const read = marker ? markerReads(marker, value) : jsonClone(value);
    if (own(data, key) === undefined && read !== undefined) {
      filled ??= { ...data };
      setOwn(filled, key, read);
    }
  }
  if (!filled) {
    return data;
  }
  const base = baseOf(data);
  if (base) {
    stamp(base.path, filled);
  }
  return deepFreeze(filled) as DocData;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => deepEqual(a[key], own(b, key)))
    );
  }
  return false;
}

/** Freezes `value` and everything in it; a frozen object is taken as already deep-frozen. */
export function deepFreeze<T>(value: T): T {
  if (Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    Object.freeze(value);
  } else if (isPlainObject(value)) {
    for (const key in value) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function own(object: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(object, key)
    ? object[key]
    : undefined;
}

/** Sets an own enumerable property, defining a `__proto__` key rather than assigning it. */
function setOwn<T>(object: Record<string, unknown>, key: string, value: T): T {
  if (key === "__proto__") {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  } else {
    object[key] = value;
  }
  return value;
}

/** A JSON-only copy of a plain object; throws naming `what` on anything else. */
export function jsonObject(
  value: unknown,
  what: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${what} must be a plain object, got ${describe(value)}.`);
  }
  return jsonValue(value, what) as Record<string, unknown>;
}

/** A JSON-only copy of `value`; throws naming `field` on anything JSON cannot carry. */
export function jsonValue(value: unknown, field: string): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `"${field}" is ${value}; only finite numbers can be stored.`,
      );
    }
    return value;
  }
  const marker = markerOf(value);
  if (marker) {
    const { name } = MARKERS.get(marker)!;
    throw new Error(
      `"${field}" holds ${name} inside an object; markers must be top-level values, like { "${field}": ${name} }.`,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item === undefined) {
        throw new Error(
          `"${field}[${index}]" is undefined; arrays cannot hold undefined.`,
        );
      }
      return jsonValue(item, `${field}[${index}]`);
    });
  }
  if (isPlainObject(value)) {
    rejectClickUpAsset(value, field);
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined) {
        validateName(key, `In "${field}", the field`);
        setOwn(copy, key, jsonValue(value[key], `${field}.${key}`));
      }
    }
    return copy;
  }
  throw new Error(
    `"${field}" is ${describe(value)}; only JSON values (strings, numbers, booleans, null, arrays and plain objects) can be stored. Store dates as ISO strings or numbers.`,
  );
}

function rejectClickUpAsset(
  value: Record<string, unknown>,
  field: string,
): void {
  if (isClickUpAsset(value)) {
    throw new Error(
      `"${field}" is a ClickUp ${value.kind}; ClickUp data never goes into shared state, where every viewer can read it. Store its id and fetch it with @kits/clickup.`,
    );
  }
}

/** The `kind` of every ClickUp kit asset that carries what only the viewer may see. */
const CLICKUP_KINDS = new Set([
  "space",
  "folder",
  "list",
  "status",
  "customField",
  "task",
  "taskType",
  "comment",
  "inboxBundle",
  "reminder",
]);

/** Whether `value` has the shape of a ClickUp kit asset; a person is not one. */
function isClickUpAsset(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { kind: string } {
  return (
    typeof value.kind === "string" &&
    CLICKUP_KINDS.has(value.kind) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.url === "string"
  );
}

function jsonClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(jsonClone);
  }
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      setOwn(copy, key, jsonClone(value[key]));
    }
    return copy;
  }
  return value;
}

/** `value` for an error message: `null`, `NaN`, `a string`, `an Array`, `a Date`. */
export function describe(value: unknown): string {
  if (value == null || (typeof value === "number" && !Number.isFinite(value))) {
    return String(value);
  }
  if (typeof value !== "object") {
    return withArticle(typeof value);
  }
  const name = (value as object).constructor?.name;
  return withArticle(name && name !== "Object" ? name : "object");
}

function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}
