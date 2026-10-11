import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { warnOnce } from "./shared/warn";

/** The host's connection to the collaboration server. */
export type RoomConnection = "connected" | "connecting" | "disconnected";

export interface RoomStatus {
  connected: boolean;
  synced: boolean;
  upstream?: RoomConnection;
  readOnly: boolean;
}

export type RoomEvent = "status" | "synced" | "denied" | "closed";
export type RoomListener = (payload?: unknown) => void;

/**
 * The handle `clickup.collab.open()` resolves with: a `Y.Doc` mirror of one
 * of the artifact's documents, its awareness, the host's Yjs module, the
 * session status and its events. A host may seed the awareness's local state
 * with `user`, which the kit then publishes instead of `clickup.getViewer()`.
 */
export interface Room {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly Y: typeof Y;
  readonly status: RoomStatus;
  on(event: RoomEvent, listener: RoomListener): (() => void) | void;
  off?(event: RoomEvent, listener: RoomListener): void;
  close(): void;
}

export interface CollabApi {
  open(document?: string): Promise<{ data?: Room; error?: unknown }>;
}

/** `unavailable` on a host without collaboration, for the page's life. */
export type SessionState =
  | { kind: "opening" }
  | { kind: "open"; room: Room }
  | { kind: "unavailable" };

const RETRY_MS = 5_000;
const RETRY_AFTER_DENIED_MS = 15_000;
/** The global the sandbox compiler resolves `yjs` imports to. */
const HOST_YJS = "__syncY";

export function hostRoom(): RoomSession {
  const { clickup } = globalThis as { clickup?: { collab?: CollabApi } };
  return new RoomSession(clickup?.collab);
}

/**
 * One room over the page's lifetime, kept open: a failed open is retried
 * every 5 s, a `closed` room reopens at once, a `denied` one after 15 s, and
 * the page coming online retries at once. `ready()` resolves once the first
 * attempt has synced or failed, and stays resolved.
 */
export class RoomSession {
  state: SessionState = { kind: "opening" };
  private readonly listeners = new Set<() => void>();
  private readonly gate = new Gate();
  private detach: (() => void) | undefined;
  private opening = false;
  private retry: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly collab: CollabApi | undefined) {
    window.addEventListener("online", () => void this.open());
    void this.open();
  }

  /** Fires on every state or room status change. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  ready(): Promise<void> {
    return this.gate.promise;
  }

  isReady(): boolean {
    return this.gate.open;
  }

  /** One attempt at a time, and none while a room is open; whatever the host does wrong is a failed attempt. */
  private async open() {
    if (!this.collab) {
      this.unavailable();
      return;
    }
    if (this.opening || this.state.kind !== "opening") {
      return;
    }
    this.opening = true;
    clearTimeout(this.retry);
    try {
      const { data, error } = await this.collab.open();
      const code = (error as { code?: unknown } | null | undefined)?.code;
      if (code === "not-enabled" || code === "not-declared") {
        this.unavailable();
        warnOnce(
          "collab-refused",
          "Live collaboration is unavailable here: shared documents stay empty and presence shows only you.",
        );
        return;
      }
      this.attach(roomOf(data));
    } catch {
      this.gate.release();
      this.retryIn(RETRY_MS);
    } finally {
      this.opening = false;
    }
  }

  /** The host has no collaboration for this page: shared documents stay empty, presence shows only this viewer, and nothing waits or retries. */
  private unavailable() {
    this.state = { kind: "unavailable" };
    this.gate.release();
    this.notify();
  }

  private retryIn(ms: number) {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => void this.open(), ms);
  }

  private attach(room: Room) {
    const synced = () => {
      if (room.status.synced) {
        this.gate.release();
      }
      this.notify();
    };
    const offs = [
      listen(room, "status", synced),
      listen(room, "synced", synced),
      listen(room, "denied", () => this.lose(room, RETRY_AFTER_DENIED_MS)),
      listen(room, "closed", () => this.lose(room, 0)),
    ];
    this.detach = () => offs.forEach((off) => off());
    this.state = { kind: "open", room };
    (globalThis as Record<string, unknown>)[HOST_YJS] = room.Y;
    synced();
  }

  /** Drops the room and opens again after `wait`; a room already dropped is ignored. */
  private lose(room: Room, wait: number) {
    if (this.state.kind !== "open" || this.state.room !== room) {
      return;
    }
    this.detach?.();
    this.detach = undefined;
    this.state = { kind: "opening" };
    this.gate.release();
    safeClose(room);
    this.notify();
    if (wait === 0) {
      void this.open();
    } else {
      this.retryIn(wait);
    }
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }
}

const ROOM_FIELDS = ["doc", "awareness", "Y", "status", "on", "close"] as const;

/** The room the host handed over, if it has everything the kit relies on. */
function roomOf(data: unknown): Room {
  const room = data as Record<string, unknown> | null | undefined;
  if (!room || ROOM_FIELDS.some((field) => room[field] == null)) {
    throw new Error("The host handed over no usable room.");
  }
  return room as unknown as Room;
}

/** A promise that hooks suspend on until the room is usable. */
class Gate {
  open = false;
  readonly promise: Promise<void>;
  private resolve!: () => void;

  constructor() {
    this.promise = new Promise<void>((resolve) => {
      this.resolve = resolve;
    });
  }

  release() {
    this.open = true;
    this.resolve();
  }
}

function listen(room: Room, event: RoomEvent, listener: RoomListener) {
  const off = room.on(event, listener);
  return () => {
    if (typeof off === "function") {
      off();
    } else {
      room.off?.(event, listener);
    }
  };
}

function safeClose(room: Room) {
  try {
    room.close();
  } catch {
    // A closed room may refuse a second close.
  }
}
