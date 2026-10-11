import type {
  Delta,
  LiveErrorCode,
  Ref,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "../core";
import type { CustomField } from "../customFields/customFields";
import type {
  CreateTaskInput,
  Status,
  StatusSelector,
  Task,
  TaskPatch,
  TaskSelector,
} from "../tasks/tasks";

/** A stand-in for the kit barrel that records every call and answers hooks synchronously, for testing the entities engine without a host or a renderer. */
export interface FakeKitState {
  tasks: Map<string, Task>;
  statuses: Status[];
  customFields: CustomField[];
  calls: unknown[][];
  nextId: number;
  /** "silent" makes the next create succeed without reporting the task. */
  created?: "silent";
}

class LiveError extends Error {
  readonly code: LiveErrorCode;
  readonly retryable: boolean;
  readonly reason: string | undefined;

  constructor(
    code: LiveErrorCode,
    message: string,
    options: { retryable?: boolean; reason?: string } = {},
  ) {
    super(message);
    this.name = "LiveError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.reason = options.reason;
  }
}

function idOf(target: Ref | string): string {
  return typeof target === "string" ? target : target.id;
}

function taskUrl(id: string): string {
  return `https://app.clickup.com/t/${id}`;
}

function paragraph(text: string): Delta {
  return { ops: [{ insert: `${text}\n` }] };
}

function result<T>(data: T | undefined, enabled = true): UseQueryResult<T> {
  const isPending = data === undefined;
  const isFetching = isPending && enabled;
  return {
    data,
    error: null,
    status: isPending ? "pending" : "success",
    isPending,
    isLoading: isPending && isFetching,
    isFetching,
    isRefetching: false,
    isPlaceholderData: false,
    isError: false,
    isSuccess: !isPending,
    dataUpdatedAt: isPending ? 0 : 1,
    refetch: () => Promise.resolve(),
  };
}

export function createFakeKit() {
  const state: FakeKitState = {
    tasks: new Map(),
    statuses: [],
    customFields: [],
    calls: [],
    nextId: 100,
  };

  function getTasks(targets: Array<Ref<"task"> | string>): Task[] {
    return targets.flatMap((target) => {
      const task = state.tasks.get(idOf(target));
      return task ? [task] : [];
    });
  }

  function listTasks(selector: TaskSelector): Task[] {
    let tasks = [...state.tasks.values()].filter(
      (task) =>
        task.ancestors[task.ancestors.length - 1]!.id ===
        idOf(selector.parent!),
    );
    if (Array.isArray(selector.status)) {
      const ids = new Set(selector.status.map((status) => status.id));
      tasks = tasks.filter((task) => ids.has(task.status.id));
    } else if (selector.status) {
      const types = new Set<string>(selector.status.type);
      tasks = tasks.filter((task) => types.has(task.status.type));
    }
    if (!selector.includeClosed) {
      tasks = tasks.filter((task) => task.status.type !== "closed");
    }
    return tasks.slice(0, selector.limit ?? 100);
  }

  const clickup = {
    tasks: {
      async list(selector: TaskSelector): Promise<Task[]> {
        state.calls.push(["tasks.list", selector]);
        return listTasks(selector);
      },
      async get(targets: Array<Ref<"task"> | string>): Promise<Task[]> {
        state.calls.push(["tasks.get", targets.map(idOf)]);
        return getTasks(targets);
      },
      async update(
        target: Ref<"task"> | string,
        patch: TaskPatch,
      ): Promise<void> {
        state.calls.push(["tasks.update", idOf(target), patch]);
        const task = state.tasks.get(idOf(target))!;
        if (patch.name !== undefined) task.name = patch.name;
        if (patch.status !== undefined) task.status = patch.status as Status;
        if (patch.dueAt !== undefined) task.dueAt = patch.dueAt ?? undefined;
        if (patch.bodyMarkdown !== undefined) {
          task.body = paragraph(patch.bodyMarkdown);
        }
        if (patch.customFields !== undefined) {
          task.customFields = patch.customFields;
        }
      },
      async create(input: CreateTaskInput): Promise<Ref<"task"> | undefined> {
        state.calls.push(["tasks.create", input]);
        const id = String(state.nextId++);
        const typeId = input.type === undefined ? "0" : idOf(input.type);
        state.tasks.set(id, {
          kind: "task",
          id,
          name: input.name,
          url: taskUrl(id),
          ancestors: [
            { kind: "list", id: idOf(input.list), name: "List", url: "" },
          ],
          otherLists: [],
          private: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          dueAt: input.dueAt,
          status: (input.status ?? state.statuses[0]) as Status,
          type: { kind: "taskType", id: typeId, name: "", url: "" },
          tags: [],
          customFields: [],
          body: paragraph(input.bodyMarkdown ?? ""),
          creator: { kind: "user", id: "u1", name: "Creator", url: "" },
          assignees: input.assignees ?? [],
          watchers: [],
          checklists: [],
        });
        return state.created === "silent"
          ? undefined
          : { kind: "task", id, name: input.name, url: taskUrl(id) };
      },
      async statuses(selector: StatusSelector): Promise<Status[]> {
        state.calls.push(["tasks.statuses", selector]);
        return state.statuses;
      },
    },
    customFields: {
      async list(): Promise<CustomField[]> {
        return state.customFields;
      },
    },
  };

  function useTasks(
    selector: TaskSelector | Array<Ref<"task"> | string>,
    options: UseQueryOptions = {},
  ): UseQueryResult<Task[]> {
    state.calls.push(["useTasks", selector, options]);
    if (options.enabled === false) {
      return result<Task[]>(undefined, false);
    }
    return result(
      Array.isArray(selector) ? getTasks(selector) : listTasks(selector),
    );
  }

  function useStatuses(
    selector: StatusSelector,
    options: UseQueryOptions = {},
  ): UseQueryResult<Status[]> {
    state.calls.push(["useStatuses", selector, options]);
    return options.enabled === false
      ? result<Status[]>(undefined, false)
      : result(state.statuses);
  }

  function useCustomFields(
    selector: unknown,
    options: UseQueryOptions = {},
  ): UseQueryResult<CustomField[]> {
    state.calls.push(["useCustomFields", selector, options]);
    return options.enabled === false
      ? result<CustomField[]>(undefined, false)
      : result(state.customFields);
  }

  function useMutation<TData, TVariables>(
    mutationFn: (variables: TVariables) => Promise<TData>,
  ): UseMutationResult<TData, TVariables> {
    return {
      data: undefined,
      error: null,
      variables: undefined,
      isError: false,
      isPending: false,
      isSuccess: false,
      status: "idle",
      mutate(variables: TVariables) {
        mutationFn(variables).catch(() => undefined);
      },
      mutateAsync: mutationFn,
      reset() {},
    } as UseMutationResult<TData, TVariables>;
  }

  return {
    LiveError,
    clickup,
    useTasks,
    useStatuses,
    useCustomFields,
    useMutation,
    __state: state,
  };
}

export type FakeKit = ReturnType<typeof createFakeKit>;
