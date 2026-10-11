import type {
  QueryStatus,
  Ref,
  UseQueryOptions,
  UseQueryResult,
} from "../core";
import {
  clickup,
  LiveError,
  useCustomFields,
  useMutation,
  useStatuses,
  useTasks,
} from "../index";
import type { CustomField } from "../customFields/customFields";
import type {
  CreateTaskInput,
  Status,
  Task,
  TaskPatch,
  TaskSelector,
} from "../tasks/tasks";
import type {
  Entity,
  EntityClient,
  EntitySchema,
  FieldSpec,
  ListFilter,
  NativeProperty,
  RecordBase,
} from "./types";

export type { Entity, EntitySchema, ListFilter, RecordBase } from "./types";

type FieldValue = Task["customFields"][number]["value"];
type Changes = Readonly<Record<string, unknown>>;

const NUMERIC_TYPES = new Set<CustomField["type"]>([
  "number",
  "currency",
  "emoji",
  "manual_progress",
  "votes",
]);

const READ_NATIVE: Record<NativeProperty, (task: Task) => unknown> = {
  name: (task) => task.name,
  status: (task) => task.status.name,
  assignees: (task) => task.assignees,
  dueDate: (task) => task.dueAt,
  startDate: (task) => task.startAt,
  priority: (task) => task.priority,
  description: (task) => task.body,
};

const nullable = (value: unknown) => (value === null ? null : String(value));
const WRITE_NATIVE: Record<
  Exclude<NativeProperty, "status">,
  (value: unknown) => TaskPatch
> = {
  name: (value) => ({ name: String(value) }),
  assignees: (value) => ({
    assignees: isRefArray(value) ? (value as Task["assignees"]) : [],
  }),
  dueDate: (value) => ({ dueAt: nullable(value) }),
  startDate: (value) => ({ startAt: nullable(value) }),
  priority: (value) => ({
    priority: value === null ? null : (value as Task["priority"]),
  }),
  description: (value) => ({ bodyMarkdown: String(value) }),
};

/** The entities whose drift check ran this session. */
const seen = new Set<string>();

/**
 * Typed records over a schema the `solution` CLI provisioned: a record is one
 * task in the entity's List, its custom fields named by the schema's logical
 * keys. Reads are shaped like TanStack Query's `useQuery`, writes like
 * `useMutation`, and every write waits for the viewer's approval.
 */
export function defineEntity<
  R extends RecordBase,
  I extends object,
  P extends object,
  S extends string,
>(schema: EntitySchema): Entity<R, I, P, S> {
  const { list, key } = schema;
  const listRef: Ref<"list"> = { kind: "list", ...list };
  const readable = schema.fields.filter((field) => field.readable);
  const listName = JSON.stringify(list.name);
  const typeId =
    schema.taskType === undefined ? undefined : String(schema.taskType.id);

  /** Whether the task is one of this entity's records: any task when the schema names no type. */
  function isRecord(task: Task): boolean {
    return typeId === undefined || task.type.id === typeId;
  }

  function decode(task: Task): R {
    const record: Record<string, unknown> = {
      id: task.id,
      url: task.url,
      task,
    };
    for (const native of schema.natives) {
      record[native.key] = READ_NATIVE[native.native](task);
    }
    const values = new Map(task.customFields.map((f) => [f.id, f.value]));
    for (const spec of readable) {
      const value = values.get(spec.id);
      if (spec.type === "list_relationship") {
        const refs = isRefArray(value) ? value : [];
        record[`${spec.key}Ids`] = refs.map((ref) => ref.id);
        record[`${spec.key}Refs`] = refs;
      } else if (value !== undefined) {
        record[spec.key] = decodeValue(spec, value);
      }
    }
    return record as unknown as R;
  }

  /** The custom-field collection with the changed schema fields applied; undefined when none changed. */
  function mergedFields(
    current: Task["customFields"],
    changes: Changes,
  ): Task["customFields"] | undefined {
    const next = new Map(current.map((field) => [field.id, field]));
    let touched = false;
    for (const spec of schema.fields) {
      const value = changes[spec.key];
      if (value === undefined) continue;
      if (spec.readOnly) {
        throw new LiveError(
          "invalid",
          `${JSON.stringify(spec.name)} (${spec.type}) cannot be written through the live kit yet.`,
        );
      }
      touched = true;
      if (value === null) next.delete(spec.id);
      else {
        const { id, name, type } = spec;
        next.set(id, { id, name, type, value: encodeValue(spec, value) });
      }
    }
    return touched ? [...next.values()] : undefined;
  }

  async function nativePatch(changes: Changes): Promise<TaskPatch> {
    const patch: TaskPatch = {};
    for (const { key: property, native } of schema.natives) {
      const value = changes[property];
      if (value === undefined) continue;
      Object.assign(
        patch,
        native === "status"
          ? { status: await statusByName(String(value)) }
          : WRITE_NATIVE[native](value),
      );
    }
    return patch;
  }

  async function statusByName(name: string): Promise<Status> {
    return findStatus(await clickup.tasks.statuses({ parent: list.id }), name);
  }

  function findStatus(statuses: readonly Status[], name: string): Status {
    const wanted = name.toLowerCase();
    const match = statuses.find((s) => s.name.toLowerCase() === wanted);
    if (match) return match;
    const known = statuses.map((s) => s.name).join(", ");
    throw new LiveError(
      "invalid",
      `${JSON.stringify(name)} is not a status of List ${listName}; statuses: ${known}.`,
    );
  }

  /** The task with `id`, whether or not it is in this entity's List. */
  async function taskById(id: string): Promise<Task> {
    const [task] = await clickup.tasks.get([id]);
    if (!task) {
      throw new LiveError(
        "invalid",
        `No task with id ${id}, or it is not visible to you.`,
      );
    }
    return task;
  }

  /** What ClickUp is asked for: the ids themselves, or the List with the filters it applies. */
  function toSelector(
    filter: ListFilter<R, S>,
    statusRefs: Ref<"status">[] | undefined,
  ): TaskSelector | string[] {
    if (filter.ids !== undefined) return [...filter.ids];
    const selector: TaskSelector = { parent: list.id };
    if (statusRefs) selector.status = statusRefs;
    else if (filter.statusType)
      selector.status = { type: [...filter.statusType] };
    if (filter.limit !== undefined) selector.limit = filter.limit;
    if (filter.includeClosed !== undefined)
      selector.includeClosed = filter.includeClosed;
    return selector;
  }

  /** The browser-side part of a filter; all of it when ClickUp only saw ids. */
  function refine(
    tasks: Task[],
    filter: ListFilter<R, S>,
    byIds: boolean,
  ): R[] {
    let out = tasks.filter(isRecord).map(decode);
    if (byIds && filter.status) {
      const names = new Set(filter.status.map((name) => name.toLowerCase()));
      out = out.filter((r) => names.has(r.task.status.name.toLowerCase()));
    }
    if (filter.statusType && (byIds || filter.status)) {
      const types = new Set<string>(filter.statusType);
      out = out.filter((r) => types.has(r.task.status.type));
    }
    if (filter.where) out = out.filter(filter.where);
    if (filter.orderBy) {
      const { field, direction } = filter.orderBy;
      const sign = direction === "desc" ? -1 : 1;
      out = [...out].sort((a, b) => sign * compare(a[field], b[field]));
    }
    if (byIds && filter.limit !== undefined) out = out.slice(0, filter.limit);
    return out;
  }

  const client: EntityClient<R, I, P, S> = {
    async list(filter = {}) {
      const byIds = filter.ids !== undefined;
      const statusRefs =
        !byIds && filter.status?.length
          ? await Promise.all(filter.status.map(statusByName))
          : undefined;
      const selector = toSelector(filter, statusRefs);
      const tasks = Array.isArray(selector)
        ? await clickup.tasks.get(selector)
        : await clickup.tasks.list(selector);
      return refine(tasks, filter, byIds);
    },
    async get(id) {
      return decode(await taskById(id));
    },
    async create(input) {
      const changes = input as Changes;
      const {
        name,
        bodyMarkdown,
        status,
        priority,
        dueAt,
        startAt,
        assignees,
      } = await nativePatch(changes);
      if (!name) {
        throw new LiveError("invalid", `A new ${key} record needs a name.`);
      }
      const created = await clickup.tasks.create({
        list: list.id,
        name,
        bodyMarkdown,
        status,
        type: typeId,
        priority: priority ?? undefined,
        dueAt: dueAt ?? undefined,
        startAt: startAt ?? undefined,
        assignees,
      } satisfies CreateTaskInput);
      const customFields = mergedFields([], changes);
      if (customFields?.length) {
        if (!created) {
          throw new LiveError(
            "failed",
            "ClickUp created the task but did not report its id, so its fields were not written; set them in ClickUp or create the record again.",
          );
        }
        await clickup.tasks.update(created, { customFields });
      }
      return created;
    },
    async update(id, patch) {
      const changes = patch as Changes;
      const task = await taskById(id);
      const taskPatch = await nativePatch(changes);
      const customFields = mergedFields(task.customFields, changes);
      if (customFields !== undefined) taskPatch.customFields = customFields;
      await clickup.tasks.update(task, taskPatch);
    },
    async close(id) {
      const statuses = await clickup.tasks.statuses({ parent: list.id });
      const closing =
        statuses.find((s) => s.type === "closed") ??
        [...statuses].reverse().find((s) => s.type === "done");
      if (!closing) {
        throw new LiveError(
          "invalid",
          `List ${listName} has no closing status.`,
        );
      }
      await clickup.tasks.update(id, { status: closing });
    },
  };

  /** Once per entity per session; a missing field is a warning, never a failed read. */
  function useDriftCheck(enabled: boolean): void {
    const pending = enabled && readable.length > 0 && !seen.has(`drift:${key}`);
    const fields = useCustomFields({ parent: listRef }, { enabled: pending });
    if (!pending || fields.data === undefined) return;
    seen.add(`drift:${key}`);
    const present = new Set(fields.data.map((field) => field.id));
    const missing = readable.filter((field) => !present.has(field.id));
    if (missing.length > 0) {
      const named = missing.map((f) => `${f.key} (${f.id})`).join(", ");
      console.warn(
        `${key}: ${named} ${missing.length === 1 ? "is" : "are"} not on List ${listName} as the viewer sees it; the record leaves them unset. Run solution apply (or solution codegen) to regenerate this directory if the schema changed.`,
      );
    }
  }

  function useList(
    filter: ListFilter<R, S> = {},
    options: UseQueryOptions<Task[]> = {},
  ): UseQueryResult<R[]> {
    const enabled = options.enabled !== false;
    const byIds = filter.ids !== undefined;
    const wantsStatuses = !byIds && (filter.status?.length ?? 0) > 0;
    const statuses = useStatuses(
      { parent: list.id },
      { enabled: enabled && wantsStatuses },
    );
    let statusRefs: Ref<"status">[] | undefined;
    let statusError: LiveError | null = null;
    if (wantsStatuses && statuses.data) {
      try {
        statusRefs = filter.status!.map((name) =>
          findStatus(statuses.data!, name),
        );
      } catch (error) {
        statusError = error as LiveError;
      }
    }
    const tasks = useTasks(toSelector(filter, statusRefs), {
      ...options,
      enabled: enabled && (!wantsStatuses || statusRefs !== undefined),
    });
    useDriftCheck(enabled);
    const data = tasks.data && refine(tasks.data, filter, byIds);
    const error = statusError ?? statuses.error ?? tasks.error;
    const status: QueryStatus = error
      ? "error"
      : data !== undefined
        ? "success"
        : "pending";
    const isPending = status === "pending";
    const isFetching = statuses.isFetching || tasks.isFetching;
    return {
      data,
      error,
      status,
      isPending,
      isLoading: isPending && isFetching,
      isFetching,
      isRefetching: isFetching && !isPending,
      isPlaceholderData: tasks.isPlaceholderData,
      isError: status === "error",
      isSuccess: status === "success",
      dataUpdatedAt: tasks.dataUpdatedAt,
      refetch: tasks.refetch,
    };
  }

  function useOne(
    id: string | undefined,
    options: UseQueryOptions<Task[]> = {},
  ): UseQueryResult<R | undefined> {
    return mapResult(
      useTasksByIds(id === undefined ? [] : [id], options),
      (tasks) => (tasks[0] ? decode(tasks[0]) : undefined),
    );
  }

  return {
    schema,
    decode,
    client,
    useList,
    useOne,
    useMany: (ids, options = {}) =>
      mapResult(useTasksByIds(ids, options), (tasks) => tasks.map(decode)),
    useCreate: () => useMutation((input: I) => client.create(input)),
    useUpdate: () =>
      useMutation((variables: { id: string; patch: P }) =>
        client.update(variables.id, variables.patch),
      ),
    useClose: () => useMutation((id: string) => client.close(id)),
  };
}

/**
 * Tasks by id, in the order given. An empty list is a settled `[]` with no
 * loading state, so a relationship hook fed an unlinked record renders its
 * empty state at once.
 */
export function useTasksByIds(
  ids: readonly string[],
  options: UseQueryOptions<Task[]> = {},
): UseQueryResult<Task[]> {
  const result = useTasks([...ids], {
    ...options,
    enabled: options.enabled !== false && ids.length > 0,
  });
  return ids.length > 0
    ? result
    : {
        ...result,
        data: [],
        error: null,
        status: "success",
        isPending: false,
        isLoading: false,
        isRefetching: false,
        isError: false,
        isSuccess: true,
      };
}

function mapResult<T, U>(
  result: UseQueryResult<T>,
  fn: (data: T) => U,
): UseQueryResult<U> {
  return { ...result, data: result.data && fn(result.data) };
}

/** A ClickUp value as the record expects it: option labels become logical keys. */
function decodeValue(spec: FieldSpec, value: FieldValue): unknown {
  if (spec.type === "drop_down") {
    return typeof value === "string" ? optionKey(spec, value) : value;
  }
  if (spec.type === "labels") {
    return Array.isArray(value)
      ? value.map((e) => optionKey(spec, typeof e === "string" ? e : e.name))
      : [optionKey(spec, String(value))];
  }
  if (spec.type === "checkbox") return value === true || value === "true";
  if (NUMERIC_TYPES.has(spec.type)) return Number(value);
  if (spec.type === "users") return isRefArray(value) ? value : [];
  if (spec.type === "attachment") {
    return Array.isArray(value) ? value.filter(isString) : [];
  }
  return value;
}

/** A record value as ClickUp takes it: option keys back to labels. */
function encodeValue(spec: FieldSpec, value: unknown): FieldValue {
  if (spec.type === "drop_down") return optionLabel(spec, String(value));
  if (spec.type === "labels") {
    return (Array.isArray(value) ? value : [value]).map((k) =>
      optionLabel(spec, String(k)),
    );
  }
  if (spec.type === "checkbox") return Boolean(value);
  if (NUMERIC_TYPES.has(spec.type)) return Number(value);
  return String(value);
}

/** A label the schema never named passes through as its own key. */
function optionKey(spec: FieldSpec, label: string): string {
  const entry = Object.entries(spec.options ?? {}).find(
    ([, option]) => option.label === label,
  );
  return entry ? entry[0] : label;
}

function optionLabel(spec: FieldSpec, key: string): string {
  return spec.options?.[key]?.label ?? key;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRefArray(value: unknown): value is Ref[] {
  return (
    Array.isArray(value) &&
    value.every((e) => typeof e?.id === "string" && typeof e?.kind === "string")
  );
}

/** Numbers by value, everything else by text; unset values sort last. */
function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}
