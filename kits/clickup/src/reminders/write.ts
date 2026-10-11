import type { Ref } from "../core";
import { idOf } from "../core";
import { toEpochMinuteString } from "../host/dates";
import type { WireCall } from "../host/perform";
import { createdRef, perform, performAll } from "../host/perform";
import { ArtifactWriteActionType as Action } from "../host/wire";
import type { Session } from "../session";
import { applyPatch } from "../store";
import type { CreateReminderInput, Reminder, ReminderPatch } from "./reminders";

export async function createReminder(
  s: Session,
  input: CreateReminderInput,
): Promise<Ref<"reminder">> {
  const outcome = await perform(s.host, Action.CreateReminder, {
    message: input.name,
    ...(input.dueAt ? { dueDate: toEpochMinuteString(input.dueAt) } : {}),
    ...(input.related ? { taskId: idOf(input.related) } : {}),
  });
  await Promise.all([
    s.store.invalidate("reminder"),
    s.store.invalidate("inboxBundle"),
  ]);
  return createdRef("reminder", outcome, input.name);
}

export async function updateReminder(
  s: Session,
  target: Ref<"reminder"> | string,
  patch: ReminderPatch,
): Promise<void> {
  const reminder: Ref<"reminder"> =
    typeof target === "string"
      ? { kind: "reminder", id: target, name: "", url: "" }
      : target;
  await s.store.update<Reminder>(
    reminder as Reminder,
    (current) => applyReminderPatch(current, patch),
    () => performAll(s.host, reminderPatchCalls(reminder.id, patch)),
  );
}

/** The ordered host calls that apply `patch` to the reminder. */
export function reminderPatchCalls(
  reminderId: string,
  patch: ReminderPatch,
): WireCall[] {
  const calls: WireCall[] = [];
  if (patch.dueAt !== undefined) {
    calls.push([
      Action.SnoozeReminder,
      { reminderId, until: toEpochMinuteString(patch.dueAt) },
    ]);
  }
  if (patch.completed) {
    calls.push([Action.CompleteReminder, { reminderId }]);
  }
  return calls;
}

/** The reminder as it will read back once the host has applied `patch`. */
export function applyReminderPatch(
  reminder: Reminder,
  patch: ReminderPatch,
): Reminder {
  const { completed, ...fields } = patch;
  const next = applyPatch(reminder, fields);
  if (completed) {
    next.completedAt = new Date().toISOString();
  }
  return next;
}
