import type { IsoDate } from "../core";

const UNIX_EPOCH: IsoDate = new Date(0).toISOString();

/** Wire dates are epoch-milliseconds strings or ISO strings; both become ISO. */
export function toIso(
  value: string | number | null | undefined,
): IsoDate | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function toIsoOrEpoch(
  value: string | number | null | undefined,
): IsoDate {
  return toIso(value) ?? UNIX_EPOCH;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** ISO to epoch milliseconds; a date-only value is noon of that day in the viewer's timezone. */
export function toEpochMs(iso: IsoDate): number {
  const ms = new Date(DATE_ONLY.test(iso) ? `${iso}T12:00:00` : iso).getTime();
  if (Number.isNaN(ms)) {
    throw new RangeError(`Not an ISO 8601 date: ${iso}`);
  }
  return ms;
}

/** ISO to the minute-aligned epoch-milliseconds string the action verbs take. */
export function toEpochMinuteString(iso: IsoDate): string {
  const ms = toEpochMs(iso);
  return String(ms - (ms % 60_000));
}
