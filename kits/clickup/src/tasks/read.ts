import * as z from "zod/v4-mini";
import { DEFAULT_COLOR } from "../components/palette";
import type { Ref } from "../core";
import { mapCustomFieldValues } from "../customFields/read";
import type { LiveBridge } from "../host/bridge";
import { toIso, toIsoOrEpoch } from "../host/dates";
import { chunk, pages } from "../host/paging";
import { paragraph } from "../host/quill";
import type {
  ArtifactChecklistDto,
  ArtifactChecklistItemDto,
  ArtifactTaskDto,
} from "../host/wire";
import {
  ARTIFACT_QUERY_MAX_TASK_IDS,
  EMBED_DATA_QUERY_MAX_LIMIT,
  OBJECT_TYPES,
  refOf,
} from "../host/wire";
import { teamsOf, userOf, usersOf } from "../people/read";
import { clampLimit } from "../select";
import type { Session } from "../session";
import { scopeOf } from "../session";
import { fromHost } from "../validate";
import { taskFilters, taskSort } from "./filters";
import { TaskRowsSchema, TaskSchema } from "./schema";
import { mapStatus } from "./statuses";
import { taskTypeOf } from "./taskTypes";
import type { ChecklistItem, Task, TaskSelector } from "./tasks";
import { PRIORITIES } from "./tasks";

export async function readTasks(
  s: Session,
  selector: TaskSelector,
): Promise<Task[]> {
  const limit = clampLimit(selector.limit);
  const scope = scopeOf(selector);
  const ids = await listTaskIds(
    s.host,
    typeof scope === "string" ? { kind: "list", id: scope } : scope,
    selector,
    limit,
  );
  return getTasks(s, ids.slice(0, limit));
}

/** Full tasks in the order of `ids`. */
export async function getTasks(s: Session, ids: string[]): Promise<Task[]> {
  const batches = await Promise.all(
    chunk(ids, ARTIFACT_QUERY_MAX_TASK_IDS).map(async (batch) => {
      const dtos = await s.host.query("tasks", { ids: batch });
      const byId = new Map(dtos.map((dto) => [dto.id, dto]));
      return Promise.all(
        batch.flatMap((id) => {
          const dto = byId.get(id);
          return dto ? [mapTask(s, dto)] : [];
        }),
      );
    }),
  );
  return fromHost(z.array(TaskSchema), batches.flat(), "tasks");
}

/** The host relays the workspace query's own `{ rows }` under `result`. */
export async function queryTasks(
  s: Session,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const { result } = await s.host.query("queryWorkspace", { sql });
  return fromHost(TaskRowsSchema, result, "rows").rows;
}

/** The ids the host's list view returns for the scope, filtered and sorted server-side. */
async function listTaskIds(
  host: LiveBridge,
  scope: Pick<Ref<"space" | "folder" | "list">, "kind" | "id">,
  selector: TaskSelector,
  limit: number,
): Promise<string[]> {
  const ids: string[] = [];
  for await (const page of pages((cursor) =>
    host.queryData({
      entity: "task",
      location: { id: scope.id, type: OBJECT_TYPES[scope.kind] },
      filters: taskFilters(selector),
      includeClosed: selector.includeClosed ?? false,
      sort: taskSort(selector),
      limit: EMBED_DATA_QUERY_MAX_LIMIT,
      cursor,
    }),
  )) {
    ids.push(...page.rows.map((row) => row.id));
    if (ids.length >= limit) {
      break;
    }
  }
  return ids;
}

async function mapTask(s: Session, wire: ArtifactTaskDto): Promise<Task> {
  const [location, type, creator, users, teams, watchers, customFields] =
    await Promise.all([
      s.path(wire.location),
      taskTypeOf(s, wire.typeId),
      userOf(s, wire.creator),
      usersOf(s, wire.assignees),
      teamsOf(s, wire.groupAssignees),
      usersOf(s, wire.followers),
      mapCustomFieldValues(s, wire.customFields ?? []),
    ]);
  return {
    kind: "task",
    id: wire.id,
    name: wire.name,
    url: wire.url,
    ancestors: wire.parent
      ? [...location, refOf("task", wire.parent)]
      : location,
    otherLists: wire.locations.map((list) => refOf("list", list)),
    private: wire.private,
    createdAt: toIsoOrEpoch(wire.dateCreated),
    updatedAt: toIsoOrEpoch(wire.dateUpdated),
    startAt: toIso(wire.startDate),
    dueAt: toIso(wire.dueDate),
    status: mapStatus(wire.status),
    type,
    priority: toPriority(wire.priority),
    points: wire.points,
    tags: wire.tags
      .map((tag) => ({ name: tag.name, color: tag.tagBg || DEFAULT_COLOR }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    customFields,
    body: wire.descriptionQuill ?? paragraph(wire.markdownDescription),
    creator,
    assignees: [...users, ...teams],
    watchers,
    checklists: wire.checklists.map(mapChecklist),
  };
}

function toPriority(value: string | undefined): Task["priority"] {
  return (PRIORITIES as readonly string[]).includes(value ?? "")
    ? (value as Task["priority"])
    : undefined;
}

/** A checklist is a heading with no `done`; its items, at any depth, are checkable. */
function mapChecklist(wire: ArtifactChecklistDto): ChecklistItem {
  return {
    id: wire.id,
    name: wire.name,
    items: sortByOrder(wire.items).map(mapChecklistItem),
  };
}

function mapChecklistItem(wire: ArtifactChecklistItemDto): ChecklistItem {
  return {
    id: wire.id,
    name: wire.name,
    done: wire.resolved,
    items: sortByOrder(wire.children).map(mapChecklistItem),
  };
}

function sortByOrder<T extends { orderindex: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.orderindex - b.orderindex);
}
