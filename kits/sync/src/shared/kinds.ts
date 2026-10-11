import type * as Y from "yjs";
import {
  arrayUnion,
  canonicalKey,
  distinct,
  increment,
  isOpaqueLabels,
  markerOf,
  opaque,
  sharedText,
  type IncrementMarker,
  type Marker,
  type MarkerKey,
  type OpaqueMarker,
  type OpaqueNode,
  type OpaqueSeed,
  type OpaqueY,
  type RemoveMarker,
  type TextMarker,
  type UnionMarker,
} from "./fields";
import type { JsonValue } from "./shared";

/**
 * A field kind stored as a nested Yjs type inside a document's map and read
 * as plain JSON: a marker creates one, a marker or a plain value of the
 * kind's own shape is applied as a change to it, and a value of another shape
 * replaces it.
 */
export interface FieldKind {
  /** True when `value` is this kind's nested type. */
  is(value: unknown): boolean;
  read(value: unknown): unknown;
  /** True when `leaf`, a marker or a plain value, is a change this kind applies to `current`, its existing type. */
  accepts(leaf: unknown, current: unknown): boolean;
  apply(value: unknown, leaf: unknown): void;
  /** A fresh nested type from this kind's marker over `current`: a plain value, or another document's nested type. */
  create(marker: Marker, current: unknown): unknown;
  /** A plain value of this kind's shape as the marker that recreates it. */
  recreate(plain: unknown): Marker | undefined;
}

/** The key inside a nested map that names its kind; never a client id or a value. */
const TAG = "#";
/** An opaque wrapper's keys: its labels and the Y type they describe. */
const Y_KEY = "y";
const OF_KEY = "of";
const VALUE_KEY = "v";

/** What an opaque field holds: its labels and the Y type the owning kit drives. */
export interface Opaque {
  readonly y: OpaqueY;
  readonly of: string;
  readonly value: Y.XmlFragment | Y.Map<unknown>;
}

export class Kinds {
  /** What a stored value holds as an opaque field, or undefined for anything else. */
  readonly opaqueOf: (value: unknown) => Opaque | undefined;
  private readonly all: readonly FieldKind[];
  private readonly byMarker: ReadonlyMap<MarkerKey, FieldKind>;

  /**
   * @param clientID This client's Yjs id, the key it owns inside every counter.
   */
  constructor(
    private readonly yjs: typeof Y,
    clientID: number,
  ) {
    const tagged = (value: unknown, tag: string) =>
      value instanceof yjs.Map && value.get(TAG) === tag;
    const sum = (map: Y.Map<unknown>) => {
      let total = 0;
      map.forEach((value, key) => {
        if (key !== TAG && typeof value === "number") {
          total += value;
        }
      });
      return total;
    };
    const bump = (map: Y.Map<unknown>, by: number) => {
      const mine = String(clientID);
      map.set(mine, (Number(map.get(mine)) || 0) + by);
    };
    type Element = [stamp: number, value: unknown];
    const isElement = (value: unknown): value is Element =>
      Array.isArray(value) && typeof value[0] === "number";
    /** A set's elements by key, in the map's own order. */
    const elements = (map: Y.Map<unknown>) => {
      const list: Array<[key: string, element: Element]> = [];
      map.forEach((value, key) => {
        if (key !== TAG && isElement(value)) {
          list.push([key, value]);
        }
      });
      return list;
    };
    /** A set's elements oldest first, ties by key. */
    const stamped = (map: Y.Map<unknown>) =>
      elements(map).sort(
        ([x, [a]], [y, [b]]) => a - b || (x < y ? -1 : x > y ? 1 : 0),
      );
    /** A stamp after every element's. */
    const nextStamp = (map: Y.Map<unknown>) => {
      let stamp = Date.now();
      map.forEach((value) => {
        if (isElement(value)) {
          stamp = Math.max(stamp, value[0] + 1);
        }
      });
      return stamp;
    };
    /** Adds the values not yet present, stamped after every element there. */
    const addAll = (map: Y.Map<unknown>, values: readonly unknown[]) => {
      let stamp = nextStamp(map);
      for (const value of values) {
        const key = canonicalKey(value);
        if (!map.has(key)) {
          map.set(key, [stamp, value]);
          stamp += 1;
        }
      }
    };
    const text: FieldKind = {
      is: (value) => value instanceof yjs.Text,
      read: (value) => (value as Y.Text).toString(),
      accepts: (leaf) => typeof leaf === "string" || markerOf(leaf) === "#text",
      apply: (value, leaf) =>
        applyTextDiff(
          value as Y.Text,
          typeof leaf === "string" ? leaf : (leaf as TextMarker)["#text"],
        ),
      create: (marker) => new yjs.Text((marker as TextMarker)["#text"]),
      recreate: (plain) =>
        typeof plain === "string" ? sharedText(plain) : undefined,
    };
    const unwrap = (value: unknown): Opaque | undefined => {
      if (!tagged(value, "opaque")) {
        return undefined;
      }
      const wrapper = value as Y.Map<unknown>;
      const labels = { y: wrapper.get(Y_KEY), of: wrapper.get(OF_KEY) };
      if (!isOpaqueLabels(labels)) {
        return undefined;
      }
      const held = wrapper.get(VALUE_KEY);
      const holdsY =
        labels.y === "xml"
          ? held instanceof yjs.XmlFragment
          : held instanceof yjs.Map;
      return holdsY ? { ...labels, value: held as Opaque["value"] } : undefined;
    };
    /** A new Y type of `y` holding `seed`, filled before it joins the document. */
    const fresh = (y: OpaqueY, seed: OpaqueSeed | undefined) => {
      if (y === "map") {
        return new yjs.Map<unknown>(Object.entries(seed ?? {}));
      }
      const fragment = new yjs.XmlFragment();
      fragment.insert(0, ((seed ?? []) as readonly OpaqueNode[]).map(nodeOf));
      return fragment;
    };
    const nodeOf = (node: OpaqueNode): Y.XmlElement | Y.XmlText => {
      if ("text" in node) {
        const text = new yjs.XmlText();
        text.applyDelta([...node.text]);
        return text;
      }
      const element = new yjs.XmlElement(node.type);
      // Yjs types attributes as strings but stores any JSON.
      const attributes = element as Y.XmlElement<Record<string, JsonValue>>;
      for (const [name, value] of Object.entries(node.attrs ?? {})) {
        attributes.setAttribute(name, value);
      }
      element.insert(0, (node.children ?? []).map(nodeOf));
      return element;
    };
    /** Nothing written to an opaque field is a change inside it: a marker of its own labels keeps it, seed or none; anything else replaces it. */
    const opaqueKind: FieldKind = {
      is: (value) => unwrap(value) !== undefined,
      read: (value) => {
        const { y, of } = unwrap(value)!;
        return opaque(y, of);
      },
      accepts: (leaf, current) => {
        const held = unwrap(current);
        if (held === undefined || markerOf(leaf) !== "#opaque") {
          return false;
        }
        const { y, of } = (leaf as OpaqueMarker)["#opaque"];
        return held.y === y && held.of === of;
      },
      apply: () => {},
      create: (marker, current) => {
        const { y, of, seed } = (marker as OpaqueMarker)["#opaque"];
        const held = unwrap(current);
        const kept = held?.y === y && held.of === of ? held.value : undefined;
        const wrapper = new yjs.Map<unknown>();
        wrapper.set(TAG, "opaque");
        wrapper.set(Y_KEY, y);
        wrapper.set(OF_KEY, of);
        wrapper.set(VALUE_KEY, kept?.clone() ?? fresh(y, seed));
        return wrapper;
      },
      recreate: (plain) =>
        markerOf(plain) === "#opaque" ? (plain as OpaqueMarker) : undefined,
    };
    const counter: FieldKind = {
      is: (value) => tagged(value, "counter"),
      read: (value) => sum(value as Y.Map<unknown>),
      accepts: (leaf) =>
        typeof leaf === "number" || markerOf(leaf) === "#increment",
      apply: (value, leaf) => {
        const map = value as Y.Map<unknown>;
        const by =
          typeof leaf === "number"
            ? leaf - sum(map)
            : (leaf as IncrementMarker)["#increment"];
        if (by !== 0) {
          bump(map, by);
        }
      },
      create: (marker, current) => {
        const map = new yjs.Map<unknown>();
        map.set(TAG, "counter");
        const start = typeof current === "number" ? current : 0;
        map.set(
          String(clientID),
          start + (marker as IncrementMarker)["#increment"],
        );
        return map;
      },
      recreate: (plain) =>
        typeof plain === "number" ? increment(plain) : undefined,
    };
    const set: FieldKind = {
      is: (value) => tagged(value, "set"),
      read: (value) =>
        stamped(value as Y.Map<unknown>).map(([, [, element]]) => element),
      accepts: (leaf) =>
        Array.isArray(leaf) ||
        markerOf(leaf) === "#union" ||
        markerOf(leaf) === "#remove",
      apply: (value, leaf) => {
        const map = value as Y.Map<unknown>;
        if (Array.isArray(leaf)) {
          const wanted = new Set(leaf.map(canonicalKey));
          for (const [key] of elements(map)) {
            if (!wanted.has(key)) {
              map.delete(key);
            }
          }
          addAll(map, leaf);
        } else if (markerOf(leaf) === "#union") {
          addAll(map, (leaf as UnionMarker)["#union"]);
        } else {
          for (const removed of (leaf as RemoveMarker)["#remove"]) {
            map.delete(canonicalKey(removed));
          }
        }
      },
      create: (marker, current) => {
        const map = new yjs.Map<unknown>();
        map.set(TAG, "set");
        const union = markerOf(marker) === "#union";
        const added = union ? (marker as UnionMarker)["#union"] : [];
        const removed = new Set(
          union ? [] : (marker as RemoveMarker)["#remove"].map(canonicalKey),
        );
        const kept = Array.isArray(current) ? current : [];
        let stamp = Date.now();
        for (const value of distinct([...kept, ...added])) {
          const key = canonicalKey(value);
          if (!removed.has(key)) {
            map.set(key, [stamp, value]);
            stamp += 1;
          }
        }
        return map;
      },
      recreate: (plain) =>
        Array.isArray(plain)
          ? arrayUnion(...(plain as JsonValue[]))
          : undefined,
    };
    this.opaqueOf = unwrap;
    this.all = [text, opaqueKind, counter, set];
    this.byMarker = new Map([
      ["#text", text],
      ["#opaque", opaqueKind],
      ["#increment", counter],
      ["#union", set],
      ["#remove", set],
    ]);
  }

  /** The kind of a stored value, or undefined for a plain JSON value. */
  kindOf(value: unknown): FieldKind | undefined {
    return typeof value === "object" && value !== null
      ? this.all.find((kind) => kind.is(value))
      : undefined;
  }

  /** A stored value as JSON: a kind reads as its plain value, a nested type of no known kind as its `toJSON()`. */
  read(value: unknown): unknown {
    const kind = this.kindOf(value);
    if (kind) {
      return kind.read(value);
    }
    return value instanceof this.yjs.AbstractType ? value.toJSON() : value;
  }

  /** What to store for `leaf`: a marker becomes a fresh nested type over `current`, anything else is stored as is. */
  stored(leaf: unknown, current: unknown): unknown {
    const marker = markerOf(leaf);
    const kind = marker && this.byMarker.get(marker);
    return kind ? kind.create(leaf as Marker, current) : leaf;
  }
}

/** Replaces the smallest span of whole characters that turns the text into `next`; the caret bounds the common prefix so repeated characters resolve near the edit. */
export function applyTextDiff(
  text: Y.Text,
  next: string,
  caret = next.length,
): void {
  const current = text.toString();
  if (current === next) {
    return;
  }
  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length, Math.max(caret, 0));
  while (prefix < maxPrefix && current[prefix] === next[prefix]) {
    prefix += 1;
  }
  if (isHighSurrogate(current.charCodeAt(prefix - 1))) {
    prefix -= 1;
  }
  let suffix = 0;
  const maxSuffix = Math.min(current.length, next.length) - prefix;
  while (
    suffix < maxSuffix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (isLowSurrogate(current.charCodeAt(current.length - suffix))) {
    suffix -= 1;
  }
  const deleted = current.length - prefix - suffix;
  if (deleted > 0) {
    text.delete(prefix, deleted);
  }
  const inserted = next.slice(prefix, next.length - suffix);
  if (inserted.length > 0) {
    text.insert(prefix, inserted);
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
