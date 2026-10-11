import type { DocData } from "./shared";
import { emptyDocument, withDefaults } from "./fields";
import { childDocumentPath, collectionPath, documentPath } from "./paths";
import type { Fields, SharedCollection, SharedDoc } from "./shared";
import { getStore, NO_DATA } from "./store";

/** The document at `path` over the page's store: `data` and `exists` read the current state, the verbs write it. `data` is built once per stored snapshot; a null path gives empty data and verbs that do nothing. */
export function docHandle(
  path: string | null | undefined,
  defaults?: Fields,
): SharedDoc {
  const key = path == null ? null : documentPath(path);
  const store = getStore();
  let last: { stored: DocData | null; data: DocData } | undefined;
  return {
    get exists() {
      return key !== null && store.data(key) !== null;
    },
    get data() {
      const stored = key === null ? null : store.data(key);
      if (!last || last.stored !== stored) {
        const data = withDefaults(stored ?? emptyDocument(key ?? ""), defaults);
        last = { stored, data };
      }
      return last.data;
    },
    ...(key === null
      ? INERT_DOC
      : {
          set: (fields) => store.set(key, fields),
          update: (fields) => store.update(key, fields),
          delete: () => store.delete(key),
        }),
  };
}

/** The collection at `path` over the page's store; `items` reads the current state. A null path gives no items and verbs that do nothing. */
export function collectionHandle(
  path: string | null | undefined,
): SharedCollection {
  const key = path == null ? null : collectionPath(path);
  const store = getStore();
  return {
    get items() {
      return key === null ? NO_DATA : store.items(key);
    },
    ...(key === null
      ? INERT_COLLECTION
      : {
          add: (fields) => store.add(key, fields),
          set: (id, fields) => {
            store.set(childDocumentPath(key, id), fields);
            return id;
          },
          update: (id, fields) =>
            store.update(childDocumentPath(key, id), fields),
          delete: (id) => store.delete(childDocumentPath(key, id)),
          move: (id, to) => store.move(key, id, to),
        }),
  };
}

function noop() {}

const INERT_DOC = { set: noop, update: noop, delete: noop };
const INERT_COLLECTION = {
  add: () => "",
  set: (id: string) => id,
  update: noop,
  delete: noop,
  move: noop,
};
