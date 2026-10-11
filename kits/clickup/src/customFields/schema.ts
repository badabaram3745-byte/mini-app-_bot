import * as z from "zod/v4-mini";
import { ref, refFields, schemaOf } from "../validate";
import type { CustomField, CustomFieldSelector } from "./customFields";
import { CUSTOM_FIELD_TYPES } from "./customFields";

export const CustomFieldSchema = schemaOf<CustomField>()(
  z.object({
    ...refFields(["customField"]),
    ancestors: z.array(ref(["space", "folder", "list"])),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.optional(
      z.array(z.object({ name: z.string(), color: z.string() })),
    ),
  }),
);

export const CustomFieldSelectorSchema = schemaOf<CustomFieldSelector>()(
  z.strictObject({
    parent: ref(["task", "space", "folder", "list"]),
  }),
);
