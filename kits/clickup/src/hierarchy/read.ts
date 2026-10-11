import * as z from "zod/v4-mini";
import type { Ref } from "../core";
import { LiveError } from "../core";
import type { LiveBridge } from "../host/bridge";
import { chunk, pages } from "../host/paging";
import type {
  ArtifactFolderDto,
  ArtifactHierarchyQuery,
  ArtifactHierarchyResult,
  ArtifactListDto,
} from "../host/wire";
import {
  ARTIFACT_HIERARCHY_MAX_IDS,
  ARTIFACT_QUERY_MAX_LIMIT,
  refOf,
} from "../host/wire";
import { memo, memoBy } from "../memo";
import { byIds, clampLimit, selectLoaded } from "../select";
import type { Session } from "../session";
import { scopeOf, treeOf } from "../session";
import { fromHost } from "../validate";
import type {
  Folder,
  FolderSelector,
  List,
  ListSelector,
  Space,
} from "./hierarchy";
import { FolderSchema, ListSchema, SpaceSchema } from "./schema";

/** The `hierarchy` source, mapped: spaces, folders and lists. */
export interface Hierarchy {
  spaces: Space[];
  folders: Folder[];
  lists: List[];
}

export const HIERARCHY_KINDS = ["space", "folder", "list"] as const;

export type HierarchyKind = "space" | "folder" | "list";

interface Lookup {
  kind: HierarchyKind;
  ids: string[];
}

/** The hierarchy by scope, each scope read once per session. */
export interface HierarchyReads {
  /** Every space, without their folders and lists. */
  spaces(): Promise<Hierarchy>;
  /** One space's folders and lists. */
  tree(spaceId: string): Promise<Hierarchy>;
  /** Exactly these `kind` assets, with the folders and spaces they sit in. */
  lookup(kind: HierarchyKind, ids: string[]): Promise<Hierarchy>;
  /** Forgets everything read, so the next reads reach the host again. */
  reset(): void;
}

export function createHierarchyReads(host: LiveBridge): HierarchyReads {
  const spaces = memo(async () =>
    mapHierarchy(await browse(host, { entities: "spaces" })),
  );
  const tree = memoBy(async (spaceId: string) =>
    mapHierarchy(await browse(host, { spaceId })),
  );
  const lookups = memoBy(
    async (target: Lookup) => mapHierarchy(await lookup(host, target)),
    ({ kind, ids }) => `${kind}:${[...ids].sort().join(",")}`,
  );
  return {
    spaces,
    tree,
    lookup: (kind, ids) => lookups({ kind, ids }),
    reset: () => {
      spaces.reset();
      tree.reset();
      lookups.reset();
    },
  };
}

type BrowseInput = Omit<
  Exclude<ArtifactHierarchyQuery, { ids: unknown }>,
  "cursor" | "limit"
>;

async function browse(
  host: LiveBridge,
  input: BrowseInput,
): Promise<ArtifactHierarchyResult> {
  const wire: ArtifactHierarchyResult = { spaces: [], folders: [], lists: [] };
  for await (const page of pages((cursor) =>
    host.query("hierarchy", {
      ...input,
      limit: ARTIFACT_QUERY_MAX_LIMIT,
      cursor,
    }),
  )) {
    wire.spaces.push(...page.spaces);
    wire.folders.push(...page.folders);
    wire.lists.push(...page.lists);
  }
  return wire;
}

async function lookup(
  host: LiveBridge,
  { kind, ids }: Lookup,
): Promise<ArtifactHierarchyResult> {
  const results = await Promise.all(
    chunk(ids, ARTIFACT_HIERARCHY_MAX_IDS).map((batch) =>
      host.query("hierarchy", {
        ids: batch.map((id) => ({ kind, id })),
        includeParents: true,
      }),
    ),
  );
  return {
    spaces: dedupe(results.flatMap((result) => result.spaces)),
    folders: dedupe(results.flatMap((result) => result.folders)),
    lists: dedupe(results.flatMap((result) => result.lists)),
  };
}

function dedupe<T extends { id: string }>(assets: T[]): T[] {
  return [...new Map(assets.map((asset) => [asset.id, asset])).values()];
}

function mapHierarchy(wire: ArtifactHierarchyResult): Hierarchy {
  const spacesById = new Map(wire.spaces.map((space) => [space.id, space]));
  const foldersById = new Map(
    wire.folders.map((folder) => [folder.id, folder]),
  );

  /** The folders enclosing a folder or list, innermost first, starting at `folderId`. */
  const foldersAbove = (
    child: ArtifactFolderDto | ArtifactListDto,
    folderId: string | undefined,
  ): ArtifactFolderDto[] => {
    const folders: ArtifactFolderDto[] = [];
    let id = folderId;
    while (id !== undefined) {
      const folder = listed(foldersById, id, child);
      if (folders.includes(folder)) {
        throw new LiveError(
          "failed",
          `The host returned folders nested in a cycle above "${child.name}" (${child.id}).`,
        );
      }
      folders.push(folder);
      id = folder.parentFolderId;
    }
    return folders;
  };

  /** Root first: the space, then the enclosing folders from the outside in. */
  const ancestorsOf = (
    child: ArtifactFolderDto | ArtifactListDto,
    folderId: string | undefined,
  ): Array<Ref<"space" | "folder">> => [
    refOf("space", listed(spacesById, child.spaceId, child)),
    ...foldersAbove(child, folderId)
      .reverse()
      .map((folder) => refOf("folder", folder)),
  ];

  const spaces = wire.spaces.map(
    (space): Space => ({ ...refOf("space", space), private: space.private }),
  );
  const folders = wire.folders.map(
    (folder): Folder => ({
      ...refOf("folder", folder),
      ancestors: ancestorsOf(folder, folder.parentFolderId),
      private: folder.private,
    }),
  );
  const lists = wire.lists.map(
    (list): List => ({
      ...refOf("list", list),
      ancestors: ancestorsOf(list, list.folderId),
      private: list.private,
    }),
  );
  return {
    spaces: fromHost(z.array(SpaceSchema), spaces, "spaces"),
    folders: fromHost(z.array(FolderSchema), folders, "folders"),
    lists: fromHost(z.array(ListSchema), lists, "lists"),
  };
}

/** The parent the same hierarchy result lists; the host is broken if it does not. */
function listed<T>(
  parents: Map<string, T>,
  id: string,
  child: { id: string; name: string },
): T {
  const parent = parents.get(id);
  if (!parent) {
    throw new LiveError(
      "failed",
      `The host returned "${child.name}" (${child.id}) under an unlisted parent ${id}.`,
    );
  }
  return parent;
}

/** The tree of the space a folder or list selector scopes to; a bare `ancestor` is a space id. */
function scopedTree(
  s: Session,
  selector: FolderSelector | ListSelector,
): Promise<Hierarchy> {
  const scope = scopeOf(selector);
  return typeof scope === "string" ? s.hierarchy.tree(scope) : treeOf(s, scope);
}

/** A folder or list selector as `selectLoaded` takes it, with a bare `ancestor` read as a space. */
function loadedSelector(selector: FolderSelector | ListSelector) {
  const { ancestor } = selector;
  return {
    ...selector,
    ancestor:
      typeof ancestor === "string"
        ? { kind: "space" as const, id: ancestor }
        : ancestor,
    limit: clampLimit(selector.limit),
  };
}

export async function readSpaces(s: Session): Promise<Space[]> {
  return (await s.hierarchy.spaces()).spaces;
}

export async function getSpaces(s: Session, ids: string[]): Promise<Space[]> {
  return byIds((await s.hierarchy.lookup("space", ids)).spaces, ids);
}

export async function readFolders(
  s: Session,
  selector: FolderSelector,
): Promise<Folder[]> {
  const { folders } = await scopedTree(s, selector);
  return selectLoaded(folders, loadedSelector(selector));
}

export async function getFolders(s: Session, ids: string[]): Promise<Folder[]> {
  return byIds((await s.hierarchy.lookup("folder", ids)).folders, ids);
}

export async function readLists(
  s: Session,
  selector: ListSelector,
): Promise<List[]> {
  const { lists } = await scopedTree(s, selector);
  return selectLoaded(lists, loadedSelector(selector));
}

export async function getLists(s: Session, ids: string[]): Promise<List[]> {
  return byIds((await s.hierarchy.lookup("list", ids)).lists, ids);
}
