import type { ArtifactMemberDto } from "@time-loop/artifacts-protocol";
import type { User } from "./user";

const NOBODY: User = Object.freeze({ kind: "user", id: "", name: "", url: "" });

/** The host's viewer as a `User`; nobody on a host that cannot name them. */
export function viewer(): User {
  const host = globalThis as {
    clickup?: { getViewer?(): ArtifactMemberDto };
  };
  const member = host.clickup?.getViewer?.();
  return member
    ? {
        kind: "user",
        id: member.id,
        name: member.displayName,
        url: member.url,
        image: member.avatarUrl,
      }
    : NOBODY;
}
