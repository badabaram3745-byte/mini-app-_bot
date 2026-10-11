import * as z from "zod/v4-mini";
import type { LiveBridge } from "../host/bridge";
import type { Session } from "../session";
import { fromHost } from "../validate";
import { TaskTypeSchema } from "./schema";
import type { TaskType } from "./tasks";

/** The built-in Task type, which a task without a `typeId` has. */
const DEFAULT_TASK_TYPE: TaskType = {
  kind: "taskType",
  id: "0",
  name: "Task",
  url: "",
};

/** The `taskTypes` source, mapped: the workspace's whole catalog, unpaged. */
export async function loadTaskTypes(host: LiveBridge): Promise<TaskType[]> {
  const { taskTypes } = await host.query("taskTypes", {});
  return taskTypes.map((wire) => ({
    kind: "taskType",
    id: String(wire.id),
    name: wire.name,
    url: "",
    description: wire.description,
  }));
}

export async function readTaskTypes(s: Session): Promise<TaskType[]> {
  return fromHost(z.array(TaskTypeSchema), await s.taskTypes(), "task types");
}

/** The task's type; the built-in Task type when the catalog does not list it. */
export async function taskTypeOf(
  s: Session,
  typeId: number | undefined,
): Promise<TaskType> {
  if (typeId === undefined) {
    return DEFAULT_TASK_TYPE;
  }
  const id = String(typeId);
  const entries = await s.taskTypes();
  return entries.find((candidate) => candidate.id === id) ?? DEFAULT_TASK_TYPE;
}
