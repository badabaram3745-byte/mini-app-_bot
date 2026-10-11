import * as z from "zod/v4-mini";
import {
  ref,
  refFields,
  refOrId,
  schemaOf,
  scoped,
  selection,
} from "../validate";
import type {
  Folder,
  FolderSelector,
  List,
  ListSelector,
  Space,
} from "./hierarchy";

export const SpaceSchema = schemaOf<Space>()(
  z.object({ ...refFields(["space"]), private: z.boolean() }),
);

export const FolderSchema = schemaOf<Folder>()(
  z.object({
    ...refFields(["folder"]),
    ancestors: z.array(ref(["space", "folder"])),
    private: z.boolean(),
  }),
);

export const ListSchema = schemaOf<List>()(
  z.object({
    ...refFields(["list"]),
    ancestors: z.array(ref(["space", "folder"])),
    private: z.boolean(),
  }),
);

export const FolderSelectorSchema = schemaOf<FolderSelector>()(
  z
    .strictObject({
      parent: z.optional(ref(["space", "folder"])),
      ancestor: z.optional(refOrId("space")),
      ...selection,
    })
    .check(scoped),
);

export const ListSelectorSchema = schemaOf<ListSelector>()(
  z
    .strictObject({
      parent: z.optional(ref(["space", "folder"])),
      ancestor: z.optional(refOrId("space")),
      ...selection,
    })
    .check(scoped),
);
