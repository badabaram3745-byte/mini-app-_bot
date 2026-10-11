import * as z from "zod/v4-mini";
import { preview } from "../comments/read";
import { LiveError } from "../core";
import type { LiveBridge } from "../host/bridge";
import { toIso, toIsoOrEpoch } from "../host/dates";
import { readError } from "../host/errors";
import type {
  EmbedSearchOrderBy,
  EmbedSearchRequest,
  EmbedSearchResultItem,
} from "../host/wire";
import {
  EMBED_SEARCH_DEFAULT_LIMIT,
  EMBED_SEARCH_MAX_LIMIT,
  kindOfObjectType,
  OBJECT_TYPES,
} from "../host/wire";
import { clampLimit } from "../select";
import type { Session } from "../session";
import { fromHost } from "../validate";
import { SearchHitSchema } from "./schema";
import type { SearchHit, SearchQuery } from "./search";
import { SEARCH_KINDS } from "./search";

const SEARCH_TIMEOUT_MS = 30_000;

const SEARCH_ORDER_BY: Readonly<
  Record<NonNullable<SearchQuery["orderBy"]>["field"], EmbedSearchOrderBy>
> = {
  createdAt: "created_date",
  updatedAt: "updated_date",
  dueAt: "due_date",
};

export async function search(
  s: Session,
  query: SearchQuery,
): Promise<SearchHit[]> {
  const limit = clampLimit(
    query.limit,
    EMBED_SEARCH_DEFAULT_LIMIT,
    EMBED_SEARCH_MAX_LIMIT,
  );
  const { ancestor } = query;
  const items = await collectSearch(s.host, {
    ...(query.keywords ? { keywords: query.keywords } : {}),
    assetTypes: [...(query.kinds ?? SEARCH_KINDS)],
    ...(ancestor
      ? {
          ancestors: [
            { externalId: `${OBJECT_TYPES[ancestor.kind]}:${ancestor.id}` },
          ],
        }
      : {}),
    ...(query.orderBy
      ? {
          orderBy: SEARCH_ORDER_BY[query.orderBy.field],
          orderDirection: query.orderBy.direction ?? "desc",
        }
      : {}),
    limit,
  });
  return fromHost(
    z.array(SearchHitSchema),
    items
      .flatMap((item) => {
        const hit = mapSearchHit(item);
        return hit ? [hit] : [];
      })
      .slice(0, limit),
    "search hits",
  );
}

/** Runs a streamed host search to completion. */
function collectSearch(
  host: LiveBridge,
  request: EmbedSearchRequest,
): Promise<EmbedSearchResultItem[]> {
  return new Promise((resolve, reject) => {
    let unsubscribe = (): void => {};
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(
        new LiveError("failed", "The search did not complete in time.", {
          retryable: true,
        }),
      );
    }, SEARCH_TIMEOUT_MS);
    const settle = (fn: () => void): void => {
      clearTimeout(timeout);
      unsubscribe();
      fn();
    };
    try {
      unsubscribe = host.subscribeSearch(request, (update) => {
        if (update.error) {
          settle(() => reject(readError(update.error)));
        } else if (update.done) {
          settle(() => resolve(update.items));
        }
      });
    } catch (error) {
      settle(() => reject(error));
    }
  });
}

const SEARCHABLE: ReadonlySet<string> = new Set(SEARCH_KINDS);

/** Hits of kinds the kit does not search are dropped. */
function mapSearchHit(item: EmbedSearchResultItem): SearchHit | undefined {
  const kind = kindOfObjectType(item.metadata.objectType);
  if (!kind || !SEARCHABLE.has(kind)) {
    return undefined;
  }
  const snippet = item.highlights?.snippets[0] ?? item.snippet;
  return {
    kind: kind as SearchHit["kind"],
    id: item.metadata.objectId,
    name: item.title || preview(snippet ?? ""),
    url: item.url,
    image: item.thumbnailUrl,
    snippet,
    createdAt: toIsoOrEpoch(item.createdAt),
    updatedAt: toIsoOrEpoch(item.updatedAt),
    viewedAt: toIso(item.viewedAt),
  };
}
