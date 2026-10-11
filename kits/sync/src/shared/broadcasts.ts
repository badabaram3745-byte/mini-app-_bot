import type { User } from "../user";
import { deepFreeze, isPlainObject, jsonValue } from "./fields";
import type { JsonValue } from "./shared";

/** One broadcast on the wire, numbered per tab. */
export interface WireEvent {
  seq: number;
  name: string;
  payload: JsonValue;
}

export type BroadcastListener = (payload: JsonValue, from: User) => void;

/**
 * Ephemeral events: each `broadcast()` is one entry in the `events` the next
 * presence publish carries. A receiver delivers each entry newer than the
 * last it saw of that client; what a client already carried when first seen
 * is never delivered.
 */
export class Broadcasts {
  private seq = 0;
  private pending: WireEvent[] = [];
  /** The newest sequence had from each client of the room. */
  private readonly seen = new Map<number, number>();
  private readonly listeners = new Map<string, Set<BroadcastListener>>();

  /** Validates a broadcast and queues it for the next publish. */
  queue(name: string, payload: JsonValue | undefined): void {
    if (typeof name !== "string" || name === "") {
      throw new Error(
        'broadcast() expects a name, a non-empty string like "buzz".',
      );
    }
    this.pending.push({
      seq: (this.seq += 1),
      name,
      payload: jsonValue(payload ?? null, "payload") as JsonValue,
    });
  }

  /** The queued broadcasts for the publish, or undefined when there are none. */
  drain(): WireEvent[] | undefined {
    if (this.pending.length === 0) {
      return undefined;
    }
    const events = this.pending;
    this.pending = [];
    return events;
  }

  /** Forgets every client, for a new room. */
  reset(): void {
    this.seen.clear();
  }

  /** Notes a client first seen; whatever it carries came before. */
  arrived(clientId: number, events: unknown): void {
    const carried = eventsOf(events);
    this.seen.set(clientId, carried[carried.length - 1]?.seq ?? 0);
  }

  /** Delivers the client's events newer than the last had, in order, to the listeners of their names. */
  deliver(clientId: number, events: unknown, from: User): void {
    for (const event of eventsOf(events)) {
      if (event.seq > (this.seen.get(clientId) ?? 0)) {
        this.seen.set(clientId, event.seq);
        const payload = deepFreeze(event.payload);
        this.listeners
          .get(event.name)
          ?.forEach((listener) => listener(payload, from));
      }
    }
  }

  forget(clientId: number): void {
    this.seen.delete(clientId);
  }

  on(name: string, listener: BroadcastListener): () => void {
    const listeners = this.listeners.get(name) ?? new Set<BroadcastListener>();
    listeners.add(listener);
    this.listeners.set(name, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(name);
      }
    };
  }
}

/** The well-formed events of a wire state's `events`. */
function eventsOf(events: unknown): WireEvent[] {
  return Array.isArray(events) ? events.filter(isWireEvent) : [];
}

function isWireEvent(value: unknown): value is WireEvent {
  return (
    isPlainObject(value) &&
    typeof value.seq === "number" &&
    typeof value.name === "string"
  );
}
