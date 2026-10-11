import type { Ref } from "../core";
import { asRef, LiveError, pathOf } from "../core";
import type { WireCall } from "../host/perform";
import { createdRef, perform, performAll } from "../host/perform";
import { paragraph } from "../host/quill";
import { ArtifactWriteActionType as Action } from "../host/wire";
import { mapMember } from "../people/read";
import type { Session } from "../session";
import { resolve } from "../session";
import { applyPatch } from "../store";
import type { Comment, CommentPatch, CreateCommentInput } from "./comments";
import { getComments, preview } from "./read";

export async function updateComment(
  s: Session,
  target: Ref<"comment"> | string,
  patch: CommentPatch,
): Promise<void> {
  const comment = await resolve<Comment>(s, "comment", target, getComments);
  const viewer =
    patch.myReactions === undefined ? undefined : mapMember(s.host.viewer());
  await s.store.update(
    comment,
    (current) => applyCommentPatch(current, patch, viewer),
    () => performAll(s.host, commentPatchCalls(comment, patch, viewer)),
  );
}

/** Posts a comment on a task, or a reply under a comment (a `thread` to the host). */
export async function createComment(
  s: Session,
  input: CreateCommentInput,
): Promise<Ref<"comment">> {
  const { parent } = input;
  const outcome = await perform(s.host, Action.CreateComment, {
    parentKind: parent.kind === "task" ? "task" : "thread",
    parentId: parent.id,
    commentText: input.bodyMarkdown,
  });
  const created = createdRef("comment", outcome, preview(input.bodyMarkdown));
  if (input.assignee) {
    await perform(s.host, Action.AssignComment, {
      ...commentTarget(created.id, [...pathOf(parent), asRef(parent)]),
      assigneeUserId: input.assignee.id,
    });
  }
  await s.store.invalidate("comment");
  return created;
}

/**
 * The ordered host calls that apply `patch` to `comment`. The host toggles a
 * reaction, so every emoji the viewer adds or drops is one `react` call.
 */
export function commentPatchCalls(
  comment: Comment,
  patch: CommentPatch,
  viewer: Ref<"user"> | undefined,
): WireCall[] {
  const target = commentTarget(comment.id, comment.ancestors);
  const calls: WireCall[] = [];
  if (patch.bodyMarkdown !== undefined) {
    calls.push([Action.EditComment, { ...target, text: patch.bodyMarkdown }]);
  }
  if (patch.resolved === true) {
    calls.push([Action.ResolveComment, target]);
  } else if (patch.resolved === false) {
    calls.push([Action.ReopenComment, target]);
  }
  if (patch.assignee === null) {
    calls.push([Action.UnassignComment, target]);
  } else if (patch.assignee) {
    calls.push([
      Action.AssignComment,
      { ...target, assigneeUserId: patch.assignee.id },
    ]);
  }
  if (patch.myReactions !== undefined && viewer) {
    const current = myReactions(comment, viewer);
    const next = new Set(patch.myReactions);
    for (const emoji of [...next, ...current]) {
      if (next.has(emoji) !== current.has(emoji)) {
        calls.push([Action.ReactToComment, { ...target, emoji }]);
      }
    }
  }
  return calls;
}

function myReactions(comment: Comment, viewer: Ref<"user">): Set<string> {
  return new Set(
    comment.reactions
      .filter((reaction) =>
        reaction.users.some((user) => user.id === viewer.id),
      )
      .map((reaction) => reaction.emoji),
  );
}

/** The host addresses a comment by its task, and a reply by its root comment plus the reply id. */
function commentTarget(
  id: string,
  ancestors: readonly Ref[],
): Record<string, string> {
  const task = ancestors.find((ref) => ref.kind === "task");
  if (!task) {
    throw new LiveError("invalid", "Only comments on tasks can be acted on.");
  }
  const parent = ancestors[ancestors.length - 1];
  return parent?.kind === "comment"
    ? { taskId: task.id, commentId: parent.id, threadedCommentId: id }
    : { taskId: task.id, commentId: id };
}

/** The comment as it will read back once the host has applied `patch`; `resolvedBy` and a rendered body arrive with the refetch that follows. */
export function applyCommentPatch(
  comment: Comment,
  patch: CommentPatch,
  viewer: Ref<"user"> | undefined,
): Comment {
  const { bodyMarkdown, resolved, myReactions: mine, ...fields } = patch;
  const next = applyPatch(comment, fields);
  if (bodyMarkdown !== undefined) {
    next.name = preview(bodyMarkdown);
    next.body = paragraph(bodyMarkdown);
  }
  if (resolved === false) {
    delete next.resolvedBy;
  }
  if (mine !== undefined && viewer) {
    next.reactions = withViewerReactions(comment.reactions, viewer, mine);
  }
  return next;
}

/** `reactions` with the viewer on exactly the `emojis`; an emoji nobody reacts with anymore goes. */
function withViewerReactions(
  reactions: Comment["reactions"],
  viewer: Ref<"user">,
  emojis: string[],
): Comment["reactions"] {
  const wanted = new Set(emojis);
  const kept = reactions
    .map(({ emoji, users }) => {
      const others = users.filter((user) => user.id !== viewer.id);
      return { emoji, users: wanted.has(emoji) ? [...others, viewer] : others };
    })
    .filter((reaction) => reaction.users.length > 0);
  const known = new Set(kept.map((reaction) => reaction.emoji));
  return [
    ...kept,
    ...emojis
      .filter((emoji) => !known.has(emoji))
      .map((emoji) => ({ emoji, users: [viewer] })),
  ];
}
