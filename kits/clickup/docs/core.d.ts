import type { CommentsApi } from "./comments";
import type { CustomFieldsApi } from "./customFields";
import type { FoldersApi, ListsApi, SpacesApi } from "./hierarchy";
import type { InboxApi } from "./inbox";
import type { TeamsApi, User, UsersApi } from "./people";
import type { RemindersApi } from "./reminders";
import type { SearchHit, SearchQuery } from "./search";
import type { TasksApi } from "./tasks";

/**
 * An ISO 8601 string as `Date#toISOString()` writes it; a plain `YYYY-MM-DD`
 * is accepted as input and means that day in the viewer's timezone. A
 * required date the host has no value for reads as the Unix epoch,
 * `1970-01-01T00:00:00.000Z`.
 */
export type IsoDate = string;
/** Rich text as a Quill delta, plain JSON ops; render it with `RichText`. */
export interface Delta {
    ops: ReadonlyArray<Record<string, unknown>>;
}
export declare const ASSET_KINDS: readonly ["space", "folder", "list", "status", "customField", "task", "taskType", "comment", "user", "team", "inboxBundle", "reminder"];
export type AssetKind = (typeof ASSET_KINDS)[number];
/**
 * A pointer to an asset; every full asset (a `Task`, a `List`, …) is also a
 * `Ref`, so anything a hook returns can be passed where a ref is expected.
 * Where a parameter is `Ref | string`, the string is the asset's id.
 */
export interface Ref<K extends AssetKind = AssetKind> {
    kind: K;
    id: string;
    /** Empty when the viewer cannot see the asset, e.g. a related task in a private list. */
    name: string;
    /**
     * Link to the asset in ClickUp; empty for statuses, custom fields and
     * reminders. Users and teams link to the workspace's People page.
     */
    url: string;
    /** Avatar or thumbnail, where the asset has one. */
    image?: string;
}
/** `pending` until the first result or failure. */
export type QueryStatus = "pending" | "error" | "success";
/** TanStack Query v5's `useQuery` result. */
export interface UseQueryResult<T> {
    /** Undefined until the first result; kept while refetching. */
    data: T | undefined;
    error: LiveError | null;
    status: QueryStatus;
    isPending: boolean;
    /** Pending and fetching: the first result is on its way. */
    isLoading: boolean;
    /** True while a request is in flight, including the refresh behind a cached result. */
    isFetching: boolean;
    /** Fetching with data already showing. */
    isRefetching: boolean;
    /** True while `data` is the option's `placeholderData`, not a result. */
    isPlaceholderData: boolean;
    isError: boolean;
    isSuccess: boolean;
    /** When `data` was read from ClickUp, as a timestamp; 0 without data. */
    dataUpdatedAt: number;
    /** Reloads from ClickUp. Rarely needed, since writes refetch what they change. */
    refetch: () => Promise<void>;
}
export interface UseQueryOptions<T = unknown> {
    /** Pass false to skip fetching, e.g. while an input is still unknown. */
    enabled?: boolean;
    /** Shown as `data` until the first result, e.g. `keepPreviousData` to keep the last rows while a changed selector loads. */
    placeholderData?: T | ((previous: T | undefined) => T | undefined);
    /** Milliseconds between refetches while the tab is visible; never under 10 000. Rarely needed: writes refetch, and so does returning to the tab. */
    refetchInterval?: number;
    /** Pass false to wait for fresh data instead of painting the viewer's last result first. Rarely needed: the data refreshes anyway. */
    cache?: boolean;
}
/** A `placeholderData` that keeps the previous selector's rows on screen while the new ones load. */
export declare function keepPreviousData<T>(previous: T | undefined): T | undefined;
/**
 * - `denied`: the viewer declined the approval in ClickUp.
 * - `forbidden`: the host or viewer is not allowed to; hide or disable the feature.
 * - `invalid`: the call itself is wrong (selector, id or input); fix the code.
 * - `failed`: something went wrong; retry when `retryable`.
 */
export type LiveErrorCode = "denied" | "forbidden" | "invalid" | "failed";
export declare class LiveError extends Error {
    readonly code: LiveErrorCode;
    /** True for rate limits, timeouts and other transient errors. */
    readonly retryable: boolean;
    /** The host's raw reason, for debugging. */
    readonly reason?: string;
    constructor(code: LiveErrorCode, message: string, options?: {
        retryable?: boolean;
        reason?: string;
    });
}
/**
 * The same reads as the hooks, as promises, plus all writes. Each changed
 * field needs the viewer's approval in ClickUp; a write stops at the first
 * denial.
 */
export interface LiveClient {
    spaces: SpacesApi;
    folders: FoldersApi;
    lists: ListsApi;
    customFields: CustomFieldsApi;
    tasks: TasksApi;
    comments: CommentsApi;
    users: UsersApi;
    teams: TeamsApi;
    inbox: InboxApi;
    reminders: RemindersApi;
    /** Opens a ClickUp url in the app. */
    navigate(url: string): Promise<void>;
    /** ClickUp's own search, run as the viewer. */
    search(query: SearchQuery): Promise<SearchHit[]>;
    /** Sends a prompt to Brain, ClickUp's AI, on the user's behalf. */
    askBrain(prompt: string): Promise<void>;
    /** A task or comment `body` as the HTML ClickUp shows for it; `RichText` renders this. */
    toHtml(body: Delta): Promise<string>;
    /** The user viewing the artifact, known to the host up front: no read, no loading state. */
    readonly viewer: User;
}
export type MutationStatus = "idle" | "pending" | "success" | "error";
export type MutationFunction<TData, TVariables> = (variables: TVariables) => Promise<TData>;
export interface MutationOptions<TData, TVariables> {
    onSuccess?: (data: TData, variables: TVariables) => void;
    onError?: (error: Error, variables: TVariables) => void;
    onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables) => void;
}
export interface UseMutationOptions<TData, TVariables> extends MutationOptions<TData, TVariables> {
    mutationFn: MutationFunction<TData, TVariables>;
}
export interface UseMutationResult<TData, TVariables> {
    data: TData | undefined;
    error: Error | null;
    /** What the last `mutate` was called with; undefined while idle. */
    variables: TVariables | undefined;
    isError: boolean;
    isPending: boolean;
    isSuccess: boolean;
    status: MutationStatus;
    /** Never throws; failures show up in `error`. */
    mutate: (variables: TVariables, options?: MutationOptions<TData, TVariables>) => void;
    mutateAsync: (variables: TVariables, options?: MutationOptions<TData, TVariables>) => Promise<TData>;
    reset: () => void;
}
/**
 * TanStack Query v5's `useMutation`; a bare function is taken as
 * `mutationFn`. Call `mutate` from an event handler and leave the rest to
 * the kit: on-screen queries update optimistically, roll back if the viewer
 * declines, and refetch on success.
 * @example
 * const complete = useMutation({ mutationFn: (status: Status) => clickup.tasks.update(task, { status }) });
 * <button disabled={complete.isPending} onClick={() => complete.mutate(done)}>Mark done</button>
 */
export declare function useMutation<TData, TVariables = void>(options: UseMutationOptions<TData, TVariables> | MutationFunction<TData, TVariables>): UseMutationResult<TData, TVariables>;
