import * as z from "zod/v4-mini";
import {
  anyRef,
  isoDate,
  ref,
  refFields,
  schemaOf,
  selection,
} from "../validate";
import type { InboxBundle, InboxBundlePatch, InboxSelector } from "./inbox";
import { INBOX_CATEGORIES, INBOX_STATES, NOTIFICATION_TYPES } from "./inbox";

export const InboxBundleSchema = schemaOf<InboxBundle>()(
  z.object({
    ...refFields(["inboxBundle"]),
    category: z.enum(INBOX_CATEGORIES),
    state: z.enum(INBOX_STATES),
    unreadCount: z.number(),
    mentionsMe: z.boolean(),
    assignedToMe: z.boolean(),
    snoozedUntil: z.optional(isoDate),
    clearedAt: z.optional(isoDate),
    related: z.optional(anyRef),
    notifications: z.array(
      z.object({
        type: z.enum(NOTIFICATION_TYPES),
        at: isoDate,
        actor: z.optional(ref(["user"])),
        related: z.optional(anyRef),
      }),
    ),
  }),
);

export const InboxBundlePatchSchema = schemaOf<InboxBundlePatch>()(
  z
    .strictObject({
      state: z.optional(z.enum(INBOX_STATES)),
      snoozedUntil: z.optional(isoDate),
      read: z.optional(z.boolean()),
    })
    .check(
      z.refine(
        (patch) =>
          patch.state !== "snoozed" || patch.snoozedUntil !== undefined,
        { error: "Snoozing needs snoozedUntil" },
      ),
    ),
);

export const InboxSelectorSchema = schemaOf<InboxSelector>()(
  z.strictObject({
    state: z.optional(z.enum(INBOX_STATES)),
    category: z.optional(z.enum(INBOX_CATEGORIES)),
    ...selection,
  }),
);
