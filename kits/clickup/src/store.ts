import type { AssetKind, Ref } from "./core";
import { ASSET_KINDS, LiveError } from "./core";
import type { QueryThing, Thing } from "./things";
import { isQuery, keyOf, Things } from "./things";

/** What a query lists: assets of one kind, search hits, SQL rows over tasks, or a body's HTML. */
export type QueryKind = AssetKind | "search" | "taskRow" | "html";

/** A stable cache key for one kind + selector; equal selectors share a key. */
export function queryKey(kind: QueryKind, selector: object): string {
  return `${kind}:${stableStringify(selector)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.kind === "string" && typeof record.id === "string") {
      return `${record.kind}#${record.id}`;
    }
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${key}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const ASSET_KIND_SET: ReadonlySet<string> = new Set(ASSET_KINDS);

/** What a hook reads for its query. */
export interface QueryState<T> {
  data: T[] | undefined;
  error: unknown;
  /** When `data` landed: the host's answer this session, or the cached copy's stamp. */
  at: number;
  /** True while a request is in flight. */
  fetching: boolean;
}

export interface SubscribeOptions {
  /** False keeps this query off the cache: it neither paints from it nor lands in it. */
  cache?: boolean;
}

/** The per-query state that lives only for this session. */
interface Runtime {
  kind: QueryKind;
  fetcher: (() => Promise<object[]>) | undefined;
  promise: Promise<object[]> | undefined;
  error: unknown;
  cache: boolean;
  listeners: Set<() => void>;
  memo: { version: number; data: object[] | undefined } | undefined;
}

/**
 * Every query on screen over one map of things: shared fetches, optimistic
 * writes and invalidation. A hook paints what is held, from this session or
 * the cache, and every mount asks the host again.
 */
export class Store {
  readonly things = new Things();
  private readonly runtime = new Map<string, Runtime>();
  private readonly resets = new Map<QueryKind, Set<() => void>>();
  private readonly changeListeners = new Set<() => void>();

  /** Registers a bundle the queries of `kinds` read through; it is reset before any fresh read of those kinds. */
  onRefresh(kinds: readonly QueryKind[], reset: () => void): void {
    for (const kind of kinds) {
      const resets = this.resets.get(kind) ?? new Set();
      resets.add(reset);
      this.resets.set(kind, resets);
    }
  }

  private refresh(kind: QueryKind): void {
    for (const reset of this.resets.get(kind) ?? []) {
      reset();
    }
  }

  /** Subscribes to a query, creating it on first use; identical keys share one entry and one in-flight request. */
  subscribe<T extends object>(
    key: string,
    kind: QueryKind,
    fetcher: () => Promise<T[]>,
    listener: () => void,
    options: SubscribeOptions = {},
  ): () => void {
    let entry = this.runtime.get(key);
    if (!entry) {
      entry = {
        kind,
        fetcher: undefined,
        promise: undefined,
        error: undefined,
        cache: true,
        listeners: new Set(),
        memo: undefined,
      };
      this.runtime.set(key, entry);
    }
    entry.fetcher = fetcher;
    entry.cache = options.cache !== false;
    entry.listeners.add(listener);
    const query = this.things.query(key);
    if (!entry.cache && query && this.things.hasPage(query)) {
      this.things.delete(keyOf(query));
    }
    const { listeners } = entry;
    return () => {
      listeners.delete(listener);
    };
  }

  state<T extends object>(key: string): QueryState<T> {
    const entry = this.runtime.get(key);
    const query = this.things.query(key);
    const data = query ? (this.rowsOf(query, entry) as T[]) : undefined;
    return {
      data,
      error: entry?.error,
      at: data === undefined ? 0 : query!.at,
      fetching: entry?.promise !== undefined,
    };
  }

  /** The rows a query holds, defined only once every listed asset is present; the same array while nothing changed. */
  private rowsOf(
    query: QueryThing,
    entry: Runtime | undefined,
  ): object[] | undefined {
    const { version } = this.things;
    const memo = entry?.memo;
    if (memo?.version === version) {
      return memo.data;
    }
    let data: object[] | undefined = query.rows ?? [];
    for (const id of query.ids ?? []) {
      const thing = this.things.get(id);
      if (!thing) {
        data = undefined;
        break;
      }
      data.push(thing);
    }
    if (data && memo?.data && sameItems(data, memo.data)) {
      data = memo.data;
    }
    if (entry) {
      entry.memo = { version, data };
    }
    return data;
  }

  /** Asks the host for the query's data, sharing any request in flight; `fresh` also resets the bundles its kind reads through. */
  fetch<T extends object>(key: string, fresh = false): Promise<T[]> {
    const entry = this.runtime.get(key);
    if (!entry) {
      return Promise.reject(new Error(`Unknown query ${key}`));
    }
    if (fresh) {
      this.refresh(entry.kind);
    }
    return this.load(key, entry) as Promise<T[]>;
  }

  private load(key: string, entry: Runtime): Promise<object[]> {
    if (entry.promise) {
      return entry.promise;
    }
    const { fetcher } = entry;
    if (!fetcher) {
      return Promise.reject(
        new Error(`A ${entry.kind} query has no subscriber`),
      );
    }
    const promise = withRetry(fetcher).then(
      (rows) => {
        if (entry.promise === promise) {
          entry.promise = undefined;
          this.ingest(key, entry, rows);
        }
        return rows;
      },
      (error: unknown) => {
        if (entry.promise === promise) {
          entry.promise = undefined;
          entry.error = error;
          if (isForbidden(error)) {
            this.things.deleteQuery(key);
            this.things.collect();
          }
          this.notify(entry.kind);
        }
        throw error;
      },
    );
    entry.promise = promise;
    entry.error = undefined;
    this.notify(entry.kind);
    return promise;
  }

  /** Stores a host answer: the rows become the current things and the query lists them. */
  private ingest(key: string, entry: Runtime, rows: object[]): void {
    entry.error = undefined;
    const query: QueryThing = { kind: "query", id: key, at: Date.now() };
    if (ASSET_KIND_SET.has(entry.kind)) {
      for (const asset of rows as Ref[]) {
        this.things.set(keyOf(asset), asset);
      }
      query.ids = (rows as Ref[]).map(keyOf);
    } else {
      query.rows = rows;
    }
    if (entry.cache) {
      this.things.set(keyOf(query), query);
    } else {
      this.things.hold(keyOf(query), query);
    }
    this.things.collect();
    this.notify(entry.kind);
    this.changed();
  }

  /** Drops the least recently used off-screen queries until the things fit `budget`. */
  evict(budget: number): void {
    const inUse = (query: QueryThing) =>
      (this.runtime.get(query.id)?.listeners.size ?? 0) > 0;
    for (const query of this.things.evict(budget, inUse)) {
      this.runtime.delete(query.id);
    }
  }

  /** The copy of an asset any query holds. */
  find<T extends Ref>(kind: AssetKind, id: string): T | undefined {
    return this.things.get(`${kind}#${id}`) as T | undefined;
  }

  /**
   * Runs a write optimistically: cached copies of `asset` show the patched
   * result at once, the host executes after the user's approval, and every
   * list of that kind on screen refetches. A denial or failure rolls back.
   */
  async update<T extends Ref>(
    asset: T,
    apply: (current: T) => T,
    perform: () => Promise<void>,
  ): Promise<void> {
    const rollback = this.optimistic(asset, apply);
    try {
      await perform();
    } catch (error) {
      rollback();
      throw error;
    }
    await this.invalidate(asset.kind);
  }

  private optimistic<T extends Ref>(
    asset: Ref,
    merge: (current: T) => T,
  ): () => void {
    const key = keyOf(asset);
    const current = this.things.get(key);
    if (!current) {
      return () => undefined;
    }
    const next = merge(current as T);
    const swap = (from: object, to: Ref) => {
      if (this.things.get(key) === from) {
        this.things.set(key, to);
        this.notify(asset.kind);
        this.changed();
      }
    };
    swap(current, next);
    return () => swap(next, current as Ref);
  }

  /** Refetches every query of a kind on screen; the rest refetch when they come back. A task write also refreshes SQL rows. */
  async invalidate(kind: QueryKind): Promise<void> {
    this.refresh(kind);
    const refetches: Array<Promise<unknown>> = [];
    if (kind === "task") {
      refetches.push(this.invalidate("taskRow"));
    }
    for (const [key, entry] of this.runtime) {
      if (entry.kind === kind && entry.listeners.size > 0) {
        refetches.push(this.load(key, entry).catch(() => undefined));
      }
    }
    await Promise.all(refetches);
  }

  /** Drops every bundle and refetches every query on screen; the rest refetch when they come back. */
  reload(): void {
    for (const kind of this.resets.keys()) {
      this.refresh(kind);
    }
    for (const [key, entry] of this.runtime) {
      if (entry.listeners.size > 0) {
        this.load(key, entry).catch(() => undefined);
      }
    }
  }

  /** Adopts a page from the cache, except queries the host already refused this session, and wakes every hook. */
  seedPage(page: string, things: Thing[]): void {
    const refused = (thing: Thing) =>
      isQuery(thing) && this.runtime.get(thing.id)?.error !== undefined;
    this.things.seedPage(
      page,
      things.filter((thing) => !refused(thing)),
    );
    this.notify();
  }

  /** Called after any host answer or optimistic change; seeding is not a change. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private changed(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  /** Wakes the hooks of `kind`, or all of them. */
  private notify(kind?: QueryKind): void {
    for (const entry of this.runtime.values()) {
      if (kind === undefined || entry.kind === kind) {
        for (const listener of entry.listeners) {
          listener();
        }
      }
    }
  }
}

const RETRIES = 3;
const FIRST_RETRY_DELAY_MS = 1_000;

/** Runs `load`, retrying a `retryable` failure up to three times at 1 s, 2 s and 4 s; any other failure rejects at once. */
async function withRetry<T>(load: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      if (attempt >= RETRIES || !isTransient(error)) {
        throw error;
      }
      await wait(FIRST_RETRY_DELAY_MS * 2 ** attempt);
    }
  }
}

function isTransient(error: unknown): boolean {
  return error instanceof LiveError && error.retryable;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isForbidden(error: unknown): boolean {
  return error instanceof LiveError && error.code === "forbidden";
}

function sameItems(a: readonly object[], b: readonly object[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** The optimistic result of a patch: `undefined` leaves a field alone, `null` clears it, anything else replaces it. */
export function applyPatch<T extends object>(asset: T, patch: object): T {
  const next = { ...asset } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
    } else if (value !== undefined) {
      next[key] = value;
    }
  }
  return next as T;
}
