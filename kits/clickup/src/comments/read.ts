import * as z from "zod/v4-mini";
import type { Ref } from "../core";
import { asRef, pathOf } from "../core";
import type { LiveBridge } from "../host/bridge";
import { toIsoOrEpoch } from "../host/dates";
import { chunk, pages } from "../host/paging";
import { paragraph, toEmoji } from "../host/quill";
import type {
  ArtifactCommentDto,
  ArtifactCommentReactionDto,
  ArtifactCommentsQuery,
} from "../host/wire";
import { ARTIFACT_COMMENTS_MAX_LIMIT } from "../host/wire";
import { userOf } from "../people/read";
import { byIds, clampLimit } from "../select";
import type { Session } from "../session";
import { resolve } from "../session";
import { getTasks } from "../tasks/read";
import { fromHost } from "../validate";
import type { Comment, CommentSelector } from "./comments";
import { CommentSchema } from "./schema";

type CommentsInput = Omit<
  Extract<ArtifactCommentsQuery, { parent: unknown }>,
  "cursor" | "limit"
>;

/**
 * The comments under the selector's parent, or every comment under its
 * ancestor task. A reply read along with its root sits under that root,
 * named as far as the result lists it.
 */
export async function readComments(
  s: Session,
  selector: CommentSelector,
): Promise<Comment[]> {
  const limit = clampLimit(selector.limit);
  const parent = await commentParent(s, selector);
  const wire = await commentPages(
    s.host,
    {
      parent: {
        kind: parent.kind === "task" ? "task" : "thread",
        id: parent.id,
      },
      includeReplies: selector.ancestor !== undefined,
      resolved: selector.resolved,
      assignedTo: selector.assignee && memberId(s, selector.assignee),
      createdBy: selector.creator && memberId(s, selector.creator),
      textSearch: selector.body?.contains,
      orderDirection: selector.orderBy && (selector.orderBy.direction ?? "asc"),
    },
    limit,
  );
  const parentPath = [...pathOf(parent), asRef(parent)];
  const roots = new Map(wire.map((dto) => [dto.id, commentRef(dto)]));
  const comments = await mapComments(s, wire, (dto) =>
    dto.parentId === parent.id
      ? parentPath
      : [
          ...parentPath,
          roots.get(dto.parentId) ?? {
            kind: "comment",
            id: dto.parentId,
            name: "",
            url: "",
          },
        ],
  );
  return fromHost(z.array(CommentSchema), comments.slice(0, limit), "comments");
}

/** The selector's `parent`, or its `ancestor` task, as a full asset: a bare ref or id is read once for its path. */
function commentParent(
  s: Session,
  { parent, ancestor }: CommentSelector,
): Promise<Ref<"task" | "comment">> {
  return parent?.kind === "comment"
    ? resolve(s, "comment", parent, getComments)
    : resolve(s, "task", parent ?? ancestor!, getTasks);
}

/**
 * Exactly these comments, each under its task and, for a reply, its root
 * comment. A comment elsewhere (a chat, a doc) or on a task the viewer
 * cannot see is left out.
 */
export async function getComments(
  s: Session,
  ids: string[],
): Promise<Comment[]> {
  const wire = await commentsByIds(s.host, ids);
  const byId = await withRoots(s.host, wire);
  const taskIds = wire.flatMap((dto) => taskIdOf(dto, byId) ?? []);
  const tasks = new Map(
    (await getTasks(s, [...new Set(taskIds)])).map((task) => [task.id, task]),
  );
  const comments = await mapComments(s, wire, (dto) => {
    const task = tasks.get(taskIdOf(dto, byId) ?? "");
    if (!task) {
      return undefined;
    }
    const taskPath = [...pathOf(task), asRef(task)];
    return dto.parentKind === "thread"
      ? [...taskPath, commentRef(byId.get(dto.parentId)!)]
      : taskPath;
  });
  return fromHost(z.array(CommentSchema), byIds(comments, ids), "comments");
}

/** `wire` by id, plus the root comments its replies hang off, read where `wire` lacks them. */
async function withRoots(
  host: LiveBridge,
  wire: ArtifactCommentDto[],
): Promise<Map<string, ArtifactCommentDto>> {
  const byId = new Map(wire.map((dto) => [dto.id, dto]));
  const missing = wire
    .filter((dto) => dto.parentKind === "thread" && !byId.has(dto.parentId))
    .map((dto) => dto.parentId);
  for (const root of await commentsByIds(host, [...new Set(missing)])) {
    byId.set(root.id, root);
  }
  return byId;
}

/** The task a comment sits on, through its root for a reply; none for a comment elsewhere. */
function taskIdOf(
  dto: ArtifactCommentDto,
  byId: ReadonlyMap<string, ArtifactCommentDto>,
): string | undefined {
  const onTask = dto.parentKind === "thread" ? byId.get(dto.parentId) : dto;
  return onTask?.parentKind === "task" ? onTask.parentId : undefined;
}

async function commentsByIds(
  host: LiveBridge,
  ids: string[],
): Promise<ArtifactCommentDto[]> {
  const results = await Promise.all(
    chunk(ids, ARTIFACT_COMMENTS_MAX_LIMIT).map((batch) =>
      host.query("comments", { ids: batch }),
    ),
  );
  return results.flatMap((result) => result.comments);
}

function memberId(s: Session, user: Ref<"user"> | "me"): string {
  return user === "me" ? s.host.viewer().id : user.id;
}

async function commentPages(
  host: LiveBridge,
  input: CommentsInput,
  limit: number,
): Promise<ArtifactCommentDto[]> {
  const comments: ArtifactCommentDto[] = [];
  for await (const page of pages((cursor) =>
    host.query("comments", {
      ...input,
      limit: Math.min(ARTIFACT_COMMENTS_MAX_LIMIT, limit - comments.length),
      cursor,
    }),
  )) {
    comments.push(...page.comments);
    if (comments.length >= limit) {
      break;
    }
  }
  return comments;
}

/** Maps `wire` under the ancestors `place` gives each comment; one it places nowhere is left out. */
function mapComments(
  s: Session,
  wire: ArtifactCommentDto[],
  place: (dto: ArtifactCommentDto) => Ref[] | undefined,
): Promise<Comment[]> {
  return Promise.all(
    wire.flatMap((dto) => {
      const ancestors = place(dto);
      return ancestors
        ? [mapComment(s, dto, ancestors as Comment["ancestors"])]
        : [];
    }),
  );
}

function commentRef(dto: ArtifactCommentDto): Ref<"comment"> {
  return {
    kind: "comment",
    id: dto.id,
    name: preview(dto.bodyText),
    url: dto.url,
  };
}

async function mapComment(
  s: Session,
  wire: ArtifactCommentDto,
  parentPath: Comment["ancestors"],
): Promise<Comment> {
  const [creator, assignee, resolvedBy, reactions] = await Promise.all([
    userOf(s, wire.creator),
    wire.assigneeId ? s.member(wire.assigneeId) : undefined,
    wire.resolved && wire.resolvedById
      ? s.member(wire.resolvedById)
      : undefined,
    mapReactions(s, wire.reactions),
  ]);
  return {
    kind: "comment",
    id: wire.id,
    name: preview(wire.bodyText),
    url: wire.url,
    ancestors: parentPath,
    createdAt: toIsoOrEpoch(wire.createdAt),
    updatedAt: toIsoOrEpoch(wire.updatedAt),
    type: toCommentType(wire.commentType),
    body: wire.bodyQuill ?? paragraph(wire.bodyMarkdown || wire.bodyText),
    creator,
    assignee,
    resolvedBy,
    reactions,
  };
}

/** One entry per emoji, in first-seen order; reactors the workspace cannot name are left out. */
async function mapReactions(
  s: Session,
  wire: readonly ArtifactCommentReactionDto[],
): Promise<Comment["reactions"]> {
  const byEmoji = new Map<string, Ref<"user">[]>();
  for (const reaction of wire) {
    const emoji = toEmoji(reaction.emoji);
    const users = byEmoji.get(emoji) ?? [];
    byEmoji.set(emoji, users);
    const user = reaction.userId ? await s.member(reaction.userId) : undefined;
    if (user && !users.some((known) => known.id === user.id)) {
      users.push(user);
    }
  }
  return [...byEmoji].map(([emoji, users]) => ({ emoji, users }));
}
const PREVIEW_MAX_LENGTH = 120;

/** A comment's `name`: its body on one line, cut to a headline. */
export function preview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_MAX_LENGTH
    ? `${line.slice(0, PREVIEW_MAX_LENGTH - 1)}…`
    : line;
}

function toCommentType(value: string): Comment["type"] {
  switch (value) {
    case "ai":
    case "activity":
      return value;
    default:
      return "message";
  }
}
