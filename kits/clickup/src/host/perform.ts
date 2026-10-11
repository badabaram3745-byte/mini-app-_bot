import type { Ref } from "../core";
import { LiveError } from "../core";
import type { LiveBridge } from "./bridge";
import { actionError } from "./errors";
import type { UserActionOutcome } from "./wire";

/** One host action: its type and the string parameters the host takes. */
export type WireCall = [actionType: string, params: Record<string, string>];

/** Runs one action through the user's approval; anything but `executed` throws. */
export async function perform(
  host: LiveBridge,
  actionType: string,
  params: Record<string, string>,
): Promise<UserActionOutcome> {
  const outcome = await host.requestUserAction(actionType, params);
  if (outcome.status !== "executed") {
    throw actionError(actionType, outcome);
  }
  return outcome;
}

export async function performAll(
  host: LiveBridge,
  calls: WireCall[],
): Promise<void> {
  for (const [actionType, params] of calls) {
    await perform(host, actionType, params);
  }
}

/** The ref of what a create action made; `name` is what the caller asked for unless the host says otherwise. */
export function createdRef<K extends Ref["kind"]>(
  kind: K,
  outcome: UserActionOutcome,
  name: string,
): Ref<K> {
  const { id, url, name: reported } = outcome.result ?? {};
  if (!id || url === undefined) {
    throw new LiveError(
      "failed",
      `The host did not report the ${kind} it created.`,
    );
  }
  return { kind, id, name: reported ?? name, url };
}
