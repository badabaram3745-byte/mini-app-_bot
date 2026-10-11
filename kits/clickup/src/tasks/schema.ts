import * as z from "zod/v4-mini";
import { CUSTOM_FIELD_TYPES } from "../customFields/customFields";
import {
  EMBED_DATA_QUERY_MAX_FILTER_VALUES,
  EMBED_DATA_QUERY_VALUE_MAX_LENGTH,
} from "../host/wire";
import type { Schema } from "../validate";
import {
  contains,
  delta,
  id,
  isoDate,
  orderBy,
  ref,
  refFields,
  refOrId,
  schemaOf,
  scoped,
  selection,
} from "../validate";
import type {
  ChecklistItem,
  CreateTaskInput,
  DateFilter,
  DateRange,
  Status,
  StatusSelector,
  Task,
  TaskPatch,
  TaskSelector,
  TaskType,
} from "./tasks";
import { DATE_PRESETS, PRIORITIES, STATUS_TYPES, TASK_ORDERS } from "./tasks";

export const StatusSchema = schemaOf<Status>()(
  z.object({
    ...refFields(["status"]),
    type: z.enum(STATUS_TYPES),
    color: z.string(),
  }),
);

export const StatusSelectorSchema = schemaOf<StatusSelector>()(
  z.strictObject({
    parent: z.union([id, ref(["space", "folder", "list"])], {
      error:
        "Expected a space, folder or list ref, from useSpaces, useFolders or useLists, or a list id",
    }),
  }),
);

const priority = z.enum(PRIORITIES);
const assignee = ref(["user", "team"]);
const tag = z.object({ name: z.string(), color: z.string() });
const customFieldValue = z.object({
  id,
  name: z.string(),
  type: z.enum(CUSTOM_FIELD_TYPES),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(ref(["user", "team", "task"])),
  ]),
});

export const TaskTypeSchema = schemaOf<TaskType>()(
  z.object({
    ...refFields(["taskType"]),
    description: z.optional(z.string()),
  }),
);

export const ChecklistItemSchema: Schema<ChecklistItem> = z.object({
  id: z.string(),
  name: z.string(),
  done: z.optional(z.boolean()),
  get items() {
    return z.array(ChecklistItemSchema);
  },
});

export const TaskSchema = schemaOf<Task>()(
  z.object({
    ...refFields(["task"]),
    ancestors: z.array(ref(["space", "folder", "list", "task"])),
    otherLists: z.array(ref(["list"])),
    private: z.boolean(),
    createdAt: isoDate,
    updatedAt: isoDate,
    startAt: z.optional(isoDate),
    dueAt: z.optional(isoDate),
    status: StatusSchema,
    type: TaskTypeSchema,
    priority: z.optional(priority),
    points: z.optional(z.number()),
    tags: z.array(tag),
    customFields: z.array(customFieldValue),
    body: delta,
    creator: ref(["user"]),
    assignees: z.array(assignee),
    watchers: z.array(ref(["user"])),
    checklists: z.array(ChecklistItemSchema),
  }),
);

export const TaskPatchSchema = schemaOf<TaskPatch>()(
  z.strictObject({
    name: z.optional(z.string()),
    bodyMarkdown: z.optional(z.string()),
    status: z.optional(ref(["status"])),
    type: z.optional(refOrId("taskType")),
    priority: z.optional(z.nullable(priority)),
    points: z.optional(z.nullable(z.number())),
    startAt: z.optional(z.nullable(isoDate)),
    dueAt: z.optional(z.nullable(isoDate)),
    parent: z.optional(refOrId("task")),
    assignees: z.optional(z.array(assignee)),
    watchers: z.optional(z.array(ref(["user"]))),
    tags: z.optional(z.array(tag)),
    customFields: z.optional(z.array(customFieldValue)),
    checklists: z.optional(z.array(ChecklistItemSchema)),
  }),
);

export const CreateTaskInputSchema = schemaOf<CreateTaskInput>()(
  z.strictObject({
    list: refOrId("list"),
    parent: z.optional(refOrId("task")),
    name: z.string().check(z.minLength(1, "A task needs a name")),
    bodyMarkdown: z.optional(z.string()),
    status: z.optional(ref(["status"])),
    type: z.optional(refOrId("taskType")),
    priority: z.optional(priority),
    dueAt: z.optional(isoDate),
    startAt: z.optional(isoDate),
    assignees: z.optional(z.array(assignee)),
  }),
);

const filterValues = [
  z.minLength(1, "Expected at least one value"),
  z.maxLength(
    EMBED_DATA_QUERY_MAX_FILTER_VALUES,
    `At most ${EMBED_DATA_QUERY_MAX_FILTER_VALUES} values per filter`,
  ),
];
const dateRange: Schema<DateRange> = z
  .strictObject({ from: z.optional(isoDate), to: z.optional(isoDate) })
  .check(
    z.refine((range) => range.from !== undefined || range.to !== undefined, {
      error: "A date range needs from or to",
    }),
  );
function dateFilter<E extends string = never>(
  ...extra: E[]
): Schema<DateFilter | E> {
  const presets = [...DATE_PRESETS, ...extra] as [string, ...string[]];
  return z.union([z.enum(presets), dateRange], {
    error: `Expected ${presets.map((preset) => `"${preset}"`).join(", ")}, or { from?, to? } as ISO 8601 dates`,
  }) as Schema<DateFilter | E>;
}

export const TaskSelectorSchema = schemaOf<TaskSelector>()(
  z
    .strictObject({
      parent: z.optional(refOrId("list")),
      ancestor: z.optional(ref(["space", "folder", "list"])),
      ...selection,
      includeClosed: z.optional(z.boolean()),
      status: z.optional(
        z.union(
          [
            z.array(ref(["status"])).check(...filterValues),
            z.strictObject({ type: z.array(z.enum(STATUS_TYPES)) }),
          ],
          {
            error: `Expected statuses from useStatuses, or { type: [${STATUS_TYPES.map((type) => `"${type}"`).join(" | ")}] }`,
          },
        ),
      ),
      assignees: z.optional(
        z.union(
          [
            z
              .array(z.union([ref(["user", "team"]), z.literal("me")]))
              .check(...filterValues),
            z.literal("none"),
            z.literal("any"),
          ],
          {
            error:
              'Expected user or team refs, as useUsers and useTeams return, or "me"; or "none" or "any"',
          },
        ),
      ),
      priority: z.optional(z.array(priority).check(...filterValues)),
      tags: z.optional(z.array(z.string()).check(...filterValues)),
      name: contains(EMBED_DATA_QUERY_VALUE_MAX_LENGTH),
      startAt: z.optional(dateFilter("none", "any")),
      dueAt: z.optional(dateFilter("none", "any", "overdue")),
      createdAt: z.optional(dateFilter()),
      updatedAt: z.optional(dateFilter()),
      orderBy: orderBy(TASK_ORDERS),
    })
    .check(scoped),
);

export const TaskRowsSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
});
