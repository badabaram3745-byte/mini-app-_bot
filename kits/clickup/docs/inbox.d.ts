import type { IsoDate, Ref, UseQueryOptions, UseQueryResult } from "./core";

/** `primary` holds messages and mentions, `other` everything else, `reminder` reminders. */
export declare const INBOX_CATEGORIES: readonly ["primary", "other", "reminder"];
export declare const INBOX_STATES: readonly ["active", "snoozed", "cleared"];
export declare const NOTIFICATION_TYPES: readonly ["comment", "mention", "assignment", "status", "reminder", "other"];
/**
 * One inbox row: the notifications about one asset, whose name and url the
 * bundle mirrors. For a reminder, `related` is the reminder itself.
 */
export interface InboxBundle extends Ref<"inboxBundle"> {
    category: (typeof INBOX_CATEGORIES)[number];
    state: (typeof INBOX_STATES)[number];
    unreadCount: number;
    mentionsMe: boolean;
    assignedToMe: boolean;
    /** When a snoozed bundle comes back; for a reminder, when it is due. */
    snoozedUntil?: IsoDate;
    clearedAt?: IsoDate;
    /** The asset the bundle is about. */
    related?: Ref;
    /** Newest first. */
    notifications: Array<{
        type: (typeof NOTIFICATION_TYPES)[number];
        at: IsoDate;
        /** Who acted; absent for automations. */
        actor?: Ref<"user">;
        /** What the notification points at, e.g. the comment itself. */
        related?: Ref;
    }>;
}
/**
 * `state: "cleared"` clears, `"snoozed"` snoozes until `snoozedUntil`,
 * `"active"` brings a cleared or snoozed bundle back. `read` marks it read or
 * unread; read the state back through `unreadCount`.
 */
export interface InboxBundlePatch {
    state?: InboxBundle["state"];
    snoozedUntil?: IsoDate;
    read?: boolean;
}
export interface InboxSelector {
    /** Defaults to `"active"`. */
    state?: InboxBundle["state"];
    category?: InboxBundle["category"];
    /** Defaults to 100, at most 500. */
    limit?: number;
}
export interface InboxApi {
    list(selector?: InboxSelector): Promise<InboxBundle[]>;
    /** Any state, cleared included. */
    get(targets: Array<Ref<"inboxBundle"> | string>): Promise<InboxBundle[]>;
    update(bundle: Ref<"inboxBundle"> | string, patch: InboxBundlePatch): Promise<void>;
}
export declare function useInbox(selector?: InboxSelector | Array<Ref<"inboxBundle"> | string>, options?: UseQueryOptions<InboxBundle[]>): UseQueryResult<InboxBundle[]>;
