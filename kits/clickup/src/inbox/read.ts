import * as z from "zod/v4-mini";
import type { Ref } from "../core";
import { toIso, toIsoOrEpoch } from "../host/dates";
import { pages } from "../host/paging";
import type {
  ArtifactFeedResourceDto,
  ArtifactInboxBundleDto,
  ArtifactInboxNotificationDto,
} from "../host/wire";
import { kindOfObjectType } from "../host/wire";
import { byIds, clampLimit } from "../select";
import type { Session } from "../session";
import { fromHost } from "../validate";
import type { InboxBundle, InboxSelector } from "./inbox";
import { InboxBundleSchema } from "./schema";

type Notification = InboxBundle["notifications"][number];

export async function readInbox(
  s: Session,
  selector: InboxSelector,
): Promise<InboxBundle[]> {
  const state = selector.state ?? "active";
  const { category } = selector;
  const bundles = await loadInbox(
    s,
    { category, showCleared: state === "cleared" },
    (bundle) =>
      bundle.state === state && (!category || bundle.category === category),
    clampLimit(selector.limit),
  );
  return fromHost(z.array(InboxBundleSchema), bundles, "inbox bundles");
}

/**
 * The host serves the uncleared bundles and the cleared ones as two reads;
 * the second is only made for ids the first did not have.
 */
export async function getInbox(
  s: Session,
  ids: string[],
): Promise<InboxBundle[]> {
  const wanted = new Set(ids);
  const keep = (bundle: InboxBundle) => wanted.has(bundle.id);
  const found = await loadInbox(s, { showCleared: false }, keep, ids.length);
  if (found.length < ids.length) {
    found.push(
      ...(await loadInbox(
        s,
        { showCleared: true },
        keep,
        ids.length - found.length,
      )),
    );
  }
  return fromHost(
    z.array(InboxBundleSchema),
    byIds(found, ids),
    "inbox bundles",
  );
}

/** The host's inbox pages, mapped, keeping what `keep` accepts until `limit` are kept. */
async function loadInbox(
  s: Session,
  query: { category?: InboxBundle["category"]; showCleared: boolean },
  keep: (bundle: InboxBundle) => boolean,
  limit: number,
): Promise<InboxBundle[]> {
  const kept: InboxBundle[] = [];
  for await (const page of pages((cursor) =>
    s.host.query("inbox", {
      filter: query.category === "reminder" ? "reminders" : "all",
      showCleared: query.showCleared,
      cursor,
    }),
  )) {
    const mapped = await Promise.all(
      page.bundles.map((dto) => mapInboxBundle(s, dto)),
    );
    kept.push(...mapped.filter(keep));
    if (kept.length >= limit) {
      break;
    }
  }
  return kept.slice(0, limit);
}

async function mapInboxBundle(
  s: Session,
  wire: ArtifactInboxBundleDto,
): Promise<InboxBundle> {
  const related = feedResourceRef(wire.root);
  const notifications = await Promise.all(
    [...wire.notifications]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .map((notification) => mapNotification(s, notification)),
  );
  return {
    kind: "inboxBundle",
    id: wire.id,
    name: wire.root.name,
    url: related?.url ?? "",
    category: toCategory(wire),
    state: toState(wire.status),
    unreadCount: wire.unreadCount,
    mentionsMe: wire.hasMention,
    assignedToMe: wire.hasAssignment,
    snoozedUntil: toIso(wire.snoozedUntil),
    clearedAt: toIso(wire.clearedAt),
    related,
    notifications,
  };
}

async function mapNotification(
  s: Session,
  wire: ArtifactInboxNotificationDto,
): Promise<Notification> {
  return {
    type: toNotificationType(wire.type),
    at: toIsoOrEpoch(wire.occurredAt),
    actor: wire.actorId ? await s.member(wire.actorId) : undefined,
    related: wire.object ? feedResourceRef(wire.object) : undefined,
  };
}

function toCategory(wire: ArtifactInboxBundleDto): InboxBundle["category"] {
  const isReminder =
    wire.root.type === "reminder" ||
    wire.notifications.some((notification) =>
      notification.type.includes("reminder"),
    );
  if (isReminder) {
    return "reminder";
  }
  return wire.bundleType === "messages" ? "primary" : "other";
}

function toState(status: string): InboxBundle["state"] {
  switch (status) {
    case "cleared":
      return "cleared";
    case "snoozed":
      return "snoozed";
    default:
      return "active";
  }
}

/** Folds ClickUp history item types onto the model's notification types. */
function toNotificationType(type: string): Notification["type"] {
  if (type === "comment" || type === "attachment_comment") {
    return "comment";
  }
  if (type === "tag" || type.endsWith("_tag") || type.includes("mention")) {
    return "mention";
  }
  if (type.includes("assign")) {
    return "assignment";
  }
  if (type === "status") {
    return "status";
  }
  if (type.includes("reminder")) {
    return "reminder";
  }
  return "other";
}

/** Only feed resources the model has a kind and a name for become refs. */
function feedResourceRef(resource: ArtifactFeedResourceDto): Ref | undefined {
  const kind = kindOfObjectType(resource.type);
  if (!kind || !resource.name) {
    return undefined;
  }
  return { kind, id: resource.id, name: resource.name, url: resource.url };
}
