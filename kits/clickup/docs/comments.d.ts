import type { Delta, IsoDate, Ref, UseQueryOptions, UseQueryResult } from "./core";

export declare const COMMENT_TYPES: readonly ["message", "ai", "activity"];
/**
 * `name` is a one-line preview of the body. The last ancestor is the task,
 * or for a reply the comment it replies to.
 */
export interface Comment extends Ref<"comment"> {
    ancestors: Array<Ref<"space" | "folder" | "list" | "task" | "comment">>;
    createdAt: IsoDate;
    updatedAt: IsoDate;
    type: (typeof COMMENT_TYPES)[number];
    /** The body; render it with `RichText`. */
    body: Delta;
    creator: Ref<"user">;
    assignee?: Ref<"user">;
    /** Set once the comment is resolved; there is no separate resolved flag. */
    resolvedBy?: Ref<"user">;
    /** One entry per emoji, with the workspace members who reacted. */
    reactions: Array<{
        emoji: string;
        users: Ref<"user">[];
    }>;
}
/**
 * `resolved` resolves or reopens the comment (read it back through
 * `resolvedBy`), `assignee: null` unassigns, and `myReactions` replaces the
 * viewer's reactions, leaving everyone else's.
 */
export interface CommentPatch {
    /** Replaces the body; read it back as `body`. */
    bodyMarkdown?: string;
    assignee?: Ref<"user"> | null;
    resolved?: boolean;
    myReactions?: string[];
}
/** `parent` is the task to comment on, or the comment to reply to. */
export interface CreateCommentInput {
    parent: Ref<"task" | "comment">;
    /** The body, as markdown. */
    bodyMarkdown: string;
    assignee?: Ref<"user">;
}
export declare const COMMENT_ORDERS: readonly ["createdAt"];
/**
 * Needs `parent` or `ancestor`. The other fields filter and sort on the
 * server before `limit` applies.
 * @example
 * useComments({ ancestor: task, resolved: false, assignee: "me" });
 */
export interface CommentSelector {
    /** A task, for its top-level comments; or a comment from `useComments`, for its replies. */
    parent?: Ref<"task" | "comment">;
    /** A task, for all its comments including replies. */
    ancestor?: Ref<"task"> | string;
    /** Defaults to 100, at most 500. */
    limit?: number;
    resolved?: boolean;
    /** `"me"` is the viewer. */
    assignee?: Ref<"user"> | "me";
    creator?: Ref<"user"> | "me";
    body?: {
        contains: string;
    };
    /** Oldest first when omitted; `direction` defaults to `"asc"`. */
    orderBy?: {
        field: (typeof COMMENT_ORDERS)[number];
        direction?: "asc" | "desc";
    };
}
export interface CommentsApi {
    list(selector: CommentSelector): Promise<Comment[]>;
    /** Comments on tasks; ids from chats or docs are left out. */
    get(targets: Array<Ref<"comment"> | string>): Promise<Comment[]>;
    create(input: CreateCommentInput): Promise<Ref<"comment">>;
    update(comment: Ref<"comment"> | string, patch: CommentPatch): Promise<void>;
}
export declare function useComments(selector: CommentSelector | Array<Ref<"comment"> | string>, options?: UseQueryOptions<Comment[]>): UseQueryResult<Comment[]>;
