import type { Delta, IsoDate, Ref, UseQueryOptions, UseQueryResult } from "./core";
import type { CustomField } from "./customFields";

export declare const PRIORITIES: readonly ["urgent", "high", "normal", "low"];
/** `open` is not started, `active` in progress, `done` finished, and `closed` the list's final status. */
export declare const STATUS_TYPES: readonly ["open", "active", "done", "closed"];
export interface Status extends Ref<"status"> {
    type: (typeof STATUS_TYPES)[number];
    color: string;
}
/** The effective statuses of a list, folder or space: what a task created there uses, in board order. */
export interface StatusSelector {
    /** A bare string is a list id. */
    parent: Ref<"space" | "folder" | "list"> | string;
}
export interface Task extends Ref<"task"> {
    /** The space, folder and home list, then the parent task if this is a subtask. */
    ancestors: Array<Ref<"space" | "folder" | "list" | "task">>;
    /** Other lists the task appears in, besides its home list. */
    otherLists: Array<Ref<"list">>;
    private: boolean;
    createdAt: IsoDate;
    updatedAt: IsoDate;
    startAt?: IsoDate;
    dueAt?: IsoDate;
    status: Status;
    type: TaskType;
    priority?: (typeof PRIORITIES)[number];
    /** Sprint points. */
    points?: number;
    tags: Array<{
        name: string;
        color: string;
    }>;
    /** Set fields only; definitions are in `useCustomFields`, matched by `id`. `value` follows `type`: dates are `IsoDate`, drop-downs and labels option names, attachments urls, users and tasks refs. */
    customFields: Array<{
        id: string;
        name: string;
        type: CustomField["type"];
        value: string | number | boolean | string[] | Ref<"user" | "team" | "task">[];
    }>;
    /** The description; render it with `RichText`. */
    body: Delta;
    creator: Ref<"user">;
    assignees: Array<Ref<"user" | "team">>;
    watchers: Array<Ref<"user">>;
    checklists: ChecklistItem[];
}
/** A task's checklists are headings; the items nested below them are checkable, at any depth. */
export interface ChecklistItem {
    /** Empty for an entry that does not exist yet. */
    id: string;
    name: string;
    /** Absent on headings. */
    done?: boolean;
    items: ChecklistItem[];
}
/**
 * The fields to change: `undefined` leaves one alone, `null` clears it.
 * Collections replace the whole list, so read-modify-write them; checklists
 * are diffed by `id`, so keep existing ids and give new entries an empty one.
 * @example
 * await clickup.tasks.update(task, { dueAt: null, assignees: [...task.assignees, user] });
 */
export interface TaskPatch {
    name?: string;
    /** Replaces the description; read it back as `body`. */
    bodyMarkdown?: string;
    /** One of the home list's statuses, from `useStatuses`. */
    status?: Ref<"status">;
    type?: Ref<"taskType"> | string;
    priority?: Task["priority"] | null;
    points?: number | null;
    startAt?: IsoDate | null;
    dueAt?: IsoDate | null;
    /** Makes the task a subtask of `parent`. */
    parent?: Ref<"task"> | string;
    assignees?: Task["assignees"];
    /** Only the viewer can be added or removed. */
    watchers?: Task["watchers"];
    tags?: Task["tags"];
    /** Users, tasks and attachments fields cannot be written yet and reject with `forbidden`. */
    customFields?: Task["customFields"];
    checklists?: Task["checklists"];
}
/** `list` is where the task goes; `parent` makes it a subtask of that task. */
export interface CreateTaskInput {
    list: Ref<"list"> | string;
    parent?: Ref<"task"> | string;
    name: string;
    /** The description, as markdown. */
    bodyMarkdown?: string;
    status?: Ref<"status">;
    type?: Ref<"taskType"> | string;
    priority?: Task["priority"];
    dueAt?: IsoDate;
    startAt?: IsoDate;
    assignees?: Task["assignees"];
}
/** Relative days, in the viewer's timezone. */
export declare const DATE_PRESETS: readonly ["today", "tomorrow", "next7Days"];
/** Inclusive day bounds; give one or both. */
export interface DateRange {
    from?: IsoDate;
    to?: IsoDate;
}
export type DateFilter = (typeof DATE_PRESETS)[number] | DateRange;
export declare const TASK_ORDERS: readonly ["name", "priority", "status", "startAt", "dueAt", "createdAt", "updatedAt"];
/**
 * Needs `parent` or `ancestor`. The other fields filter and sort on the
 * server before `limit` applies.
 * @example
 * useTasks({ ancestor: space, assignees: ["me"], dueAt: "overdue" });
 * useTasks({ parent: list, status: { type: ["active"] }, orderBy: { field: "priority" } });
 */
export interface TaskSelector {
    parent?: Ref<"list"> | string;
    ancestor?: Ref<"space" | "folder" | "list">;
    /** Defaults to 100, at most 500. */
    limit?: number;
    /** Defaults to false. Hides tasks in the list's final status only; `done` tasks still come. */
    includeClosed?: boolean;
    /** Statuses from `useStatuses`, or every status of these types. */
    status?: Ref<"status">[] | {
        type: Status["type"][];
    };
    /** Users and teams, `"me"` for the viewer; or `"none"` for unassigned tasks, `"any"` for assigned ones. */
    assignees?: Array<Ref<"user" | "team"> | "me"> | "none" | "any";
    priority?: Array<NonNullable<Task["priority"]>>;
    tags?: string[];
    /** Tasks whose name contains this text. Descriptions and comments are `useSearch`'s job. */
    name?: {
        contains: string;
    };
    startAt?: DateFilter | "none" | "any";
    dueAt?: DateFilter | "none" | "any" | "overdue";
    createdAt?: DateFilter;
    updatedAt?: DateFilter;
    /** The host's own order when omitted; `direction` defaults to `"asc"`. */
    orderBy?: {
        field: (typeof TASK_ORDERS)[number];
        direction?: "asc" | "desc";
    };
}
/** One of the workspace's task types, e.g. Task, Milestone, Bug. */
export interface TaskType extends Ref<"taskType"> {
    description?: string;
}
export interface TasksApi {
    list(selector: TaskSelector): Promise<Task[]>;
    get(targets: Array<Ref<"task"> | string>): Promise<Task[]>;
    create(input: CreateTaskInput): Promise<Ref<"task">>;
    update(task: Ref<"task"> | string, patch: TaskPatch): Promise<void>;
    /**
     * One read-only `SELECT … FROM tasks`, as the viewer; the rows hold the selected columns by name.
     * @example
     * clickup.tasks.query(`SELECT status, COUNT(*) AS n FROM tasks WHERE list = '${LIST_ID}' GROUP BY status`)
     */
    query(sql: string): Promise<Array<Record<string, unknown>>>;
    /** The workspace's task types. */
    types(): Promise<TaskType[]>;
    /** The effective statuses of a list, folder or space. */
    statuses(selector: StatusSelector): Promise<Status[]>;
}
export declare function useTasks(selector: TaskSelector | Array<Ref<"task"> | string>, options?: UseQueryOptions<Task[]>): UseQueryResult<Task[]>;
/** The rows of `clickup.tasks.query(sql)`, refetched after every task write. */
export declare function useTaskQuery(sql: string, options?: UseQueryOptions<Array<Record<string, unknown>>>): UseQueryResult<Array<Record<string, unknown>>>;
export declare function useTaskTypes(options?: UseQueryOptions<TaskType[]>): UseQueryResult<TaskType[]>;
export declare function useStatuses(selector: StatusSelector, options?: UseQueryOptions<Status[]>): UseQueryResult<Status[]>;
