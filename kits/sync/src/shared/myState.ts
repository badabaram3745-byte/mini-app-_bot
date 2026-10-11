import { useMemo, useSyncExternalStore } from "react";
import { describe, isPlainObject } from "./fields";
import { storageKey } from "./paths";
import { useStable } from "./useStoreValue";
import { warnOnce } from "./warn";

const VALUE_LIMIT = 4000;

interface HostStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  remove(key: string): Promise<void>;
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

interface Entry {
  /** What the host had at the first read; undefined until that read lands. */
  stored?: string | null;
  /** What this page wrote since; undefined while nothing was written. */
  local?: string | null;
  read?: Promise<void>;
  parsed?: { raw: string; initial: unknown; value: unknown };
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();

function host(): HostStorage | undefined {
  return (globalThis as { clickup?: { storage?: HostStorage } }).clickup
    ?.storage;
}

/** The entry for `key`, its first read under way; without a host the read is over before it starts. */
function entryOf(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { listeners: new Set() };
    entries.set(key, entry);
    const storage = host();
    if (storage) {
      const landed = (raw: string | null) => {
        entry!.stored = raw;
        entry!.listeners.forEach((listener) => listener());
      };
      entry.read = storage.get(key).then(landed, () => landed(null));
    } else {
      warnOnce(
        "myState",
        "clickup.storage is unavailable here, so useMyState keeps values for this tab only.",
      );
      entry.stored = null;
    }
  }
  return entry;
}

/** The stored JSON as a `T`, or `initial` when it does not parse or has another shape than `initial`. */
function parse<T>(label: string, raw: string, initial: T): T {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      initial == null ||
      (typeof value === typeof initial &&
        Array.isArray(value) === Array.isArray(initial))
    ) {
      return value as T;
    }
  } catch {
    // Not JSON.
  }
  warnOnce(
    `myState:${label}`,
    `${label} found a stored value of another shape and uses initial instead.`,
  );
  return initial;
}

/** The value at `path`, a key already checked; `label` names it in warnings and `setter` in `set` errors. */
function handle<T>(label: string, path: string, initial: T, setter = label) {
  const entry = entryOf(path);
  const notify = () => entry.listeners.forEach((listener) => listener());
  const get = (): T => {
    const raw = entry.local === undefined ? entry.stored : entry.local;
    if (raw == null) {
      return initial;
    }
    const cached = entry.parsed;
    if (cached && cached.raw === raw && cached.initial === initial) {
      return cached.value as T;
    }
    const value = parse(label, raw, initial);
    entry.parsed = { raw, initial, value };
    return value;
  };
  /** Applies `raw` here at once and sends it to the host; a refusal rolls back what this write changed, and says so. */
  const apply = (
    raw: string | null,
    send: (storage: HostStorage) => Promise<unknown>,
  ) => {
    const previous = entry.local;
    entry.local = raw;
    notify();
    const storage = host();
    if (!storage) {
      return;
    }
    send(storage).catch((error: unknown) => {
      if (entry.local !== raw) {
        return;
      }
      entry.local = previous;
      notify();
      console.error(
        `[sync] ${label}: the host refused the write (${
          error instanceof Error ? error.message : String(error)
        }); ${raw?.length ?? 0} chars rolled back.`,
      );
    });
  };
  return {
    get,
    set(next: T | ((current: T) => T)) {
      const value =
        typeof next === "function" ? (next as (current: T) => T)(get()) : next;
      assertJson(value, setter);
      const json = JSON.stringify(value);
      if (json.length > VALUE_LIMIT) {
        throw new Error(
          `${setter}: ${json.length.toLocaleString("en-US")} chars, limit ${VALUE_LIMIT.toLocaleString("en-US")}. Store less or split keys.`,
        );
      }
      apply(json, (storage) => storage.set(path, json));
    },
    remove: () => apply(null, (storage) => storage.remove(path)),
    loaded: () => entry.read ?? Promise.resolve(),
    suspend() {
      if (entry.stored === undefined && entry.local === undefined) {
        throw entry.read;
      }
    },
    subscribe(listener: () => void) {
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
  };
}

/** Throws for anything JSON cannot carry. */
function assertJson(value: unknown, at: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => assertJson(item, at));
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined) {
        assertJson(value[key], at);
      }
    }
  } else if (
    !(
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
  ) {
    throw new Error(
      `${at}: the value must be JSON, not ${describe(value)}. Store dates as ISO strings or numbers.`,
    );
  }
}

/**
 * A value of mine that survives a reload, `useState` with a key:
 * `const [tab, setTab] = useMyState("tab", "board")`, stored per viewer per
 * artifact as JSON, up to 4,000 characters per key (`set` throws past that).
 * Suspends until the stored value has loaded, so the first render never shows
 * `initial` over a stored value; a key mounted later needs its own
 * `<Suspense>`.
 */
export function useMyState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((current: T) => T)) => void] {
  const stableInitial = useStable(initial);
  const state = useMemo(() => {
    const label = `useMyState(${JSON.stringify(key)})`;
    return handle(label, storageKey(key, label), stableInitial);
  }, [key, stableInitial]);
  state.suspend();
  return [
    useSyncExternalStore(state.subscribe, state.get, state.get),
    state.set,
  ];
}

/**
 * The same value outside React, always current: `myState("tab", "board").get()`
 * in a draw loop or event listener, `.set(v)` to write it, `.remove()` to
 * delete the key. Starts loading the value when called.
 */
export function myState<T>(key: string, initial: T): MyState<T>;
export function myState<T>(key: string): MyState<T | undefined>;
export function myState<T>(key: string, initial?: T): MyState<T | undefined> {
  const label = `myState(${JSON.stringify(key)})`;
  return handle(label, storageKey(key, label), initial, `${label}.set`);
}

/** A value the kit keeps for this viewer under a `#` key, which authors are refused; resolves once the stored value has loaded. */
export function kitState<T>(
  key: `#${string}`,
  initial: T,
): Promise<MyState<T>> {
  const state = handle(`kit(${JSON.stringify(key)})`, key, initial);
  return state.loaded().then(() => state);
}
