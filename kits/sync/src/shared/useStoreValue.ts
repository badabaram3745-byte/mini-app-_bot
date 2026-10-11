import { useCallback, useRef, useSyncExternalStore } from "react";
import { deepEqual } from "./fields";
import { getStore } from "./store";

const unsubscribed = () => {};
const inert = () => unsubscribed;

/** `read()` kept current by the store's notifications for `key`; a null key reads once and never re-renders. */
export function useStoreValue<T>(key: string | null, read: () => T): T {
  const store = getStore();
  const subscribe = useCallback(
    (listener: () => void) =>
      key === null ? inert() : store.subscribe(key, listener),
    [store, key],
  );
  return useSyncExternalStore(subscribe, read, read);
}

/** The same object across renders while it stays deep-equal. */
export function useStable<T>(value: T): T {
  const ref = useRef(value);
  if (!deepEqual(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
}
