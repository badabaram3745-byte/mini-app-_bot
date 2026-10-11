import * as z from "zod/v4-mini";
import {
  EMBED_SEARCH_KEYWORDS_MAX_LENGTH,
  EMBED_SEARCH_MAX_LIMIT,
} from "../host/wire";
import { isoDate, limit, orderBy, ref, refFields, schemaOf } from "../validate";
import type { SearchHit, SearchQuery } from "./search";
import { SEARCH_KINDS, SEARCH_ORDERS } from "./search";

export const SearchHitSchema = schemaOf<SearchHit>()(
  z.object({
    ...refFields(SEARCH_KINDS),
    snippet: z.optional(z.string()),
    createdAt: isoDate,
    updatedAt: isoDate,
    viewedAt: z.optional(isoDate),
  }),
);

export const SearchQuerySchema = schemaOf<SearchQuery>()(
  z.strictObject({
    keywords: z.optional(
      z
        .string()
        .check(
          z.minLength(1),
          z.maxLength(
            EMBED_SEARCH_KEYWORDS_MAX_LENGTH,
            `At most ${EMBED_SEARCH_KEYWORDS_MAX_LENGTH} characters`,
          ),
        ),
    ),
    kinds: z.optional(
      z
        .array(z.enum(SEARCH_KINDS))
        .check(z.minLength(1, "Expected at least one kind")),
    ),
    ancestor: z.optional(ref(["space", "folder", "list"])),
    orderBy: orderBy(SEARCH_ORDERS),
    limit: limit(EMBED_SEARCH_MAX_LIMIT),
  }),
);
