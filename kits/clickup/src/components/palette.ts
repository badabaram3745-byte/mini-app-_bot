import type { Status } from "../tasks/tasks";
import type { Task } from "../tasks/tasks";

export type Rgb = readonly [number, number, number];

/** A background with a text color that reads on it; `edge` marks fills near white or black. */
export interface Fill {
  background: string;
  text: string;
  edge: boolean;
}

/** The APCA Lc body text needs. */
export const READABLE_LC = 66;

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const INK: Rgb = [17, 24, 39];
const NUDGE_STEPS = 10;
const EDGE_LUMINANCE = { dark: 0.04, light: 0.7 };

/**
 * The fill for a workspace color: white or near-black text, whichever reads
 * better, over the color darkened or lightened just enough for that to hold;
 * `undefined` when the color cannot be parsed.
 */
export function fill(color: string): Fill | undefined {
  const source = parseColor(color);
  if (!source) {
    return undefined;
  }
  const towards = bestText(source) === WHITE ? BLACK : WHITE;
  for (let step = 0; step <= NUDGE_STEPS; step++) {
    const background = mix(source, towards, step / NUDGE_STEPS);
    const text = bestText(background);
    if (Math.abs(apcaContrast(text, background)) >= READABLE_LC) {
      return toFill(background, text);
    }
  }
  return toFill(towards, towards === BLACK ? WHITE : INK);
}

function toFill(background: Rgb, text: Rgb): Fill {
  const luminance = screenLuminance(background);
  return {
    background: toHex(background),
    text: toHex(text),
    edge: luminance > EDGE_LUMINANCE.light || luminance < EDGE_LUMINANCE.dark,
  };
}

function bestText(background: Rgb): Rgb {
  const white = Math.abs(apcaContrast(WHITE, background));
  const ink = Math.abs(apcaContrast(INK, background));
  return white >= ink ? WHITE : INK;
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const channel = (index: 0 | 1 | 2) =>
    Math.round(from[index] + (to[index] - from[index]) * amount);
  return [channel(0), channel(1), channel(2)];
}

const HEX_PATTERN = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_PATTERN =
  /^rgba?\(\s*(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i;

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`; alpha is ignored. */
export function parseColor(value: string): Rgb | undefined {
  const color = value.trim();
  const hex = HEX_PATTERN.exec(color)?.[1];
  if (hex) {
    const digits = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const number = Number.parseInt(digits.slice(0, 6), 16);
    return [(number >> 16) & 0xff, (number >> 8) & 0xff, number & 0xff];
  }
  const rgb = RGB_PATTERN.exec(color);
  if (rgb) {
    const [red, green, blue] = rgb.slice(1, 4).map(Number) as [
      number,
      number,
      number,
    ];
    if (Math.max(red, green, blue) <= 255) {
      return [Math.round(red), Math.round(green), Math.round(blue)];
    }
  }
  return undefined;
}

export function toHex([red, green, blue]: Rgb): string {
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * APCA-W3 0.0.98G-4g lightness contrast: positive for dark-on-light, negative
 * for light-on-dark; |Lc| runs 0 to about 108, higher reads better.
 */
export function apcaContrast(text: Rgb, background: Rgb): number {
  const textY = softClampBlack(screenLuminance(text));
  const backgroundY = softClampBlack(screenLuminance(background));
  if (Math.abs(backgroundY - textY) < 0.0005) {
    return 0;
  }
  if (backgroundY > textY) {
    const sapc = (backgroundY ** 0.56 - textY ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  const sapc = (backgroundY ** 0.65 - textY ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100;
}

function screenLuminance([red, green, blue]: Rgb): number {
  const linear = (channel: number) => (channel / 255) ** 2.4;
  return (
    0.2126729 * linear(red) +
    0.7151522 * linear(green) +
    0.072175 * linear(blue)
  );
}

function softClampBlack(luminance: number): number {
  return luminance > 0.022
    ? luminance
    : luminance + (0.022 - luminance) ** 1.414;
}

/** ClickUp's priority colors; `low` has none and uses the muted text token. */
export const PRIORITY_COLORS: Readonly<
  Record<Exclude<NonNullable<Task["priority"]>, "low">, string>
> = {
  urgent: "#c62a2f",
  high: "#ffc53d",
  normal: "#3e63dd",
};

/** ClickUp's gray, for tags and field options given no color. */
export const DEFAULT_COLOR = "#87909e";

/** ClickUp's default status colors, for statuses whose list gave them none. */
export const STATUS_TYPE_COLORS: Readonly<Record<Status["type"], string>> = {
  open: DEFAULT_COLOR,
  active: "#5f55ee",
  done: "#008844",
  closed: "#656f7d",
};

export const PRIORITY_LABELS: Readonly<
  Record<NonNullable<Task["priority"]>, string>
> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/** ClickUp's avatar color picker; `avatarColor` picks one by id. */
export const AVATAR_COLORS: readonly string[] = [
  "#6647f0",
  "#3e63dd",
  "#0091ff",
  "#12a594",
  "#248f7d",
  "#ffc53d",
  "#f76808",
  "#e5484d",
  "#e93d82",
  "#ab4aba",
  "#a18072",
];

export function avatarColor(id: string): string {
  let hash = 5381;
  for (const char of id) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

/** The first letter of the first two words; `?` for an empty name. */
export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase());
  return letters.join("") || "?";
}

export function cx(
  ...parts: ReadonlyArray<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
