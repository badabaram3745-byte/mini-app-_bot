import { useCallback, useRef, useState } from "react";
import type { CommentsApi } from "./comments/comments";
import type { CustomFieldsApi } from "./customFields/customFields";
import type { FoldersApi, ListsApi, SpacesApi } from "./hierarchy/hierarchy";
import type { InboxApi } from "./inbox/inbox";
import type { TeamsApi, User, UsersApi } from "./people/people";
import type { RemindersApi } from "./reminders/reminders";
import type { SearchHit, SearchQuery } from "./search/search";
import type { Store } from "./store";
import type { TasksApi } from "./tasks/tasks";

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

export const ASSET_KINDS = [
  "space",
  "folder",
  "list",
  "status",
  "customField",
  "task",
  "taskType",
  "comment",
  "user",
  "team",
  "inboxBundle",
  "reminder",
] as const;
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

/** @internal */
export function idOf(input: Ref | string): string {
  return typeof input === "string" ? input : input.id;
}

/** @internal */
export function asRef<K extends AssetKind>(asset: Ref<K>): Ref<K> {
  const { kind, id, name, url, image } = asset;
  return { kind, id, name, url, image };
}

/** @internal The `ancestors` of a full asset; none for a bare ref. */
export function pathOf(ref: Ref): Ref[] {
  const ancestors = (ref as { ancestors?: unknown }).ancestors;
  return Array.isArray(ancestors) ? (ancestors as Ref[]) : [];
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
  /** @internal */
  client?: LiveClient;
}

/** A `placeholderData` that keeps the previous selector's rows on screen while the new ones load. */
export function keepPreviousData<T>(previous: T | undefined): T | undefined {
  return previous;
}

/**
 * - `denied`: the viewer declined the approval in ClickUp.
 * - `forbidden`: the host or viewer is not allowed to; hide or disable the feature.
 * - `invalid`: the call itself is wrong (selector, id or input); fix the code.
 * - `failed`: something went wrong; retry when `retryable`.
 */
export type LiveErrorCode = "denied" | "forbidden" | "invalid" | "failed";

export class LiveError extends Error {
  readonly code: LiveErrorCode;
  /** True for rate limits, timeouts and other transient errors. */
  readonly retryable: boolean;
  /** The host's raw reason, for debugging. */
  readonly reason?: string;

  constructor(
    code: LiveErrorCode,
    message: string,
    options: { retryable?: boolean; reason?: string } = {},
  ) {
    super(message);
    this.name = "LiveError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.reason !== undefined) {
      this.reason = options.reason;
    }
  }
}

/**
 * The same reads as the hooks, as promises, plus all writes. Each changed
 * field needs the viewer's approval in ClickUp; a write stops at the first
 * denial.
 */
export interface LiveClient {
  /** @internal */
  readonly store: Store;
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

export type MutationFunction<TData, TVariables> = (
  variables: TVariables,
) => Promise<TData>;

export interface MutationOptions<TData, TVariables> {
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: Error, variables: TVariables) => void;
  onSettled?: (
    data: TData | undefined,
    error: Error | null,
    variables: TVariables,
  ) => void;
}

export interface UseMutationOptions<TData, TVariables> extends MutationOptions<
  TData,
  TVariables
> {
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
  mutate: (
    variables: TVariables,
    options?: MutationOptions<TData, TVariables>,
  ) => void;
  mutateAsync: (
    variables: TVariables,
    options?: MutationOptions<TData, TVariables>,
  ) => Promise<TData>;
  reset: () => void;
}

interface MutationState<TData, TVariables> {
  data: TData | undefined;
  error: Error | null;
  variables: TVariables | undefined;
  status: MutationStatus;
}

const IDLE_STATE: MutationState<never, never> = {
  data: undefined,
  error: null,
  variables: undefined,
  status: "idle",
};

/**
 * TanStack Query v5's `useMutation`; a bare function is taken as
 * `mutationFn`. Call `mutate` from an event handler and leave the rest to
 * the kit: on-screen queries update optimistically, roll back if the viewer
 * declines, and refetch on success.
 * @example
 * const complete = useMutation({ mutationFn: (status: Status) => clickup.tasks.update(task, { status }) });
 * <button disabled={complete.isPending} onClick={() => complete.mutate(done)}>Mark done</button>
 */
export function useMutation<TData, TVariables = void>(
  options:
    | UseMutationOptions<TData, TVariables>
    | MutationFunction<TData, TVariables>,
): UseMutationResult<TData, TVariables> {
  const { mutationFn, ...hookCallbacks } =
    typeof options === "function" ? { mutationFn: options } : options;
  const [state, setState] =
    useState<MutationState<TData, TVariables>>(IDLE_STATE);
  const latestMutation = useRef(0);
  const latestCallbacks = useRef(hookCallbacks);
  latestCallbacks.current = hookCallbacks;

  const mutateAsync = useCallback(
    async (
      variables: TVariables,
      callbacks?: MutationOptions<TData, TVariables>,
    ): Promise<TData> => {
      const mutationId = ++latestMutation.current;
      setState({ data: undefined, error: null, variables, status: "pending" });
      try {
        const data = await mutationFn(variables);
        if (mutationId === latestMutation.current) {
          setState({ data, error: null, variables, status: "success" });
          const listeners = [latestCallbacks.current, callbacks];
          listeners.forEach((on) => on?.onSuccess?.(data, variables));
          listeners.forEach((on) => on?.onSettled?.(data, null, variables));
        }
        return data;
      } catch (cause: unknown) {
        const error =
          cause instanceof Error ? cause : new Error("The mutation failed.");
        if (mutationId === latestMutation.current) {
          setState({ data: undefined, error, variables, status: "error" });
          const listeners = [latestCallbacks.current, callbacks];
          listeners.forEach((on) => on?.onError?.(error, variables));
          listeners.forEach((on) =>
            on?.onSettled?.(undefined, error, variables),
          );
        }
        throw error;
      }
    },
    [mutationFn],
  );

  const mutate = useCallback(
    (
      variables: TVariables,
      options?: MutationOptions<TData, TVariables>,
    ): void => {
      void mutateAsync(variables, options).catch(() => undefined);
    },
    [mutateAsync],
  );

  const reset = useCallback(() => {
    latestMutation.current += 1;
    setState(IDLE_STATE);
  }, []);

  return {
    data: state.data,
    error: state.error,
    variables: state.variables,
    isError: state.status === "error",
    isPending: state.status === "pending",
    isSuccess: state.status === "success",
    status: state.status,
    mutate,
    mutateAsync,
    reset,
  };
}
