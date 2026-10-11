import { useMemo } from "react";
import type * as Y from "yjs";
import type { OpaqueY } from "./fields";
import { documentPath, validateName } from "./paths";
import { getStore, type OpaqueField, STATUS_KEY } from "./store";
import { useStoreValue } from "./useStoreValue";

export type { OpaqueField } from "./store";

/** The raw field for the kit driving an `opaque(y, of)` field; artifacts use that kit's component, `Editor` from `@kits/components/editor` say. */
export function opaqueField(
  doc: string,
  field: string,
  y: "xml",
  of: string,
): OpaqueField<Y.XmlFragment>;
export function opaqueField(
  doc: string,
  field: string,
  y: "map",
  of: string,
): OpaqueField<Y.Map<unknown>>;
export function opaqueField(
  doc: string,
  field: string,
  y: OpaqueY,
  of: string,
): OpaqueField<unknown> {
  validateName(field, "A field name");
  return getStore().opaque(documentPath(doc), field, y, of);
}

/** `opaqueField()` in render; suspends until shared state has loaded. */
export function useOpaqueField(
  doc: string,
  field: string,
  y: "xml",
  of: string,
): OpaqueField<Y.XmlFragment>;
export function useOpaqueField(
  doc: string,
  field: string,
  y: "map",
  of: string,
): OpaqueField<Y.Map<unknown>>;
export function useOpaqueField(
  doc: string,
  field: string,
  y: OpaqueY,
  of: string,
): OpaqueField<unknown> {
  const store = getStore();
  const path = documentPath(doc);
  validateName(field, "A field name");
  store.suspendUntilSynced();
  const handle = useMemo(
    () => store.opaque(path, field, y, of),
    [store, path, field, y, of],
  );
  const value = useStoreValue(path, () => handle.value);
  const holds = useStoreValue(path, () => handle.holds);
  const canEdit = useStoreValue(STATUS_KEY, () => handle.canEdit);
  return {
    value,
    holds,
    canEdit,
    awareness: handle.awareness,
    write: handle.write,
  };
}
