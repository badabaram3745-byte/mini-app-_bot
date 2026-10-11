import * as z from "zod/v4-mini";
import type { Ref } from "../core";
import { asRef } from "../core";
import { toIso } from "../host/dates";
import { pages } from "../host/paging";
import type { ArtifactReminder } from "../host/wire";
import { ARTIFACT_REMINDERS_MAX_LIMIT } from "../host/wire";
import { byIds, clampLimit } from "../select";
import type { Session } from "../session";
import { getTasks } from "../tasks/read";
import { fromHost } from "../validate";
import type { Reminder, ReminderSelector } from "./reminders";
import { ReminderSchema } from "./schema";

export async function readReminders(
  s: Session,
  selector: ReminderSelector,
): Promise<Reminder[]> {
  const wire = await loadReminders(
    s,
    selector.includeCompleted ?? false,
    clampLimit(selector.limit),
  );
  return mapReminders(s, wire);
}

export async function getReminders(
  s: Session,
  ids: string[],
): Promise<Reminder[]> {
  const wire = await loadReminders(s, true, Infinity);
  return mapReminders(s, byIds(wire, ids));
}

/** The viewer's reminders, oldest page first, until `limit` are read or none are left. */
async function loadReminders(
  s: Session,
  includeCompleted: boolean,
  limit: number,
): Promise<ArtifactReminder[]> {
  const wire: ArtifactReminder[] = [];
  for await (const page of pages((cursor) =>
    s.host.query("reminders", {
      includeCompleted,
      limit: ARTIFACT_REMINDERS_MAX_LIMIT,
      cursor,
    }),
  )) {
    wire.push(...page.reminders);
    if (wire.length >= limit) {
      break;
    }
  }
  return wire.slice(0, limit);
}

async function mapReminders(
  s: Session,
  wire: ArtifactReminder[],
): Promise<Reminder[]> {
  const tasks = await relatedTasks(s, wire);
  return fromHost(
    z.array(ReminderSchema),
    wire.map((reminder) => mapReminder(reminder, tasks)),
    "reminders",
  );
}

/** The wire names a reminder's task by id only; one tasks read names the ones the viewer can see. */
async function relatedTasks(
  s: Session,
  wire: readonly ArtifactReminder[],
): Promise<Map<string, Ref<"task">>> {
  const ids = [...new Set(wire.flatMap((reminder) => reminder.taskId ?? []))];
  if (ids.length === 0) {
    return new Map();
  }
  const tasks = await getTasks(s, ids);
  return new Map(tasks.map((task) => [task.id, asRef(task)]));
}

function mapReminder(
  wire: ArtifactReminder,
  tasks: ReadonlyMap<string, Ref<"task">>,
): Reminder {
  return {
    kind: "reminder",
    id: wire.id,
    name: wire.title,
    url: "",
    dueAt: toIso(wire.dueDate),
    completedAt: toIso(wire.completedAt),
    related: wire.taskId
      ? (tasks.get(wire.taskId) ?? {
          kind: "task",
          id: wire.taskId,
          name: "",
          url: "",
        })
      : undefined,
  };
}
