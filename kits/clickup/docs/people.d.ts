import type { Ref, UseQueryOptions, UseQueryResult } from "./core";

/** A workspace member; `image` is the avatar. */
export type User = Ref<"user">;
export interface Team extends Ref<"team"> {
    members: Array<Ref<"user">>;
}
export interface UsersApi {
    list(): Promise<User[]>;
    get(targets: Array<Ref<"user"> | string>): Promise<User[]>;
}
export interface TeamsApi {
    list(): Promise<Team[]>;
    get(targets: Array<Ref<"team"> | string>): Promise<Team[]>;
}
/** Every member, or exactly the given ones. */
export declare function useUsers(targets?: Array<Ref<"user"> | string>, options?: UseQueryOptions<User[]>): UseQueryResult<User[]>;
/** Every team, or exactly the given ones. */
export declare function useTeams(targets?: Array<Ref<"team"> | string>, options?: UseQueryOptions<Team[]>): UseQueryResult<Team[]>;
