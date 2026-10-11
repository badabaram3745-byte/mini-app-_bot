import type {
  ArtifactCommentsQuery,
  ArtifactCustomFieldsQuery,
  ArtifactHierarchyQuery,
  ArtifactInboxQuery,
  ArtifactMembersQuery,
  ArtifactQuillDelta,
  ArtifactRemindersQuery,
  ArtifactStatusesQuery,
  ArtifactTasksQuery,
  ArtifactTaskTypesQuery,
  ArtifactWorkspaceQuery,
  EMBED_DATA_QUERY_SORT_FIELDS,
  EmbedDataQueryFilter,
  EmbedDataQueryLocationType,
  EmbedSearchOrderBy,
  EmbedSearchOrderDirection,
} from "@time-loop/artifacts-protocol";
import type { AssetKind, Ref } from "../core";
import type { Task } from "../tasks/tasks";

export * from "@time-loop/artifacts-protocol";

/** The host's refusal of a call the artifact's build did not declare in its capabilities manifest. */
export const NOT_DECLARED = "not-declared";
/** The host's refusal of a call whose feature is off for the workspace. */
export const NOT_ENABLED = "not-enabled";

export const ARTIFACT_QUERY_MAX_TASK_IDS = 50;
export const ARTIFACT_COMMENTS_MAX_LIMIT = 50;
export const ARTIFACT_HIERARCHY_MAX_IDS = 100;
export const ARTIFACT_REMINDERS_MAX_LIMIT = 100;
export const ARTIFACT_QUERY_MAX_LIMIT = 500;

export type EmbedDataQuerySortField =
  (typeof EMBED_DATA_QUERY_SORT_FIELDS)[number];

export interface EmbedDataQuery {
  entity: "task";
  location: { id: string; type: EmbedDataQueryLocationType };
  filters?: EmbedDataQueryFilter[];
  includeClosed?: boolean;
  sort?: { field: EmbedDataQuerySortField; dir: "asc" | "desc" };
  limit?: number;
  cursor?: string;
}

export interface EmbedSearchRequest {
  keywords?: string;
  assetTypes?: string[];
  excludeAssetTypes?: string[];
  ancestors?: Array<{ externalId: string }>;
  creatorIds?: string[];
  orderBy?: EmbedSearchOrderBy;
  orderDirection?: EmbedSearchOrderDirection;
  cursor?: string;
  limit?: number;
}

/** The `query()` sources the kit reads, with the protocol's input for each. */
export interface ArtifactQuerySourceInputs {
  comments: ArtifactCommentsQuery;
  customFields: ArtifactCustomFieldsQuery;
  hierarchy: ArtifactHierarchyQuery;
  inbox: ArtifactInboxQuery;
  members: ArtifactMembersQuery;
  queryWorkspace: ArtifactWorkspaceQuery;
  quillHtml: { content: ArtifactQuillDelta };
  reminders: ArtifactRemindersQuery;
  statuses: ArtifactStatusesQuery;
  tasks: ArtifactTasksQuery;
  taskTypes: ArtifactTaskTypesQuery;
}

export type KitQuerySource = keyof ArtifactQuerySourceInputs;

/** The ref of a wire entity that names itself. */
export function refOf<K extends AssetKind>(
  kind: K,
  wire: { id: string; name: string; url: string },
): Ref<K> {
  return { kind, id: wire.id, name: wire.name, url: wire.url };
}

/** Task priorities on the wire are ids: `1` urgent through `4` low. */
export const PRIORITY_IDS: Readonly<
  Record<NonNullable<Task["priority"]>, string>
> = {
  urgent: "1",
  high: "2",
  normal: "3",
  low: "4",
};

/** ClickUp's object type name for each kind that has one. */
export const OBJECT_TYPES = {
  space: "project",
  folder: "category",
  list: "subcategory",
  task: "task",
  comment: "comment",
  reminder: "reminder",
} as const satisfies Partial<Record<AssetKind, string>>;

const KINDS_BY_OBJECT_TYPE = new Map(
  Object.entries(OBJECT_TYPES).map(([kind, type]) => [type, kind]),
) as ReadonlyMap<string, keyof typeof OBJECT_TYPES>;

/** The kind behind one of ClickUp's object type names; undefined for types the model does not have. */
export function kindOfObjectType(
  type: string,
): keyof typeof OBJECT_TYPES | undefined {
  return KINDS_BY_OBJECT_TYPE.get(type);
}
