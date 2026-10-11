import * as z from "zod/v4-mini";
import en from "zod/v4/locales/en.js";
import type { AssetKind, Delta, IsoDate, Ref } from "./core";
import { ASSET_KINDS, idOf, LiveError } from "./core";
import { ARTIFACT_QUERY_MAX_LIMIT } from "./host/wire";

z.config({
  ...en(),
  customError: (issue) => {
    if (
      issue.code === "invalid_type" &&
      issue.input === undefined &&
      issue.path?.length
    ) {
      return "required";
    }
    if (issue.code === "too_small" && issue.origin === "string") {
      return "must not be empty";
    }
    return undefined;
  },
});

export type Schema<T> = z.ZodMiniType<T>;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Exactly<S extends z.ZodMiniType, T> =
  Equal<z.output<S>, T> extends true
    ? unknown
    : { "the schema's output differs from": T };

/**
 * Pins a schema to the public type it validates: `schemaOf<Task>()(z.object(…))`
 * compiles only when the schema accepts exactly the values of `Task`, so the
 * two cannot drift apart.
 */
export function schemaOf<T>() {
  return <S extends z.ZodMiniType>(schema: S & Exactly<S, T>): Schema<T> =>
    schema as unknown as Schema<T>;
}

export const id = z.string().check(z.minLength(1, "Expected a non-empty id"));

/** ISO 8601 as `Date#toISOString()` writes it; a plain `YYYY-MM-DD` is the viewer's day. */
export const isoDate: Schema<IsoDate> = z.union(
  [z.iso.datetime({ offset: true, local: true }), z.iso.date()],
  { error: "Expected an ISO 8601 date" },
);

export const delta: Schema<Delta> = z.object({
  ops: z.array(z.record(z.string(), z.unknown())),
});

/** The fields every ref has; spread into an asset schema. */
export function refFields<K extends AssetKind>(kinds: readonly [K, ...K[]]) {
  return {
    kind: z.enum(kinds),
    id,
    name: z.string(),
    url: z.string(),
    image: z.optional(z.string()),
  };
}

const HOOKS: Readonly<Record<AssetKind, string>> = {
  space: "useSpaces",
  folder: "useFolders",
  list: "useLists",
  status: "useStatuses",
  customField: "useCustomFields",
  task: "useTasks",
  taskType: "useTaskTypes",
  comment: "useComments",
  user: "useUsers",
  team: "useTeams",
  inboxBundle: "useInbox",
  reminder: "useReminders",
};

function sourceOf(kind: AssetKind): string {
  return HOOKS[kind];
}

/** A ref of one of `kinds`, as its hook returns it; a full asset passes. */
export function ref<K extends AssetKind>(
  kinds: readonly [K, ...K[]],
): Schema<Ref<K>> {
  const fields = z.object(refFields(kinds));
  return z.custom<Ref<K>>((value) => fields.safeParse(value).success, {
    error: `Expected a ${either(kinds)} ref, from ${either(kinds.map(sourceOf))}`,
  });
}

function either(words: readonly string[]): string {
  return words.length > 1
    ? `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`
    : words[0]!;
}

export const anyRef = ref(ASSET_KINDS);

/** A ref of `kind`, or its bare id. */
export function refOrId<K extends AssetKind>(kind: K): Schema<Ref<K> | string> {
  return z.union([id, ref([kind])], {
    error: `Expected a ${kind} ref, from ${sourceOf(kind)}, or a ${kind} id`,
  });
}

/** A selector's `limit`: a positive whole number up to the kind's cap. */
export function limit(max = ARTIFACT_QUERY_MAX_LIMIT) {
  return z.optional(
    z.int().check(z.positive(), z.maximum(max, `Expected at most ${max}`)),
  );
}

/** What every selector takes besides its scope and filters. */
export const selection = {
  limit: limit(),
};

const text = z.string().check(z.minLength(1, "Expected text to look for"));

/** A selector's `{ contains }` text filter; `max` caps the text where the host does. */
export function contains(max?: number) {
  return z.optional(
    z.strictObject({
      contains: max === undefined ? text : text.check(z.maxLength(max)),
    }),
  );
}

/** A selector's `orderBy`: one of `fields`, with an optional direction. */
export function orderBy<F extends string>(fields: readonly [F, ...F[]]) {
  return z.optional(
    z.strictObject({
      field: z.enum(fields),
      direction: z.optional(z.enum(["asc", "desc"])),
    }),
  );
}

/** A selector below the workspace names a `parent` or an `ancestor`, never both; nothing lists everything. */
export const scoped = z.refine<{ parent?: unknown; ancestor?: unknown }>(
  (selector) =>
    (selector.parent !== undefined) !== (selector.ancestor !== undefined),
  { error: "Pass parent or ancestor, not both" },
);

/** The refs or ids a `get` takes, read as distinct ids in the order given. */
export function targets<K extends AssetKind>(kind: K): Schema<string[]> {
  return z.pipe(
    z.array(refOrId(kind)),
    z.transform((refs) => [...new Set(refs.map(idOf))]),
  );
}

/** `input` as `schema` reads it, or `invalid` naming every problem at once. */
export function check<T>(schema: Schema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new LiveError("invalid", describe(result.error.issues));
}

/** `value` as read from the host, or `failed` when it is not the `what` the kit promises. */
export function fromHost<T>(
  schema: Schema<T>,
  value: unknown,
  what: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  throw new LiveError(
    "failed",
    `The host returned unexpected ${what}: ${describe(result.error.issues)}`,
  );
}

function describe(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join(".")}: ${issue.message}`
        : issue.message,
    )
    .join("; ");
}
