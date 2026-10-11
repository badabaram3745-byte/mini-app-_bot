import type { Ref } from "./core";
import { ARTIFACT_QUERY_MAX_LIMIT } from "./host/wire";

const DEFAULT_LIMIT = 100;

export function clampLimit(
  limit: number | undefined,
  fallback = DEFAULT_LIMIT,
  max = ARTIFACT_QUERY_MAX_LIMIT,
): number {
  return Math.min(limit ?? fallback, max);
}

type Identity = Pick<Ref, "kind" | "id">;

interface LoadedSelector {
  /** Direct owner: the last ancestor. */
  parent?: Identity;
  /** Any ancestor. */
  ancestor?: Identity;
  limit?: number;
}

/** Applies a selector to an already-loaded collection; `limit` bounds the result only when given. */
export function selectLoaded<T extends Ref & { ancestors?: Ref[] }>(
  assets: T[],
  selector: LoadedSelector,
): T[] {
  const { parent, ancestor, limit } = selector;
  const selected = assets.filter((asset) => {
    const ancestors = asset.ancestors ?? [];
    return (
      (!parent || same(ancestors[ancestors.length - 1], parent)) &&
      (!ancestor || ancestors.some((ref) => same(ref, ancestor)))
    );
  });
  return limit === undefined ? selected : selected.slice(0, limit);
}

function same(a: Identity | undefined, b: Identity): boolean {
  return a !== undefined && a.kind === b.kind && a.id === b.id;
}

/** The items with these ids, in this order; ids the collection lacks are skipped. */
export function byIds<T extends { id: string }>(
  items: readonly T[],
  ids: string[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}
