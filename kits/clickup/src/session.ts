import type { Ref } from "./core";
import { asRef, idOf, LiveError, pathOf } from "./core";
import type { Hierarchy, HierarchyReads } from "./hierarchy/read";
import { createHierarchyReads, HIERARCHY_KINDS } from "./hierarchy/read";
import type { LiveBridge } from "./host/bridge";
import { memo } from "./memo";
import type { Team, User } from "./people/people";
import type { Members } from "./people/read";
import { loadMembers } from "./people/read";
import type { Store } from "./store";
import { loadTaskTypes } from "./tasks/taskTypes";
import type { TaskType } from "./tasks/tasks";

/** The ids of the space, folder and list an asset sits in. */
export interface LocationIds {
  spaceId?: string;
  folderId?: string;
  listId?: string;
}

type LocationRef = Ref<"space" | "folder" | "list">;

/**
 * One connection to a host: its bridge, its query store, and the bundles
 * read once and shared by every query, until a refetch or an invalidation
 * of one of their kinds drops them.
 */
export interface Session {
  host: LiveBridge;
  store: Store;
  hierarchy: HierarchyReads;
  /** The members bundle; rejects when the grant is withheld. */
  members(): Promise<Members>;
  /** The workspace member with `id`, if any. */
  member(id: string): Promise<User | undefined>;
  /** The workspace team with `id`, if any. */
  team(id: string): Promise<Team | undefined>;
  /** The task type catalog; rejects when the grant is withheld. */
  taskTypes(): Promise<TaskType[]>;
  /**
   * The refs of a location's ids, root first, as far as its space's tree
   * lists them; a level the tree does not list (hidden, inaccessible,
   * archived, or no hierarchy grant) is left out.
   */
  path(ids: LocationIds): Promise<LocationRef[]>;
}

export function createSession(host: LiveBridge, store: Store): Session {
  const hierarchy = createHierarchyReads(host);
  const members = memo(() => loadMembers(host));
  const users = memo(
    async () => new Map((await members()).users.map((user) => [user.id, user])),
  );
  const teams = memo(
    async () => new Map((await members()).teams.map((team) => [team.id, team])),
  );
  const taskTypes = memo(() => loadTaskTypes(host));
  store.onRefresh(HIERARCHY_KINDS, hierarchy.reset);
  store.onRefresh(["user", "team"], () => {
    members.reset();
    users.reset();
    teams.reset();
  });
  store.onRefresh(["taskType"], taskTypes.reset);

  return {
    host,
    store,
    hierarchy,
    members,
    async member(id) {
      const known = await users().catch(() => undefined);
      return known?.get(id);
    },
    async team(id) {
      const known = await teams().catch(() => undefined);
      return known?.get(id);
    },
    taskTypes,
    async path({ spaceId, folderId, listId }) {
      if (!spaceId) {
        return [];
      }
      const tree = await hierarchy.tree(spaceId).catch(() => undefined);
      if (!tree) {
        return [];
      }
      const deepest: LocationRef | undefined =
        tree.lists.find((list) => list.id === listId) ??
        tree.folders.find((folder) => folder.id === folderId) ??
        tree.spaces.find((space) => space.id === spaceId);
      return deepest
        ? [...(pathOf(deepest) as LocationRef[]), asRef(deepest)]
        : [];
    },
  };
}

/** The full asset behind a ref or id: the copy on screen, else one read through the kind's `get`. */
export async function resolve<T extends Ref>(
  s: Session,
  kind: T["kind"],
  target: Ref | string,
  get: (s: Session, ids: string[]) => Promise<T[]>,
): Promise<T> {
  const id = idOf(target);
  const held = s.store.find<T>(kind, id);
  if (held) {
    return held;
  }
  const [found] = await get(s, [id]);
  if (!found) {
    throw new LiveError(
      "invalid",
      `No ${kind} with id ${id}, or it is not visible to you.`,
    );
  }
  return found;
}

/** The `ancestor` or `parent` a selector names; its schema guarantees one. */
export function scopeOf<P, A>(selector: {
  parent?: P;
  ancestor?: A;
}): NonNullable<A | P> {
  return (selector.ancestor ?? selector.parent)!;
}

/** The tree of the space a space or folder ref sits in. */
export async function treeOf(
  s: Session,
  ref: Ref<"space" | "folder">,
): Promise<Hierarchy> {
  return s.hierarchy.tree(await spaceIdOf(s, ref));
}

/** The space a ref sits in: from its path when it is a full asset, else looked up by id. */
async function spaceIdOf(
  s: Session,
  ref: Ref<"space" | "folder">,
): Promise<string> {
  if (ref.kind === "space") {
    return ref.id;
  }
  const known = pathOf(ref).find((ancestor) => ancestor.kind === "space");
  if (known) {
    return known.id;
  }
  const { folders } = await s.hierarchy.lookup("folder", [ref.id]);
  const folder = folders.find((candidate) => candidate.id === ref.id);
  const space = folder?.ancestors.find((ancestor) => ancestor.kind === "space");
  if (!space) {
    throw new LiveError(
      "invalid",
      `No folder with id ${ref.id}, or it is not visible to you.`,
    );
  }
  return space.id;
}
