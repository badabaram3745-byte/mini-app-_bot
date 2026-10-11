import type { Ref } from "../core";
import { idOf, LiveError } from "../core";
import { toEpochMinuteString } from "../host/dates";
import type { WireCall } from "../host/perform";
import { createdRef, perform, performAll } from "../host/perform";
import { paragraph } from "../host/quill";
import { ArtifactWriteActionType as Action, PRIORITY_IDS } from "../host/wire";
import type { Session } from "../session";
import { resolve } from "../session";
import { applyPatch } from "../store";
import { syncChecklists } from "./checklists";
import { getTasks } from "./read";
import type { CreateTaskInput, Task, TaskPatch } from "./tasks";

/** Applies `patch` to the task optimistically, then through the host. */
export async function updateTask(
  s: Session,
  target: Ref<"task"> | string,
  patch: TaskPatch,
): Promise<void> {
  const task = await resolve(s, "task", target, getTasks);
  await s.store.update(
    task,
    (current) => applyTaskPatch(current, patch),
    async () => {
      await performAll(s.host, taskPatchCalls(task, patch));
      if (patch.checklists !== undefined) {
        await syncChecklists(s.host, task, patch.checklists);
      }
    },
  );
}

/** Creates the task, then adds any team assignees, which the create action itself cannot take. */
export async function createTask(
  s: Session,
  input: CreateTaskInput,
): Promise<Ref<"task">> {
  const users = input.assignees?.filter((ref) => ref.kind === "user") ?? [];
  const teams = input.assignees?.filter((ref) => ref.kind === "team") ?? [];
  const outcome = await perform(s.host, Action.CreateTask, {
    listId: idOf(input.list),
    name: input.name,
    ...(input.parent ? { parentTaskId: idOf(input.parent) } : {}),
    ...(input.bodyMarkdown !== undefined
      ? { description: input.bodyMarkdown }
      : {}),
    ...(input.status ? { status: input.status.name } : {}),
    ...(input.type !== undefined ? { typeId: idOf(input.type) } : {}),
    ...(input.priority ? { priority: PRIORITY_IDS[input.priority] } : {}),
    ...(input.dueAt ? { dueDate: toEpochMinuteString(input.dueAt) } : {}),
    ...(input.startAt ? { startDate: toEpochMinuteString(input.startAt) } : {}),
    ...(users.length > 0
      ? { assigneeUserIds: users.map((ref) => ref.id).join(",") }
      : {}),
  });
  const created = createdRef("task", outcome, input.name);
  for (const team of teams) {
    await perform(s.host, Action.AddTaskGroupAssignee, {
      taskId: created.id,
      groupId: team.id,
    });
  }
  await s.store.invalidate("task");
  return created;
}

/** The ordered host calls that apply `patch` to `task`; checklists are synced apart by `syncChecklists`. */
export function taskPatchCalls(task: Task, patch: TaskPatch): WireCall[] {
  const taskId = task.id;
  const calls: WireCall[] = [];

  if (patch.name !== undefined) {
    calls.push([Action.SetTaskName, { taskId, name: patch.name }]);
  }
  if (patch.status !== undefined) {
    calls.push([Action.SetTaskStatus, statusParams(taskId, patch.status)]);
  }
  if (patch.type !== undefined) {
    calls.push([Action.SetTaskType, { taskId, typeId: idOf(patch.type) }]);
  }
  if (patch.priority !== undefined) {
    calls.push([
      Action.SetTaskPriority,
      {
        taskId,
        priority:
          patch.priority === null ? "none" : PRIORITY_IDS[patch.priority],
      },
    ]);
  }
  if (patch.points !== undefined) {
    calls.push([
      Action.SetTaskPoints,
      { taskId, points: patch.points === null ? "none" : String(patch.points) },
    ]);
  }
  if (patch.dueAt !== undefined) {
    calls.push(
      patch.dueAt === null
        ? [Action.ClearTaskDueDate, { taskId }]
        : [
            Action.SetTaskDueDate,
            { taskId, dueDate: toEpochMinuteString(patch.dueAt) },
          ],
    );
  }
  if (patch.startAt !== undefined) {
    calls.push(
      patch.startAt === null
        ? [Action.ClearTaskStartDate, { taskId }]
        : [
            Action.SetTaskStartDate,
            { taskId, startDate: toEpochMinuteString(patch.startAt) },
          ],
    );
  }
  if (patch.parent !== undefined) {
    calls.push([
      Action.SetTaskParent,
      { taskId, parentTaskId: idOf(patch.parent) },
    ]);
  }
  if (patch.assignees !== undefined) {
    const { added, removed } = diffById(task.assignees, patch.assignees);
    for (const ref of added) {
      calls.push(
        ref.kind === "team"
          ? [Action.AddTaskGroupAssignee, { taskId, groupId: ref.id }]
          : [Action.AddTaskAssignee, { taskId, assigneeUserId: ref.id }],
      );
    }
    for (const ref of removed) {
      calls.push(
        ref.kind === "team"
          ? [Action.RemoveTaskGroupAssignee, { taskId, groupId: ref.id }]
          : [Action.RemoveTaskAssignee, { taskId, assigneeUserId: ref.id }],
      );
    }
  }
  if (patch.watchers !== undefined) {
    // The host follows and unfollows the viewer only; the refs' ids are not sent.
    const { added, removed } = diffById(task.watchers, patch.watchers);
    if (added.length > 0) {
      calls.push([Action.FollowTask, { taskId }]);
    }
    if (removed.length > 0) {
      calls.push([Action.UnfollowTask, { taskId }]);
    }
  }
  if (patch.tags !== undefined) {
    const current = new Set(task.tags.map((tag) => tag.name));
    const next = new Set(patch.tags.map((tag) => tag.name));
    for (const name of next) {
      if (!current.has(name)) {
        calls.push([Action.AddTaskTag, { taskId, tagName: name }]);
      }
    }
    for (const name of current) {
      if (!next.has(name)) {
        calls.push([Action.RemoveTaskTag, { taskId, tagName: name }]);
      }
    }
  }
  if (patch.customFields !== undefined) {
    const next = new Map(patch.customFields.map((field) => [field.id, field]));
    for (const field of next.values()) {
      calls.push([
        Action.SetTaskCustomField,
        { taskId, fieldId: field.id, value: customFieldValueParam(field) },
      ]);
    }
    for (const field of task.customFields) {
      if (!next.has(field.id)) {
        calls.push([
          Action.ClearTaskCustomField,
          { taskId, fieldId: field.id },
        ]);
      }
    }
  }
  if (patch.bodyMarkdown !== undefined) {
    calls.push([
      Action.SetTaskDescription,
      { taskId, markdownDescription: patch.bodyMarkdown },
    ]);
  }
  return calls;
}

/** Legacy statuses have no id of their own and are addressed by label. */
function statusParams(
  taskId: string,
  status: Ref<"status">,
): Record<string, string> {
  return status.id && status.id !== status.name
    ? { taskId, statusId: status.id }
    : { taskId, status: status.name };
}

function diffById<T extends Ref>(
  current: T[],
  next: T[],
): { added: T[]; removed: T[] } {
  const currentIds = new Set(current.map((ref) => ref.id));
  const nextIds = new Set(next.map((ref) => ref.id));
  return {
    added: next.filter((ref) => !currentIds.has(ref.id)),
    removed: current.filter((ref) => !nextIds.has(ref.id)),
  };
}

const READ_ONLY_FIELD_TYPES: ReadonlySet<Task["customFields"][number]["type"]> =
  new Set(["users", "tasks", "list_relationship", "attachment"]);

/** The wire value of a field; labels take comma-separated option names. */
function customFieldValueParam({
  type,
  value,
}: Task["customFields"][number]): string {
  if (READ_ONLY_FIELD_TYPES.has(type)) {
    throw new LiveError(
      "forbidden",
      `Custom fields of type ${type} cannot be written yet.`,
    );
  }
  return Array.isArray(value) ? value.join(",") : String(value);
}

/**
 * The task as it will read back once the host has applied `patch`. A parent
 * or type given by id alone has no name to show, and a new description shows
 * as plain text, until the refetch.
 */
export function applyTaskPatch(task: Task, patch: TaskPatch): Task {
  const { bodyMarkdown, parent, type, ...fields } = patch;
  const next = applyPatch(task, fields);
  if (bodyMarkdown !== undefined) {
    next.body = paragraph(bodyMarkdown);
  }
  if (patch.status) {
    next.status = { ...task.status, ...patch.status };
  }
  if (type !== undefined) {
    next.type =
      typeof type === "string"
        ? { kind: "taskType", id: type, name: "", url: "" }
        : type;
  }
  if (parent && typeof parent !== "string") {
    next.ancestors = [
      ...task.ancestors.filter((ref) => ref.kind !== "task"),
      parent,
    ];
  }
  return next;
}
