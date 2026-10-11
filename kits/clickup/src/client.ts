import * as z from "zod/v4-mini";
import { attachCache } from "./cache/attach";
import { getComments, readComments } from "./comments/read";
import {
  CommentPatchSchema,
  CommentSelectorSchema,
  CreateCommentInputSchema,
} from "./comments/schema";
import { createComment, updateComment } from "./comments/write";
import type { LiveClient } from "./core";
import { readCustomFields } from "./customFields/read";
import { CustomFieldSelectorSchema } from "./customFields/schema";
import {
  getFolders,
  getLists,
  getSpaces,
  readFolders,
  readLists,
  readSpaces,
} from "./hierarchy/read";
import { FolderSelectorSchema, ListSelectorSchema } from "./hierarchy/schema";
import type { LiveBridge } from "./host/bridge";
import { windowBridge } from "./host/bridge";
import { perform } from "./host/perform";
import { toHtml } from "./host/quill";
import {
  ARTIFACT_NAVIGATION_CAPABILITIES,
  ArtifactWriteActionType as Action,
} from "./host/wire";
import { getInbox, readInbox } from "./inbox/read";
import { InboxBundlePatchSchema, InboxSelectorSchema } from "./inbox/schema";
import { updateInboxBundle } from "./inbox/write";
import type { User } from "./people/people";
import {
  getTeams,
  getUsers,
  mapMember,
  readTeams,
  readUsers,
} from "./people/read";
import { getReminders, readReminders } from "./reminders/read";
import {
  CreateReminderInputSchema,
  ReminderPatchSchema,
  ReminderSelectorSchema,
} from "./reminders/schema";
import { createReminder, updateReminder } from "./reminders/write";
import { search } from "./search/read";
import { SearchQuerySchema } from "./search/schema";
import { createSession } from "./session";
import { Store } from "./store";
import { getTasks, queryTasks, readTasks } from "./tasks/read";
import { readStatuses } from "./tasks/statuses";
import { readTaskTypes } from "./tasks/taskTypes";
import {
  CreateTaskInputSchema,
  StatusSelectorSchema,
  TaskPatchSchema,
  TaskSelectorSchema,
} from "./tasks/schema";
import { createTask, updateTask } from "./tasks/write";
import { check, delta, refOrId, targets } from "./validate";

const url = z.string().check(z.minLength(1, "Expected a ClickUp url"));
const prompt = z.string().check(z.minLength(1, "Expected a prompt"));
const sql = z.string().check(z.minLength(1, "Expected a SELECT statement"));

let hostClient: LiveClient | undefined;

/**
 * Reads and writes outside React: the same reads as the hooks, as promises,
 * plus all writes. Use it in event handlers and plain modules.
 */
export const clickup: LiveClient = new Proxy({} as LiveClient, {
  get: (_, key) => Reflect.get((hostClient ??= createLiveClient()), key),
});

/**
 * @internal A client over any bridge; `clickup` is one over the window's
 * host. Every input is checked against its schema here.
 */
export function createLiveClient(
  bridge: LiveBridge = windowBridge(),
): LiveClient {
  const store = new Store();
  const s = createSession(bridge, store);
  attachCache(store, bridge);
  let viewer: User | undefined;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      store.reload();
    }
  });

  return {
    store,
    spaces: {
      list: async () => readSpaces(s),
      get: async (spaces) => getSpaces(s, check(targets("space"), spaces)),
    },
    folders: {
      list: async (selector) =>
        readFolders(s, check(FolderSelectorSchema, selector)),
      get: async (folders) => getFolders(s, check(targets("folder"), folders)),
    },
    lists: {
      list: async (selector) =>
        readLists(s, check(ListSelectorSchema, selector)),
      get: async (lists) => getLists(s, check(targets("list"), lists)),
    },
    customFields: {
      list: async (selector) =>
        readCustomFields(s, check(CustomFieldSelectorSchema, selector)),
    },
    tasks: {
      list: async (selector) =>
        readTasks(s, check(TaskSelectorSchema, selector)),
      get: async (tasks) => getTasks(s, check(targets("task"), tasks)),
      create: async (input) =>
        createTask(s, check(CreateTaskInputSchema, input)),
      update: async (task, patch) =>
        updateTask(
          s,
          check(refOrId("task"), task),
          check(TaskPatchSchema, patch),
        ),
      query: async (statement) => queryTasks(s, check(sql, statement)),
      types: async () => readTaskTypes(s),
      statuses: async (selector) =>
        readStatuses(s, check(StatusSelectorSchema, selector)),
    },
    comments: {
      list: async (selector) =>
        readComments(s, check(CommentSelectorSchema, selector)),
      get: async (comments) =>
        getComments(s, check(targets("comment"), comments)),
      create: async (input) =>
        createComment(s, check(CreateCommentInputSchema, input)),
      update: async (comment, patch) =>
        updateComment(
          s,
          check(refOrId("comment"), comment),
          check(CommentPatchSchema, patch),
        ),
    },
    users: {
      list: async () => readUsers(s),
      get: async (users) => getUsers(s, check(targets("user"), users)),
    },
    teams: {
      list: async () => readTeams(s),
      get: async (teams) => getTeams(s, check(targets("team"), teams)),
    },
    inbox: {
      list: async (selector = {}) =>
        readInbox(s, check(InboxSelectorSchema, selector)),
      get: async (bundles) =>
        getInbox(s, check(targets("inboxBundle"), bundles)),
      update: async (bundle, patch) =>
        updateInboxBundle(
          s,
          check(refOrId("inboxBundle"), bundle),
          check(InboxBundlePatchSchema, patch),
        ),
    },
    reminders: {
      list: async (selector = {}) =>
        readReminders(s, check(ReminderSelectorSchema, selector)),
      get: async (reminders) =>
        getReminders(s, check(targets("reminder"), reminders)),
      create: async (input) =>
        createReminder(s, check(CreateReminderInputSchema, input)),
      update: async (reminder, patch) =>
        updateReminder(
          s,
          check(refOrId("reminder"), reminder),
          check(ReminderPatchSchema, patch),
        ),
    },
    navigate: async (location) => {
      await perform(bridge, ARTIFACT_NAVIGATION_CAPABILITIES.open, {
        url: check(url, location),
      });
    },
    search: async (query) => search(s, check(SearchQuerySchema, query)),
    askBrain: async (text) => {
      await perform(bridge, Action.AiPrompt, { prompt: check(prompt, text) });
    },
    toHtml: async (body) => toHtml(bridge, check(delta, body)),
    get viewer() {
      return (viewer ??= mapMember(bridge.viewer()));
    },
  };
}

if (typeof window !== "undefined" && "clickup" in window) {
  hostClient = createLiveClient();
}
