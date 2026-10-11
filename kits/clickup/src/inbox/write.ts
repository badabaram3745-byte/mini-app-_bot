import type { Ref } from "../core";
import { toEpochMinuteString } from "../host/dates";
import type { WireCall } from "../host/perform";
import { performAll } from "../host/perform";
import { ArtifactWriteActionType as Action } from "../host/wire";
import type { Session } from "../session";
import { resolve } from "../session";
import { applyPatch } from "../store";
import type { InboxBundle, InboxBundlePatch } from "./inbox";
import { getInbox } from "./read";

export async function updateInboxBundle(
  s: Session,
  target: Ref<"inboxBundle"> | string,
  patch: InboxBundlePatch,
): Promise<void> {
  const bundle = await resolve(s, "inboxBundle", target, getInbox);
  await s.store.update(
    bundle,
    (current) => applyInboxPatch(current, patch),
    () => performAll(s.host, inboxPatchCalls(bundle, patch)),
  );
}

/** The ordered host calls that apply `patch` to `bundle`. */
export function inboxPatchCalls(
  bundle: InboxBundle,
  patch: InboxBundlePatch,
): WireCall[] {
  const bundleId = bundle.id;
  const calls: WireCall[] = [];
  const snooze = (until: string): WireCall => [
    Action.SnoozeInboxBundle,
    { bundleId, until: toEpochMinuteString(until) },
  ];
  if (patch.state !== undefined && patch.state !== bundle.state) {
    switch (patch.state) {
      case "active":
        calls.push([
          bundle.state === "snoozed"
            ? Action.UnsnoozeInboxBundle
            : Action.UnclearInboxBundle,
          { bundleId },
        ]);
        break;
      case "cleared":
        calls.push([Action.ClearInboxBundle, { bundleId }]);
        break;
      case "snoozed":
        calls.push(snooze(patch.snoozedUntil!));
        break;
    }
  } else if (patch.snoozedUntil !== undefined) {
    calls.push(snooze(patch.snoozedUntil));
  }
  if (patch.read === true) {
    calls.push([Action.MarkInboxBundleRead, { bundleId }]);
  } else if (patch.read === false) {
    calls.push([Action.MarkInboxBundleUnread, { bundleId }]);
  }
  return calls;
}

/** The bundle as it will read back once the host has applied `patch`. */
export function applyInboxPatch(
  bundle: InboxBundle,
  patch: InboxBundlePatch,
): InboxBundle {
  const { read, ...fields } = patch;
  const next = applyPatch(bundle, fields);
  if (read === true) {
    next.unreadCount = 0;
  } else if (read === false) {
    next.unreadCount = Math.max(1, next.unreadCount);
  }
  return next;
}
