import * as z from "zod/v4-mini";
import {
  contains,
  delta,
  isoDate,
  orderBy,
  ref,
  refFields,
  refOrId,
  schemaOf,
  scoped,
  selection,
} from "../validate";
import type {
  Comment,
  CommentPatch,
  CommentSelector,
  CreateCommentInput,
} from "./comments";
import { COMMENT_ORDERS, COMMENT_TYPES } from "./comments";

export const CommentSchema = schemaOf<Comment>()(
  z.object({
    ...refFields(["comment"]),
    ancestors: z.array(ref(["space", "folder", "list", "task", "comment"])),
    createdAt: isoDate,
    updatedAt: isoDate,
    type: z.enum(COMMENT_TYPES),
    body: delta,
    creator: ref(["user"]),
    assignee: z.optional(ref(["user"])),
    resolvedBy: z.optional(ref(["user"])),
    reactions: z.array(
      z.object({ emoji: z.string(), users: z.array(ref(["user"])) }),
    ),
  }),
);

const emoji = z.string().check(z.minLength(1, "Expected an emoji"));

export const CommentPatchSchema = schemaOf<CommentPatch>()(
  z.strictObject({
    bodyMarkdown: z.optional(
      z.string().check(z.minLength(1, "A comment needs a body")),
    ),
    assignee: z.optional(z.nullable(ref(["user"]))),
    resolved: z.optional(z.boolean()),
    myReactions: z.optional(z.array(emoji)),
  }),
);

export const CreateCommentInputSchema = schemaOf<CreateCommentInput>()(
  z.strictObject({
    parent: ref(["task", "comment"]),
    bodyMarkdown: z.string().check(z.minLength(1, "A comment needs a body")),
    assignee: z.optional(ref(["user"])),
  }),
);

const userOrMe = z.union([ref(["user"]), z.literal("me")], {
  error: 'Expected a user ref, from useUsers, or "me"',
});

export const CommentSelectorSchema = schemaOf<CommentSelector>()(
  z
    .strictObject({
      parent: z.optional(ref(["task", "comment"])),
      ancestor: z.optional(refOrId("task")),
      ...selection,
      resolved: z.optional(z.boolean()),
      assignee: z.optional(userOrMe),
      creator: z.optional(userOrMe),
      body: contains(),
      orderBy: orderBy(COMMENT_ORDERS),
    })
    .check(scoped),
);
