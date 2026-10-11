import * as z from "zod/v4-mini";
import {
  isoDate,
  ref,
  refFields,
  refOrId,
  schemaOf,
  selection,
} from "../validate";
import type {
  CreateReminderInput,
  Reminder,
  ReminderPatch,
  ReminderSelector,
} from "./reminders";

export const ReminderSchema = schemaOf<Reminder>()(
  z.object({
    ...refFields(["reminder"]),
    dueAt: z.optional(isoDate),
    completedAt: z.optional(isoDate),
    related: z.optional(ref(["task"])),
  }),
);

export const ReminderPatchSchema = schemaOf<ReminderPatch>()(
  z.strictObject({
    dueAt: z.optional(isoDate),
    completed: z.optional(z.literal(true)),
  }),
);

export const CreateReminderInputSchema = schemaOf<CreateReminderInput>()(
  z.strictObject({
    name: z.string().check(z.minLength(1, "A reminder needs a name")),
    dueAt: z.optional(isoDate),
    related: z.optional(refOrId("task")),
  }),
);

export const ReminderSelectorSchema = schemaOf<ReminderSelector>()(
  z.strictObject({
    includeCompleted: z.optional(z.boolean()),
    ...selection,
  }),
);
