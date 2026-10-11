import type { Ref, UseQueryOptions, UseQueryResult } from "../core";
import { listOrGet, useLiveQuery } from "../useQuery";

export interface Space extends Ref<"space"> {
  private: boolean;
}

export interface Folder extends Ref<"folder"> {
  ancestors: Array<Ref<"space" | "folder">>;
  private: boolean;
}

export interface List extends Ref<"list"> {
  ancestors: Array<Ref<"space" | "folder">>;
  private: boolean;
}

/** Needs `parent` or `ancestor`. */
export interface FolderSelector {
  parent?: Ref<"space" | "folder">;
  ancestor?: Ref<"space"> | string;
  /** Defaults to 100, at most 500. */
  limit?: number;
}

/** Needs `parent` or `ancestor`. */
export interface ListSelector {
  parent?: Ref<"space" | "folder">;
  ancestor?: Ref<"space"> | string;
  /** Defaults to 100, at most 500. */
  limit?: number;
}

export interface SpacesApi {
  list(): Promise<Space[]>;
  get(targets: Array<Ref<"space"> | string>): Promise<Space[]>;
}

export interface FoldersApi {
  list(selector: FolderSelector): Promise<Folder[]>;
  get(targets: Array<Ref<"folder"> | string>): Promise<Folder[]>;
}

export interface ListsApi {
  list(selector: ListSelector): Promise<List[]>;
  get(targets: Array<Ref<"list"> | string>): Promise<List[]>;
}

/** Every space, or exactly the given ones. */
export function useSpaces(
  targets?: Array<Ref<"space"> | string>,
  options: UseQueryOptions<Space[]> = {},
): UseQueryResult<Space[]> {
  return useLiveQuery(
    "space",
    targets ?? {},
    (client) => listOrGet(client.spaces, targets ?? {}),
    options,
  );
}

export function useFolders(
  selector: FolderSelector | Array<Ref<"folder"> | string>,
  options: UseQueryOptions<Folder[]> = {},
): UseQueryResult<Folder[]> {
  return useLiveQuery(
    "folder",
    selector,
    (client) => listOrGet(client.folders, selector),
    options,
  );
}

export function useLists(
  selector: ListSelector | Array<Ref<"list"> | string>,
  options: UseQueryOptions<List[]> = {},
): UseQueryResult<List[]> {
  return useLiveQuery(
    "list",
    selector,
    (client) => listOrGet(client.lists, selector),
    options,
  );
}
