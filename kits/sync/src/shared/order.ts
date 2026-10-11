import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

export interface Ordered {
  readonly id: string;
  readonly order: string;
}

export function compareOrdered(a: Ordered, b: Ordered): number {
  if (a.order !== b.order) {
    return a.order < b.order ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Where `item` sorts into `sorted`: its own index when present, else its insertion index. */
export function rankOf(sorted: readonly Ordered[], item: Ordered): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareOrdered(sorted[middle]!, item) < 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/** A key after every item in `sorted`. */
export function appendKey(sorted: readonly Ordered[]): string {
  return (
    between(sorted[sorted.length - 1]?.order ?? null, null) ??
    generateKeyBetween(null, null)
  );
}

/** Keys that put `sorted[from]` at `index` among the other items; `repairs` re-key those only when no key fits between its new neighbours. */
export function placeAt(
  sorted: readonly Ordered[],
  from: number,
  index: number,
): { key: string; repairs: Array<{ id: string; order: string }> } {
  const other = (at: number) => sorted[at < from ? at : at + 1];
  const key = between(
    other(index - 1)?.order ?? null,
    other(index)?.order ?? null,
  );
  if (key !== undefined) {
    return { key, repairs: [] };
  }
  const keys = generateNKeysBetween(null, null, sorted.length);
  return {
    key: keys[index]!,
    repairs: sorted
      .filter((_, at) => at !== from)
      .map((item, at) => ({
        id: item.id,
        order: keys[at < index ? at : at + 1]!,
      })),
  };
}

/** The index of `item` in `sorted`, or -1. */
export function indexOf(sorted: readonly Ordered[], item: Ordered): number {
  const rank = rankOf(sorted, item);
  return sorted[rank] === item ? rank : -1;
}

function between(a: string | null, b: string | null): string | undefined {
  try {
    return generateKeyBetween(a, b);
  } catch {
    return undefined;
  }
}
