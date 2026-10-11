import type { IsoDate, Ref, UseQueryOptions, UseQueryResult } from "./core";

export interface Reminder extends Ref<"reminder"> {
    dueAt?: IsoDate;
    /** Set once completed; there is no separate flag. */
    completedAt?: IsoDate;
    related?: Ref<"task">;
}
/** `completed: true` cannot be undone. */
export interface ReminderPatch {
    dueAt?: IsoDate;
    completed?: true;
}
export interface CreateReminderInput {
    name: string;
    dueAt?: IsoDate;
    related?: Ref<"task"> | string;
}
export interface ReminderSelector {
    includeCompleted?: boolean;
    /** Defaults to 100, at most 500. */
    limit?: number;
}
export interface RemindersApi {
    list(selector?: ReminderSelector): Promise<Reminder[]>;
    /** Completed ones included. */
    get(targets: Array<Ref<"reminder"> | string>): Promise<Reminder[]>;
    create(input: CreateReminderInput): Promise<Ref<"reminder">>;
    update(reminder: Ref<"reminder"> | string, patch: ReminderPatch): Promise<void>;
}
export declare function useReminders(selector?: ReminderSelector | Array<Ref<"reminder"> | string>, options?: UseQueryOptions<Reminder[]>): UseQueryResult<Reminder[]>;
