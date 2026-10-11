import type { JsonObject } from "../shared/shared";
import { shared } from "../shared/shared";

/** Where a pointer is, as `<Cursors>` sends it in `presence.cursor` and `cursor:move`: fractions of its region or, with `anchor`, of that element's box, the region it is in and the sender's clock in ms. Over a surface seen through a camera, `space: "page"` and that surface's own units instead. */
export type CursorPoint = JsonObject & {
  x: number;
  y: number;
  t?: number;
  region?: string;
  space?: "page";
  /** `#id` of the nearest ancestor with a token id, or `""` for the region itself, then `tag:n` steps down to the element. */
  anchor?: string[];
  dx?: number;
  dy?: number;
};

/** One of the six emoji, sent from where the pointer was. */
export type Emote = CursorPoint & { emoji: string };

/** The point two hands meet at, and whose hand the sender's meets. */
export type HighFive = CursorPoint & { with: string };

/** The sender's wave starting or ending, in the region it started in. */
export interface Wave {
  region?: string;
  on: boolean;
}

/** Text someone selected inside a `<Cursors>` area, as `presence.selection`: the path of each end from that area (child indices, then the offset in the last node) and a hash of the text, so it is drawn only over the same text. */
export type TextSelection = JsonObject & {
  from: number[];
  to: number[];
  hash: string;
  region?: string;
};

/** What an `id` must look like to travel: generated ids pass, names and titles do not. */
export const TOKEN = /^[\w-]{1,64}$/;
export const MAX_STEPS = 24;
/** One `tag:n` step of an anchor, and nothing a selector could trip on. */
const STEP = /^[A-Za-z][\w-]{0,63}:\d{1,6}$/;

export function fraction(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** The region key a point or a wave carries, when it has one. */
export function regionOf(region: string | undefined): JsonObject {
  return region === undefined ? {} : { region };
}

/** The units a `<Cursors>` reads and writes: its region's fractions, or with a `space`, the surface's own units tagged `"page"`. */
export type Units = "page" | undefined;

/** `value` when it is a cursor point in `region` and `units` as `<Cursors>` sends one; an anchor this page cannot walk is left out. */
export function pointOf(
  value: unknown,
  region: string | undefined,
  units: Units = undefined,
): CursorPoint | undefined {
  const point = value as CursorPoint | null;
  if (
    !point ||
    typeof point !== "object" ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.region !== region ||
    point.space !== units
  ) {
    return undefined;
  }
  if (
    isAnchor(point.anchor) &&
    typeof point.dx === "number" &&
    typeof point.dy === "number"
  ) {
    return point;
  }
  const { anchor, dx, dy, ...fractions } = point;
  return fractions as CursorPoint;
}

/** `payload` when it is a `cursor:emote` in `region` and `units`. */
export function emoteOf(
  payload: unknown,
  region: string | undefined,
  units: Units,
): Emote | undefined {
  const point = pointOf(payload, region, units);
  return typeof point?.emoji === "string" ? (point as Emote) : undefined;
}

/** `payload` when it is a `cursor:high-five` in `region` and `units`. */
export function highFiveOf(
  payload: unknown,
  region: string | undefined,
  units: Units,
): HighFive | undefined {
  const point = pointOf(payload, region, units);
  return typeof point?.with === "string" ? (point as HighFive) : undefined;
}

/** `payload` when it is a `cursor:wave` in `region`. */
export function waveOf(
  payload: unknown,
  region: string | undefined,
): Wave | undefined {
  const wave = payload as Wave | null;
  return wave &&
    typeof wave === "object" &&
    wave.region === region &&
    typeof wave.on === "boolean"
    ? wave
    : undefined;
}

/** The presence's cursor while it is in `region` and `units`. */
export function cursorOf(
  presence: JsonObject,
  region: string | undefined,
  units: Units = undefined,
): CursorPoint | undefined {
  return pointOf(presence.cursor, region, units);
}

/** The presence's chat message while they are typing one. */
export function messageOf(presence: JsonObject): string | undefined {
  const message = presence.message;
  return typeof message === "string" && message !== "" ? message : undefined;
}

/** The presence's selection when it has the shape `<Cursors>` writes and is in `region`. */
export function selectionOf(
  presence: JsonObject,
  region: string | undefined,
): TextSelection | undefined {
  const selection = presence.selection as TextSelection | null | undefined;
  return typeof selection === "object" &&
    selection !== null &&
    isPath(selection.from) &&
    isPath(selection.to) &&
    typeof selection.hash === "string" &&
    selection.region === region
    ? selection
    : undefined;
}

/** My three presence keys as I have them now; every publish sends all three and leaves the rest of my presence alone. */
const mine: {
  cursor?: CursorPoint;
  message?: string;
  selection?: TextSelection;
} = {};

/** Notes where my pointer is without publishing it; the next publish carries it. */
export function moved(cursor: CursorPoint): void {
  mine.cursor = cursor;
}

/** Sets the given keys of mine, `undefined` taking one away, and publishes all of them. */
export function publish(update: Partial<typeof mine> = {}): void {
  Object.assign(mine, update);
  shared.me.setPresence(({ cursor, message, selection, ...rest }) => ({
    ...rest,
    ...(mine.cursor && { cursor: mine.cursor }),
    ...(mine.message && { message: mine.message }),
    ...(mine.selection && { selection: mine.selection }),
  }));
}

/** Whether an anchor another page sent has the shape and size this page will walk. */
function isAnchor(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STEPS) {
    return false;
  }
  const [root, ...steps] = value as unknown[];
  return (
    (root === "" ||
      (typeof root === "string" &&
        root.startsWith("#") &&
        TOKEN.test(root.slice(1)))) &&
    steps.every((step) => typeof step === "string" && STEP.test(step))
  );
}

function isPath(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((index) => Number.isInteger(index) && index >= 0)
  );
}
