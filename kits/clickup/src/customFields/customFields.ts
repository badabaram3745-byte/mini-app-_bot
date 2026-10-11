import type { Ref, UseQueryOptions, UseQueryResult } from "../core";
import { useLiveQuery } from "../useQuery";

export const CUSTOM_FIELD_TYPES = [
  "short_text",
  "text",
  "email",
  "url",
  "phone",
  "number",
  "currency",
  "checkbox",
  "date",
  "drop_down",
  "labels",
  "users",
  "tasks",
  "list_relationship",
  "emoji",
  "votes",
  "manual_progress",
  "automatic_progress",
  "attachment",
  "location",
  "formula",
  "signature",
  "button",
] as const;

/** A custom field's definition. Values live on each task in `customFields`, matched by `id`. */
export interface CustomField extends Ref<"customField"> {
  /** Ends at the space, folder or list the field is configured on. */
  ancestors: Array<Ref<"space" | "folder" | "list">>;
  type: (typeof CUSTOM_FIELD_TYPES)[number];
  /** For drop-down and labels fields: the allowed values, in display order. */
  options?: Array<{ name: string; color: string }>;
}

/** The fields available on a task, or on tasks in a space, folder or list. Inherited fields are included; `ancestors` shows where each is configured. */
export interface CustomFieldSelector {
  parent: Ref<"task" | "space" | "folder" | "list">;
}

export interface CustomFieldsApi {
  list(selector: CustomFieldSelector): Promise<CustomField[]>;
}

export function useCustomFields(
  selector: CustomFieldSelector,
  options: UseQueryOptions<CustomField[]> = {},
): UseQueryResult<CustomField[]> {
  return useLiveQuery(
    "customField",
    selector,
    (client) => client.customFields.list(selector),
    options,
  );
}
