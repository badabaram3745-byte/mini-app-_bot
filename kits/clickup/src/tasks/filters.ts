import type { Ref } from "../core";
import { toEpochMs } from "../host/dates";
import type {
  EmbedDataQuery,
  EmbedDataQueryFilter,
  EmbedDataQueryFilterValue,
  EmbedDataQuerySortField,
  EmbedDataQueryStatusFilterValue,
} from "../host/wire";
import { PRIORITY_IDS } from "../host/wire";
import type { Status, TaskSelector } from "./tasks";

/** The wire status types behind each of the kit's; the inverse of `toStatusType`. */
const STATUS_BUCKETS: Readonly<
  Record<Status["type"], Array<EmbedDataQueryStatusFilterValue["type"]>>
> = {
  open: ["open", "unstarted", "placeholder"],
  active: ["active", "custom"],
  done: ["done"],
  closed: ["closed"],
};

const DATE_PRESET_OPS = {
  overdue: "overdue",
  today: "today",
  tomorrow: "tomorrow",
  next7Days: "next7",
} as const;

type DateField = "startDate" | "dueDate" | "dateCreated" | "dateUpdated";

type AnyDateFilter = NonNullable<TaskSelector["dueAt"]>;

/** Open ends of a range; the host treats an epoch of 0 as unset. */
const EARLIEST = Date.UTC(1971, 0, 1);
const LATEST = Date.UTC(2200, 0, 1);

const WIRE_FIELDS: Readonly<
  Record<NonNullable<TaskSelector["orderBy"]>["field"], EmbedDataQuerySortField>
> = {
  name: "name",
  priority: "priority",
  status: "status",
  startAt: "startDate",
  dueAt: "dueDate",
  createdAt: "dateCreated",
  updatedAt: "dateUpdated",
};

/** The `queryData` filters behind a selector, in the host's `{ field, op, values }` form. */
export function taskFilters(selector: TaskSelector): EmbedDataQueryFilter[] {
  const filters: EmbedDataQueryFilter[] = [];
  if (selector.status) {
    filters.push({
      field: "status",
      op: "EQ",
      values: Array.isArray(selector.status)
        ? selector.status.map((ref) => ref.name)
        : selector.status.type.flatMap((type) =>
            STATUS_BUCKETS[type].map((wireType) => ({ type: wireType })),
          ),
    });
  }
  if (selector.assignees) {
    filters.push(assigneesFilter(selector.assignees));
  }
  if (selector.priority) {
    filters.push({
      field: "priority",
      op: "EQ",
      values: selector.priority.map((level) => PRIORITY_IDS[level]),
    });
  }
  if (selector.tags) {
    filters.push({ field: "tag", op: "ANY", values: selector.tags });
  }
  if (selector.name) {
    filters.push({
      field: "name",
      op: "EQ",
      values: [{ method: "contains", value: selector.name.contains }],
    });
  }
  const dates: Array<[DateField, AnyDateFilter | undefined]> = [
    ["startDate", selector.startAt],
    ["dueDate", selector.dueAt],
    ["dateCreated", selector.createdAt],
    ["dateUpdated", selector.updatedAt],
  ];
  for (const [field, filter] of dates) {
    if (filter !== undefined) {
      filters.push(dateFilter(field, filter));
    }
  }
  return filters;
}

/** The `queryData` sort behind a selector; the host's own order without one. */
export function taskSort(selector: TaskSelector): EmbedDataQuery["sort"] {
  return selector.orderBy
    ? {
        field: WIRE_FIELDS[selector.orderBy.field],
        dir: selector.orderBy.direction ?? "asc",
      }
    : undefined;
}

function assigneesFilter(
  assignees: NonNullable<TaskSelector["assignees"]>,
): EmbedDataQueryFilter {
  if (assignees === "none") {
    return { field: "assignee", op: "NOT SET", values: [] };
  }
  if (assignees === "any") {
    return { field: "assignee", op: "IS SET", values: [] };
  }
  return { field: "assignee", op: "ANY", values: assignees.map(assigneeValue) };
}

/** Ids are numeric on the wire where they can be; a team is the app's `group_id` token. */
function assigneeValue(
  assignee: Ref<"user" | "team"> | "me",
): EmbedDataQueryFilterValue {
  if (assignee === "me") {
    return { me: true };
  }
  const numeric = Number(assignee.id);
  const id = Number.isFinite(numeric) ? numeric : assignee.id;
  return assignee.kind === "team" ? { group_id: id } : id;
}

function dateFilter(
  field: DateField,
  filter: AnyDateFilter,
): EmbedDataQueryFilter {
  if (filter === "none") {
    return { field, op: "NOT SET", values: [] };
  }
  if (filter === "any") {
    return { field, op: "IS SET", values: [] };
  }
  if (typeof filter === "string") {
    return { field, op: "EQ", values: [{ op: DATE_PRESET_OPS[filter] }] };
  }
  return {
    field,
    op: "EQ",
    values: [
      {
        op: "ra",
        startDate:
          filter.from === undefined ? EARLIEST : toEpochMs(filter.from),
        dueDate: filter.to === undefined ? LATEST : toEpochMs(filter.to),
      },
    ],
  };
}
