import * as z from "zod/v4-mini";
import { DEFAULT_COLOR } from "../components/palette";
import { toIsoOrEpoch } from "../host/dates";
import type {
  ArtifactCustomFieldDefinition,
  ArtifactCustomFieldWireValue,
  ArtifactTaskCustomFieldDto,
} from "../host/wire";
import { OBJECT_TYPES, refOf } from "../host/wire";
import { usersOf } from "../people/read";
import type { Session } from "../session";
import type { Task } from "../tasks/tasks";
import { fromHost } from "../validate";
import type { CustomField, CustomFieldSelector } from "./customFields";
import { CustomFieldSchema } from "./schema";

type TaskCustomFieldEntry = Task["customFields"][number];

export async function readCustomFields(
  s: Session,
  { parent }: CustomFieldSelector,
): Promise<CustomField[]> {
  const result = await s.host.query(
    "customFields",
    parent.kind === "task"
      ? { taskIds: [parent.id] }
      : { location: { id: parent.id, type: OBJECT_TYPES[parent.kind] } },
  );
  return fromHost(
    z.array(CustomFieldSchema),
    await Promise.all(
      result.definitions.map((definition) => mapDefinition(s, definition)),
    ),
    "custom fields",
  );
}

async function mapDefinition(
  s: Session,
  wire: ArtifactCustomFieldDefinition,
): Promise<CustomField> {
  return {
    kind: "customField",
    id: wire.fieldId,
    name: wire.name,
    url: "",
    ancestors: await s.path(wire.location),
    type: wire.type,
    options: wire.options?.map((option) => ({
      name: option.name,
      color: option.color || DEFAULT_COLOR,
    })),
  };
}

/** The typed values a task carries, in the order the wire lists them. */
export function mapCustomFieldValues(
  s: Session,
  wire: readonly ArtifactTaskCustomFieldDto[],
): Promise<TaskCustomFieldEntry[]> {
  return Promise.all(
    wire.map(async (field) => ({
      id: field.fieldId,
      name: field.name,
      type: field.type,
      value: await toFieldValue(s, field.value),
    })),
  );
}

async function toFieldValue(
  s: Session,
  wire: ArtifactCustomFieldWireValue,
): Promise<TaskCustomFieldEntry["value"]> {
  switch (wire.kind) {
    case "boolean":
    case "number":
    case "text":
      return wire.value;
    case "date":
      return toIsoOrEpoch(wire.timestamp);
    case "option":
      return wire.option.name;
    case "labels":
      return wire.options.map((option) => option.name);
    case "users":
      return usersOf(s, wire.users);
    case "tasks":
      return wire.tasks.map((task) => refOf("task", task));
    case "attachments":
      return wire.attachments.map((attachment) => attachment.url);
  }
}
