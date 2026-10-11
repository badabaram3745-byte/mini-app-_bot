import * as z from "zod/v4-mini";
import type { Ref } from "../core";
import type { LiveBridge } from "../host/bridge";
import { pages } from "../host/paging";
import type {
  ArtifactGroupDto,
  ArtifactMemberDto,
  ArtifactMembersResult,
  ArtifactUserRef,
} from "../host/wire";
import { ARTIFACT_QUERY_MAX_LIMIT } from "../host/wire";
import { byIds } from "../select";
import type { Session } from "../session";
import { fromHost } from "../validate";
import type { Team, User } from "./people";
import { TeamSchema, UserSchema } from "./schema";

/** The `members` source, mapped: everyone in the workspace and every team. */
export interface Members {
  users: User[];
  teams: Team[];
}

export async function loadMembers(host: LiveBridge): Promise<Members> {
  const members = [];
  const groups = [];
  for await (const page of pages((cursor) =>
    host.query("members", {
      includeGroups: true,
      limit: ARTIFACT_QUERY_MAX_LIMIT,
      cursor,
    }),
  )) {
    members.push(...page.members);
    groups.push(...(page.groups ?? []));
  }
  const peopleUrl = members[0]?.url ?? host.viewer().url;
  return mapMembers({ members, groups }, peopleUrl);
}

export function mapMember(member: ArtifactMemberDto): User {
  return {
    kind: "user",
    id: member.id,
    name: member.displayName,
    url: member.url,
    image: member.avatarUrl,
  };
}

/** Teams list only the members the workspace still knows. */
function mapMembers(wire: ArtifactMembersResult, peopleUrl: string): Members {
  const users = wire.members.map(mapMember);
  const usersById = new Map(users.map((user) => [user.id, user]));

  const teams = (wire.groups ?? []).map(
    (group): Team => ({
      kind: "team",
      id: group.id,
      name: group.name,
      url: peopleUrl,
      members: group.memberIds.flatMap((id) => {
        const user = usersById.get(id);
        return user ? [user] : [];
      }),
    }),
  );

  return {
    users: fromHost(z.array(UserSchema), users, "users"),
    teams: fromHost(z.array(TeamSchema), teams, "teams"),
  };
}

/** The user a task or comment names: the workspace member when known, else the user as the wire names them. */
export async function userOf(s: Session, wire: ArtifactUserRef): Promise<User> {
  return (
    (await s.member(wire.id)) ?? {
      kind: "user",
      id: wire.id,
      name: wire.username,
      url: wire.url,
      image: wire.profilePicture,
    }
  );
}

export function usersOf(
  s: Session,
  wire: readonly ArtifactUserRef[],
): Promise<User[]> {
  return Promise.all(wire.map((ref) => userOf(s, ref)));
}

/** The team a task names: the workspace team when known, else the team as the wire names it. */
async function teamOf(
  s: Session,
  wire: ArtifactGroupDto,
): Promise<Ref<"team">> {
  return (
    (await s.team(wire.id)) ?? {
      kind: "team",
      id: wire.id,
      name: wire.name,
      url: "",
    }
  );
}

export function teamsOf(
  s: Session,
  wire: readonly ArtifactGroupDto[],
): Promise<Ref<"team">[]> {
  return Promise.all(wire.map((group) => teamOf(s, group)));
}

export async function readUsers(s: Session): Promise<User[]> {
  return (await s.members()).users;
}

export async function getUsers(s: Session, ids: string[]): Promise<User[]> {
  return byIds((await s.members()).users, ids);
}

export async function readTeams(s: Session): Promise<Team[]> {
  return (await s.members()).teams;
}

export async function getTeams(s: Session, ids: string[]): Promise<Team[]> {
  return byIds((await s.members()).teams, ids);
}
