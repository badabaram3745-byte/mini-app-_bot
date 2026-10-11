import type { Awareness } from "y-protocols/awareness";
import type { Room } from "../room";
import type { User } from "../user";
import type { BroadcastListener, WireEvent } from "./broadcasts";
import { Broadcasts } from "./broadcasts";
import { deepEqual, deepFreeze, isPlainObject, jsonObject } from "./fields";
import type { Collaborator, JsonObject, JsonValue } from "./shared";

const EMPTY: JsonObject = Object.freeze({});
const NO_COLLABORATORS: readonly Collaborator[] = Object.freeze([]);
const FRAME_MS = 16;

interface WireState {
  user?: unknown;
  presence?: unknown;
  clock?: number;
  events?: WireEvent[];
}

export type PresenceUpdate = JsonObject | ((current: JsonObject) => JsonObject);

export interface Me extends Collaborator {
  setPresence(update: PresenceUpdate): void;
}

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

interface Rank {
  clock: number;
  clientId: number;
}

/**
 * Presence and broadcasts over the room's awareness, whose wire state is
 * `{ user, presence, clock, events }`; states collapse by `user.id`, greatest
 * clock then greatest client id, so one person's tabs show as one entry on
 * every page. Both directions run at most once per frame, while `me.presence`
 * applies at once and a landing state's broadcasts are delivered at once.
 */
export class PresenceStore {
  me: Me;
  collaborators: readonly Collaborator[] = NO_COLLABORATORS;
  private awareness: Awareness | undefined;
  private detach: (() => void) | undefined;
  /** Each shown client's collaborator with the wire state it was built from. */
  private entries = new Map<
    number,
    { wire: WireState; collaborator: Collaborator }
  >();
  private readonly broadcasts = new Broadcasts();
  /** The clock I published last. */
  private clock = 0;
  private readonly publish = perFrame(() => this.publishNow());
  private readonly recompute = perFrame(() => this.recomputeNow());

  constructor(
    viewer: User,
    private readonly onChange: () => void,
  ) {
    this.me = Object.freeze({
      user: viewer,
      presence: EMPTY,
      setPresence: this.setPresence,
    });
    window.addEventListener("pagehide", () => {
      this.publish.cancel();
      this.awareness?.setLocalState(null);
    });
  }

  bind(room: Room | undefined): void {
    this.detach?.();
    this.detach = undefined;
    this.publish.cancel();
    this.recompute.cancel();
    this.broadcasts.reset();
    this.awareness = room?.awareness;
    const awareness = this.awareness;
    if (!awareness) {
      this.setCollaborators(NO_COLLABORATORS);
      return;
    }
    for (const [clientId, wire] of wires(awareness)) {
      this.broadcasts.arrived(clientId, wire.events);
    }
    const onOthers = (change: AwarenessChange, origin: unknown) => {
      if (origin !== "local") {
        this.recompute();
        this.deliver(change, awareness);
      }
    };
    awareness.on("change", onOthers);
    this.detach = () => awareness.off("change", onOthers);
    if (Object.keys(this.me.presence).length > 0) {
      this.publish();
    }
    this.recompute();
  }

  /** Sends `name` with `payload` to everyone else in the room, with the next publish. */
  broadcast(name: string, payload?: JsonValue): void {
    this.broadcasts.queue(name, payload);
    this.publish();
  }

  onBroadcast(name: string, listener: BroadcastListener): () => void {
    return this.broadcasts.on(name, listener);
  }

  /** Hands the broadcasts of each landed state to their listeners, as the states came. */
  private deliver(
    { added, updated, removed }: AwarenessChange,
    awareness: Awareness,
  ) {
    const states = wires(awareness);
    for (const clientId of added) {
      this.broadcasts.arrived(clientId, states.get(clientId)?.events);
    }
    for (const clientId of updated) {
      const wire = states.get(clientId);
      const id = userId(wire?.user);
      if (wire?.events && id !== undefined) {
        this.broadcasts.deliver(clientId, wire.events, userOf(wire.user, id));
      }
    }
    for (const clientId of removed) {
      this.broadcasts.forget(clientId);
    }
  }

  private readonly setPresence = (update: PresenceUpdate): void => {
    const next = jsonObject(
      typeof update === "function" ? update(this.me.presence) : update,
      "Presence",
    );
    if (deepEqual(this.me.presence, next)) {
      return;
    }
    this.me = Object.freeze({
      ...this.me,
      presence: deepFreeze(next) as JsonObject,
    });
    this.publish();
    this.onChange();
  };

  /** Publishes my presence and the broadcasts since the last publish, with a clock above every state of this person; without a room the broadcasts are dropped. */
  private publishNow() {
    const events = this.broadcasts.drain();
    const awareness = this.awareness;
    if (!awareness) {
      return;
    }
    const local = (awareness.getLocalState() ?? {}) as WireState;
    const user = local.user ?? this.me.user;
    const myId = myUserId(user, awareness.clientID);
    let clock = this.clock;
    for (const wire of wires(awareness).values()) {
      if (userId(wire.user) === myId) {
        clock = Math.max(clock, wire.clock ?? 0);
      }
    }
    this.clock = clock + 1;
    awareness.setLocalState({
      ...local,
      user,
      presence: this.me.presence,
      clock: this.clock,
      events,
    });
  }

  private recomputeNow() {
    const awareness = this.awareness;
    if (!awareness) {
      return;
    }
    const local = (awareness.getLocalState() ?? {}) as WireState;
    const myId = myUserId(local.user ?? this.me.user, awareness.clientID);
    const best = new Map<
      string,
      { clock: number; clientId: number; wire: WireState }
    >();
    for (const [clientId, wire] of wires(awareness)) {
      const id = userId(wire.user);
      if (id === undefined || id === myId) {
        continue;
      }
      const clock = wire.clock ?? 0;
      const current = best.get(id);
      if (!current || outranks({ clock, clientId }, current)) {
        best.set(id, { clock, clientId, wire });
      }
    }
    const entries = new Map<
      number,
      { wire: WireState; collaborator: Collaborator }
    >();
    const collaborators = [...best]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, { clientId, wire }]) => {
        const kept = this.entries.get(clientId);
        const collaborator =
          kept?.wire === wire
            ? kept.collaborator
            : deepFreeze({
                user: userOf(wire.user, id),
                presence: isPlainObject(wire.presence)
                  ? (wire.presence as JsonObject)
                  : EMPTY,
              });
        entries.set(clientId, { wire, collaborator });
        return collaborator;
      });
    this.entries = entries;
    this.setCollaborators(Object.freeze(collaborators));
  }

  private setCollaborators(collaborators: readonly Collaborator[]) {
    if (!deepEqual(this.collaborators, collaborators)) {
      this.collaborators = collaborators;
      this.onChange();
    }
  }
}

interface Throttled {
  (): void;
  cancel(): void;
}

/** Runs `run` at most once per frame: at the end of the current job when none ran this frame, else once at the frame's end. */
function perFrame(run: () => void): Throttled {
  let frame: ReturnType<typeof setTimeout> | undefined;
  let queued = false;
  let again = false;
  const flush = () => {
    if (!queued) {
      return;
    }
    queued = false;
    run();
    frame = setTimeout(() => {
      frame = undefined;
      if (again) {
        again = false;
        call();
      }
    }, FRAME_MS);
  };
  const call = () => {
    if (frame !== undefined) {
      again = true;
    } else if (!queued) {
      queued = true;
      queueMicrotask(flush);
    }
  };
  return Object.assign(call, {
    cancel() {
      clearTimeout(frame);
      frame = undefined;
      queued = false;
      again = false;
    },
  });
}

/** Whether state `a` is shown for a person over `b`. */
function outranks(a: Rank, b: Rank): boolean {
  return a.clock > b.clock || (a.clock === b.clock && a.clientId > b.clientId);
}

/** The room's states by client, as the kit reads them; awareness holds no null state. */
function wires(awareness: Awareness): Map<number, WireState> {
  return awareness.getStates() as Map<number, WireState>;
}

/** The id a wire state's user carries, or undefined when it names nobody. */
function userId(user: unknown): string | undefined {
  const id = isPlainObject(user) ? user.id : undefined;
  return id == null || id === "" ? undefined : String(id);
}

/** My id: the user's, or one of my client's when the host names nobody. */
function myUserId(user: unknown, clientId: number): string {
  return userId(user) ?? `client:${clientId}`;
}

function userOf(user: unknown, id: string): User {
  const seeded = isPlainObject(user) ? user : {};
  const name = seeded.name ?? seeded.displayName;
  const image = seeded.image ?? seeded.avatarUrl;
  return {
    kind: "user",
    id,
    name: typeof name === "string" ? name : "",
    url: typeof seeded.url === "string" ? seeded.url : "",
    ...(typeof image === "string" && image ? { image } : {}),
  };
}
