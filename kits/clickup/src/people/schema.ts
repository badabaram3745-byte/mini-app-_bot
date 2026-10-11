import * as z from "zod/v4-mini";
import { ref, refFields, schemaOf } from "../validate";
import type { Team, User } from "./people";

export const UserSchema = schemaOf<User>()(z.object(refFields(["user"])));

export const TeamSchema = schemaOf<Team>()(
  z.object({ ...refFields(["team"]), members: z.array(ref(["user"])) }),
);
