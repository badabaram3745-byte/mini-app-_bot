import type {
  Ref,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "../core";
import type { CustomField } from "../customFields/customFields";
import type { Status, Task } from "../tasks/tasks";

/** A property every task has, mapped to a record property by the schema. */
export type NativeProperty =
  | "name"
  | "status"
  | "assignees"
  | "dueDate"
  | "startDate"
  | "priority"
  | "description";

export interface OptionSpec {
  id: string;
  /** The option's name in ClickUp; what the kit reads and writes. */
  label: string;
}

export interface FieldSpec {
  /** The record property; a relationship becomes <key>Ids and <key>Refs. */
  key: string;
  /** The ClickUp custom field id. */
  id: string;
  name: string;
  type: CustomField["type"];
  required: boolean;
  /** False keeps a type the kit cannot read off the record and out of the drift check. */
  readable: boolean;
  /** The kit cannot write this type yet; writes are rejected. */
  readOnly: boolean;
  /** Drop-down and labels only: logical option key to ClickUp option. */
  options?: Readonly<Record<string, OptionSpec>>;
  targetEntity?: string;
  targetListId?: string;
}

/** One entity's frozen ids, as _schema.ts exports them. */
export interface EntitySchema {
  key: string;
  list: { id: string; name: string; url: string };
  taskType?: { id: number; name: string };
  natives: ReadonlyArray<{ key: string; native: NativeProperty }>;
  fields: readonly FieldSpec[];
}

export interface RecordBase {
  id: string;
  /** Link to the task in ClickUp; safe to render for the viewer. */
  url: string;
  /** The underlying clickup-kit Task, for anything the schema does not model. */
  task: Task;
}

/**
 * status, statusType, limit and includeClosed are applied by ClickUp; the
 * entity's task type, where and orderBy run in the browser on the decoded
 * records. With ids, ClickUp returns exactly those tasks and every filter
 * runs in the browser.
 */
export interface ListFilter<R, S extends string> {
  /** Status names as shown in ClickUp, case-insensitive. */
  status?: readonly S[];
  statusType?: ReadonlyArray<Status["type"]>;
  ids?: readonly string[];
  limit?: number;
  /** ClickUp hides tasks in the closing status unless this is true. */
  includeClosed?: boolean;
  where?: (record: R) => boolean;
  /** Unset values sort last. */
  orderBy?: { field: keyof R; direction?: "asc" | "desc" };
}

export interface EntityClient<R, I, P, S extends string> {
  list(filter?: ListFilter<R, S>): Promise<R[]>;
  get(id: string): Promise<R>;
  /** Resolves with the new task's ref when the host reports it. */
  create(input: I): Promise<Ref<"task"> | undefined>;
  /** undefined leaves a property alone; null clears one that is optional. */
  update(id: string, patch: P): Promise<void>;
  /** Moves the task to the List's closing status. There is no delete. */
  close(id: string): Promise<void>;
}

export interface Entity<R extends RecordBase, I, P, S extends string> {
  schema: EntitySchema;
  decode(task: Task): R;
  client: EntityClient<R, I, P, S>;
  useList(
    filter?: ListFilter<R, S>,
    options?: UseQueryOptions<Task[]>,
  ): UseQueryResult<R[]>;
  /** data is undefined while loading and when no task has that id; isSuccess tells them apart. */
  useOne(
    id: string | undefined,
    options?: UseQueryOptions<Task[]>,
  ): UseQueryResult<R | undefined>;
  useMany(
    ids: readonly string[],
    options?: UseQueryOptions<Task[]>,
  ): UseQueryResult<R[]>;
  useCreate(): UseMutationResult<Ref<"task"> | undefined, I>;
  useUpdate(): UseMutationResult<void, { id: string; patch: P }>;
  useClose(): UseMutationResult<void, string>;
}
