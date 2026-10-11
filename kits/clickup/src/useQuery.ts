import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LiveClient,
  QueryStatus,
  UseQueryOptions,
  UseQueryResult,
} from "./core";
import { clickup } from "./client";
import { LiveError } from "./core";
import type { QueryKind } from "./store";
import { queryKey } from "./store";

/** The shortest `refetchInterval` honoured; a shorter one polls the host at this rate. */
const MIN_REFETCH_INTERVAL_MS = 10_000;

export function listOrGet<T, S extends object, R>(
  api: { list(selector: S): Promise<T[]>; get(targets: R[]): Promise<T[]> },
  input: S | R[],
): Promise<T[]> {
  return Array.isArray(input) ? api.get(input) : api.list(input);
}

/** Every `use<Kind>` hook: one cached, shared query per kind and selector. */
export function useLiveQuery<T extends object>(
  kind: QueryKind,
  selector: object,
  fetch: (client: LiveClient) => Promise<T[]>,
  options: UseQueryOptions<T[]>,
): UseQueryResult<T[]> {
  const client = options.client ?? clickup;
  const { store } = client;
  const enabled = options.enabled !== false;
  const { cache } = options;
  const key = queryKey(kind, selector);
  const [, rerender] = useState(0);
  const refetch = useCallback(
    () =>
      enabled
        ? store.fetch(key, true).then(
            () => undefined,
            () => undefined,
          )
        : Promise.resolve(),
    [store, key, enabled],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const unsubscribe = store.subscribe(
      key,
      kind,
      () => fetch(client),
      () => rerender((tick) => tick + 1),
      { cache },
    );
    store.fetch(key).catch(() => undefined);
    return unsubscribe;
    // The selector, and so the fetch, is fully determined by the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, client, key, enabled, cache]);

  const { refetchInterval } = options;
  useEffect(() => {
    if (!enabled || !refetchInterval) {
      return;
    }
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") {
          store.fetch(key, true).catch(() => undefined);
        }
      },
      Math.max(refetchInterval, MIN_REFETCH_INTERVAL_MS),
    );
    return () => clearInterval(timer);
  }, [store, key, enabled, refetchInterval]);

  const state = store.state<T>(key);
  const error =
    state.error === undefined
      ? null
      : state.error instanceof LiveError
        ? state.error
        : new LiveError("failed", String(state.error), { retryable: true });

  const previous = useRef<T[]>();
  if (state.data !== undefined) {
    previous.current = state.data;
  }
  const placeholder =
    state.data !== undefined || error
      ? undefined
      : placeholderOf(options.placeholderData, previous.current);
  const data = state.data ?? placeholder;
  const status: QueryStatus = error
    ? "error"
    : data !== undefined
      ? "success"
      : "pending";
  const isPending = status === "pending";
  const isFetching =
    state.fetching || (state.data === undefined && !error && enabled);

  return {
    data,
    error,
    status,
    isPending,
    isLoading: isPending && isFetching,
    isFetching,
    isRefetching: isFetching && !isPending,
    isPlaceholderData: placeholder !== undefined,
    isError: status === "error",
    isSuccess: status === "success",
    dataUpdatedAt: state.at,
    refetch,
  };
}

function placeholderOf<T>(
  placeholderData: UseQueryOptions<T>["placeholderData"],
  previous: T | undefined,
): T | undefined {
  return typeof placeholderData === "function"
    ? (placeholderData as (previous: T | undefined) => T | undefined)(previous)
    : placeholderData;
}
