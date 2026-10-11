import type { OpaqueField } from "@kits/sync/internal";

const HELD_BY: Record<string, string> = {
  prosemirror:
    "prosemirror rich text; use <Editor> from @kits/components/editor",
};

/** Returns `bound`, or throws naming the kit to use when `field` holds another kit's opaque field. */
export function bindOpaque<T extends OpaqueField<unknown>>(
  field: string,
  bound: T,
): T {
  const { holds } = bound;
  if (holds) {
    throw new Error(
      `"${field}" holds ${HELD_BY[holds.of] ?? `an opaque ${holds.of} field; bind it with the kit that created it`}.`,
    );
  }
  return bound;
}
