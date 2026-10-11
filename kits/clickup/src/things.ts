/** Cached data older than this is not painted. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A page is closed once its things pass this many JSON characters. */
export const PAGE_BYTES = 500_000;
/** The cache is trimmed to about this many JSON characters. */
export const BUDGET_BYTES = 10_000_000;

/** Anything the store holds: an asset, or a query. */
export interface Thing {
  kind: string;
  id: string;
}

/** A query as a thing: when it landed, and what it lists by key or holds inline. */
export interface QueryThing extends Thing {
  kind: "query";
  /** The query key. */
  id: string;
  at: number;
  /** The listed assets' keys, for asset kinds. */
  ids?: string[];
  /** The rows themselves, for the other kinds. */
  rows?: object[];
}

export function keyOf(thing: Thing): string {
  return `${thing.kind}#${thing.id}`;
}

function queryKeyOf(key: string): string {
  return keyOf({ kind: "query", id: key });
}

export function isQuery(thing: Thing): thing is QueryThing {
  return thing.kind === "query";
}

/** Roots (queries) and nodes (assets) are paged apart; the prefix sorts roots first on disk. */
const LANES = ["0r", "1n"] as const;
type Lane = (typeof LANES)[number];

function laneOf(page: string): Lane | undefined {
  return LANES.find((lane) => page.startsWith(`${lane}:`));
}

/**
 * One map of things keyed `kind#id`, tracking which page each is on and
 * whether it changed since. Queries are the roots: an asset lives while a
 * query lists it.
 */
export class Things {
  private readonly map = new Map<string, Thing>();
  private readonly pageOf = new Map<string, string>();
  private readonly dirty = new Set<string>();
  /** Per thing, `<json length>:<json hash>`, so identical content is recognized without keeping the JSON. */
  private readonly sig = new Map<string, string>();
  /** Per lane, the page new things go on: the newest one, until it is full. */
  private readonly open = new Map<Lane, { key: string; bytes: number }>();
  /** JSON characters on pages, the measure the budget is in. */
  bytes = 0;
  /** Bumped on every change, so a derived value can tell it is current. */
  version = 0;

  get(key: string): Thing | undefined {
    return this.map.get(key);
  }

  query(key: string): QueryThing | undefined {
    return this.map.get(queryKeyOf(key)) as QueryThing | undefined;
  }

  deleteQuery(key: string): void {
    this.delete(queryKeyOf(key));
  }

  hasPage(thing: Thing): boolean {
    return this.pageOf.has(keyOf(thing));
  }

  /**
   * Puts a thing in the map and on a page. Identical content keeps the object
   * already held and dirties nothing; new content dirties the thing's page.
   */
  set(key: string, thing: Thing): void {
    const json = JSON.stringify(thing);
    if (this.map.has(key) && this.sig.get(key) === signature(json)) {
      return;
    }
    this.bytes += json.length - this.pagedSize(key);
    this.hold(key, thing, json);
    let page = this.pageOf.get(key);
    if (!page) {
      page = this.place(isQuery(thing) ? "0r" : "1n", json.length);
      this.pageOf.set(key, page);
    }
    this.dirty.add(page);
  }

  /** Holds a thing in memory only; it never reaches a page. */
  hold(key: string, thing: Thing, json = JSON.stringify(thing)): void {
    this.sig.set(key, signature(json));
    this.map.set(key, thing);
    this.version += 1;
  }

  private pagedSize(key: string): number {
    return this.pageOf.has(key) ? sizeOf(this.sig.get(key)) : 0;
  }

  /** The open page of `lane`, or a new one once the open page is full. */
  private place(lane: Lane, bytes: number): string {
    let open = this.open.get(lane);
    if (!open || open.bytes + bytes > PAGE_BYTES) {
      open = { key: `${lane}:${pageStamp()}`, bytes: 0 };
      this.open.set(lane, open);
    }
    open.bytes += bytes;
    return open.key;
  }

  delete(key: string): void {
    if (!this.map.delete(key)) {
      return;
    }
    this.bytes -= this.pagedSize(key);
    this.sig.delete(key);
    this.version += 1;
    const page = this.pageOf.get(key);
    this.pageOf.delete(key);
    if (page) {
      this.dirty.add(page);
    }
  }

  /** Drops every asset no query lists. */
  collect(): void {
    const listed = new Set<string>();
    for (const thing of this.map.values()) {
      if (isQuery(thing)) {
        for (const id of thing.ids ?? []) {
          listed.add(id);
        }
      }
    }
    for (const [key, thing] of this.map) {
      if (!isQuery(thing) && !listed.has(key)) {
        this.delete(key);
      }
    }
  }

  /**
   * Drops the least recently used queries on disk that `inUse` does not
   * claim, and what only they listed, until the pages fit `budget`.
   * @returns The dropped queries.
   */
  evict(budget: number, inUse: (query: QueryThing) => boolean): QueryThing[] {
    const dropped: QueryThing[] = [];
    while (this.bytes > budget) {
      let oldest: QueryThing | undefined;
      for (const [key, thing] of this.map) {
        if (
          isQuery(thing) &&
          this.pageOf.has(key) &&
          !inUse(thing) &&
          (!oldest || thing.at < oldest.at)
        ) {
          oldest = thing;
        }
      }
      if (!oldest) {
        break;
      }
      this.delete(keyOf(oldest));
      this.collect();
      dropped.push(oldest);
    }
    return dropped;
  }

  /**
   * Adopts a page read from the cache: things the map does not hold yet, on
   * the page they came from. A copy held elsewhere or an expired query is
   * left out and dirties the page; the newest page of each lane stays open.
   */
  seedPage(page: string, things: Thing[]): void {
    const now = Date.now();
    let bytes = 0;
    for (const thing of things) {
      const key = keyOf(thing);
      const expired = isQuery(thing) && now - thing.at > MAX_AGE_MS;
      if (this.map.has(key) || expired) {
        this.dirty.add(page);
        continue;
      }
      const json = JSON.stringify(thing);
      this.hold(key, thing, json);
      this.pageOf.set(key, page);
      bytes += json.length;
    }
    this.bytes += bytes;
    const lane = laneOf(page);
    const open = lane && this.open.get(lane);
    if (lane && (!open || open.key < page)) {
      this.open.set(lane, { key: page, bytes });
    }
  }

  /** The dirty pages with their things, an empty page meaning a deletion; clears the dirty set. */
  takeDirtyPages(): Map<string, Thing[]> {
    const pages = new Map<string, Thing[]>();
    for (const page of this.dirty) {
      pages.set(page, []);
    }
    for (const [key, page] of this.pageOf) {
      pages.get(page)?.push(this.map.get(key)!);
    }
    this.dirty.clear();
    return pages;
  }
}

function signature(json: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${json.length}:${hash >>> 0}`;
}

function sizeOf(signature: string | undefined): number {
  return signature ? Number(signature.slice(0, signature.indexOf(":"))) : 0;
}

/** Page keys sort by creation, and two pages never collide, even across tabs. */
function pageStamp(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36).padStart(9, "0")}-${random}`;
}
