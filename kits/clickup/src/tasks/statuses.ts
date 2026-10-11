import * as z from "zod/v4-mini";
import { STATUS_TYPE_COLORS } from "../components/palette";
import type { ArtifactStatusDto, ArtifactStatusType } from "../host/wire";
import type { Session } from "../session";
import { fromHost } from "../validate";
import { StatusSchema } from "./schema";
import type { Status, StatusSelector } from "./tasks";

export async function readStatuses(
  s: Session,
  { parent }: StatusSelector,
): Promise<Status[]> {
  const location =
    typeof parent === "string"
      ? { kind: "list" as const, id: parent }
      : { kind: parent.kind, id: parent.id };
  const { statuses } = await s.host.query("statuses", { location });
  return fromHost(z.array(StatusSchema), mapStatuses(statuses), "statuses");
}

export function mapStatus(wire: ArtifactStatusDto): Status {
  const type = toStatusType(wire.type);
  return {
    kind: "status",
    id: wire.id,
    name: wire.name,
    url: "",
    type,
    color: wire.color || STATUS_TYPE_COLORS[type],
  };
}

/** A location's statuses in board order. */
function mapStatuses(wire: ArtifactStatusDto[]): Status[] {
  return [...wire].sort((a, b) => a.orderindex - b.orderindex).map(mapStatus);
}

/** Collapses the wire's seven status categories onto the model's four. */
function toStatusType(type: ArtifactStatusType | string): Status["type"] {
  switch (type) {
    case "done":
      return "done";
    case "closed":
      return "closed";
    case "active":
    case "custom":
      return "active";
    default:
      return "open";
  }
}
