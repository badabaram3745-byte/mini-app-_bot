export interface Memo<T> {
  (): Promise<T>;
  /** Forgets the result, so the next call loads again. */
  reset(): void;
}

/** Caches the first successful result; a rejection is forgotten so the next call retries. */
export function memo<T>(load: () => Promise<T>): Memo<T> {
  let promise: Promise<T> | undefined;
  const get = (): Promise<T> => {
    promise ??= load().catch((error: unknown) => {
      promise = undefined;
      throw error;
    });
    return promise;
  };
  return Object.assign(get, {
    reset: () => {
      promise = undefined;
    },
  });
}

export interface MemoBy<A, T> {
  (arg: A): Promise<T>;
  reset(): void;
}

/** `memo` per argument; `keyOf` names the entry when the argument is not itself a usable key. */
export function memoBy<A, T>(
  load: (arg: A) => Promise<T>,
  keyOf: (arg: A) => unknown = (arg) => arg,
): MemoBy<A, T> {
  const entries = new Map<unknown, Memo<T>>();
  const get = (arg: A): Promise<T> => {
    const key = keyOf(arg);
    let entry = entries.get(key);
    if (!entry) {
      entry = memo(() => load(arg));
      entries.set(key, entry);
    }
    return entry();
  };
  return Object.assign(get, { reset: () => entries.clear() });
}
