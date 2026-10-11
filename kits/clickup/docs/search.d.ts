import type { IsoDate, Ref, UseQueryOptions, UseQueryResult } from "./core";

export declare const SEARCH_KINDS: readonly ["task", "list", "folder", "space", "comment"];
export declare const SEARCH_ORDERS: readonly ["createdAt", "updatedAt", "dueAt"];
/** A ref plus why and when it matched. For the full asset, load it through its kind, e.g. `useTasks([hit.id])`. */
export interface SearchHit extends Ref<(typeof SEARCH_KINDS)[number]> {
    /** A plain-text preview; the passage that matched when `keywords` were given. */
    snippet?: string;
    createdAt: IsoDate;
    updatedAt: IsoDate;
    /** When the viewer last opened it. */
    viewedAt?: IsoDate;
}
export interface SearchQuery {
    /** Matched against names, descriptions and comments. Omit for a plain listing, ordered by `orderBy`. */
    keywords?: string;
    /** Every searchable kind by default. */
    kinds?: Array<SearchHit["kind"]>;
    ancestor?: Ref<"space" | "folder" | "list">;
    /** Relevance when omitted; `direction` defaults to `"desc"`. */
    orderBy?: {
        field: (typeof SEARCH_ORDERS)[number];
        direction?: "asc" | "desc";
    };
    /** Defaults to 25, at most 50. */
    limit?: number;
}
/** ClickUp's own search, run as the viewer; hits come in ClickUp's order. */
export declare function useSearch(query: SearchQuery, options?: UseQueryOptions<SearchHit[]>): UseQueryResult<SearchHit[]>;
