const STORE = "pages";
const OPEN_DEADLINE_MS = 2_000;

/** Pages by key, each one encoded string; keys mean nothing here beyond their order. */
export interface PageStorage {
  /** Visits every page in key order, one task per page, and resolves once the last has been visited. */
  readAll(onPage: (key: string, text: string) => void): Promise<void>;
  /** Applies the puts and deletes in one transaction. */
  write(puts: Array<[string, string]>, deletes: string[]): Promise<void>;
  /** Deletes the page, on its own transaction. */
  remove(key: string): Promise<void>;
}

/**
 * One IndexedDB database holding one object store. Every failure rejects,
 * including a missing `indexedDB` and an `open` that does not answer within
 * the deadline, and the caller decides what to do.
 */
export function idbStorage(name: string): PageStorage {
  let database: Promise<IDBDatabase> | undefined;
  const open = () => (database ??= openDatabase(name));

  const storage: PageStorage = {
    async readAll(onPage) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const request = db
          .transaction(STORE, "readonly")
          .objectStore(STORE)
          .openCursor();
        request.onerror = () =>
          reject(request.error ?? new Error("IDB read failed"));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          if (typeof cursor.value === "string") {
            onPage(String(cursor.key), cursor.value);
          }
          cursor.continue();
        };
      });
    },
    async write(puts, deletes) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite", {
          durability: "relaxed",
        });
        const store = tx.objectStore(STORE);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IDB write failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IDB write aborted"));
        for (const key of deletes) {
          store.delete(key);
        }
        const remaining = puts.values();
        const putNext = () => {
          const next = remaining.next();
          if (next.done) {
            tx.commit?.();
            return;
          }
          const [key, text] = next.value;
          store.put(text, key).onsuccess = putNext;
        };
        putNext();
      });
    },
    remove: (key) => storage.write([], [key]),
  };
  return storage;
}

/** Deletes every database whose name starts with `prefix` other than `keep`, where the browser can list them. */
export async function removeSiblings(
  prefix: string,
  keep: string,
): Promise<void> {
  if (typeof indexedDB === "undefined" || !indexedDB.databases) {
    return;
  }
  for (const { name } of await indexedDB.databases()) {
    if (name && name !== keep && name.startsWith(prefix)) {
      indexedDB.deleteDatabase(name);
    }
  }
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const deadline = setTimeout(
      () => reject(new Error("IndexedDB did not open in time")),
      OPEN_DEADLINE_MS,
    );
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, 1);
    } catch (error) {
      clearTimeout(deadline);
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      clearTimeout(deadline);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(deadline);
      reject(request.error ?? new Error("IndexedDB failed to open"));
    };
    request.onblocked = () => {
      clearTimeout(deadline);
      reject(new Error("IndexedDB open is blocked"));
    };
  });
}
