import { useEffect, useRef, useState } from "react";

/** How long a cursor stays after its last move before it fades; the same as a board's `collaboratorInactiveTimeoutMs`. */
export const IDLE_MS = 30_000;
/** A small pull-back before a move. */
export const ANTICIPATE_MS = 120;
/** How long anything takes to leave. */
const EXIT_MS = 200;
/** How long a hand stays after the clap, and how long a wave outlives its last turn. */
export const HOLD_MS = 600;
export const EMOTE_MS = 1_400;
export const CLAP_MS = 1_400;
/** How long a cursor, a message or my chat input stays to pop out. */
export const LINGER_MS = 150;

const REDUCED_MOTION =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-reduced-motion: reduce)")
    : undefined;

/** Whether the viewer asked for reduced motion. */
export function reduced(): boolean {
  return REDUCED_MOTION?.matches === true;
}

export const POP_IN =
  "animate-in fade-in duration-150 ease-out motion-reduce:animate-none";
export const POP_OUT =
  "animate-out fade-out fill-mode-forwards duration-200 ease-out motion-reduce:animate-none";
/** Where the name and message hang from the arrow's tip, and their size. */
export const BESIDE_ARROW =
  "absolute left-[1em] top-[1.5em] w-max max-w-[16em] text-[0.75em]";
/** The bubble the name, the message and my chat input share. */
export const BUBBLE =
  "rounded-[1em] rounded-tl-[0.3em] px-[0.6em] py-[0.3em] leading-snug shadow-md";
/** The neutral pill the key legend and the hint share. */
export const PILL =
  "rounded-full bg-white text-neutral-800 shadow-lg shadow-black/10 ring-1 ring-black/[0.08] dark:bg-neutral-800 dark:text-neutral-100 dark:shadow-black/40 dark:ring-white/10";
export const KEY =
  "rounded-[0.3em] bg-black/[0.08] px-[0.4em] font-mono font-medium dark:bg-white/15";
/** `BUBBLE` as CSS values, for a name pill drawn without these classes; `tail` is the corner nearest what the pill hangs from, `alpha` the opacity a text selection is painted at. */
export const LABEL = {
  fontSize: "0.75rem",
  padding: "0.3em 0.6em",
  radius: "1em",
  tail: "0.3em",
  alpha: "4d",
};

export interface Ease {
  duration: number;
  easing: string;
}

/** Arrives with a small overshoot. */
export const SNAP: Ease = { duration: 320, easing: spring(0.62) };
/** Arrives almost without overshoot. */
export const SETTLE: Ease = { duration: 420, easing: spring(0.8) };
/** Arrives with a visible bounce. */
export const BOUNCE: Ease = { duration: 560, easing: spring(0.45) };
export const FADE: Ease = { duration: EXIT_MS, easing: "ease-out" };

/** A damped spring from 0 to 1 as a CSS `linear()` easing, settled within 2 % at the end of the duration; `zeta` under 1 overshoots. */
export function spring(zeta: number): string {
  const samples = 40;
  const points: string[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const value = index === samples ? 1 : springAt(zeta, index / samples);
    points.push(value.toFixed(4));
  }
  return `linear(${points.join(", ")})`;
}

/** The position of a spring of `zeta` at `t` of its settle time, 0 to 1. */
export function springAt(zeta: number, t: number): number {
  const omega = -Math.log(0.02) / zeta;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return (
    1 -
    Math.exp(-zeta * omega * t) *
      (Math.cos(damped * t) +
        (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(damped * t))
  );
}

/** Plays `keyframes` on the element and keeps the final state; under reduced motion it plays `still` instead, by default the final pose with only the opacity fading over 150 ms. */
export function play(
  element: Element,
  keyframes: Keyframe[],
  ease: Ease & { delay?: number },
  still = calm(keyframes, ease.duration),
): Animation {
  return element.animate(reduced() ? still : keyframes, {
    fill: "both",
    ...ease,
  });
}

function calm(keyframes: Keyframe[], duration: number): Keyframe[] {
  const {
    offset: _offset,
    easing: _easing,
    ...pose
  } = keyframes[keyframes.length - 1]!;
  const from = { ...pose, opacity: keyframes[0]!.opacity ?? pose.opacity };
  return [
    { ...from, offset: 0 },
    { ...pose, offset: Math.min(1, 150 / duration) },
    { ...pose, offset: 1 },
  ];
}

/** `value` while it is set, then the last one for `LINGER_MS` more as `leaving`. */
export function useLinger<T>(value: T | undefined): {
  value: T | undefined;
  leaving: boolean;
} {
  const last = useRef(value);
  const [gone, setGone] = useState(value === undefined);
  useEffect(() => {
    if (value !== undefined) {
      last.current = value;
      setGone(false);
      return;
    }
    const timer = setTimeout(() => setGone(true), LINGER_MS);
    return () => clearTimeout(timer);
  }, [value]);
  if (value !== undefined) {
    return { value, leaving: false };
  }
  return { value: gone ? undefined : last.current, leaving: !gone };
}

export function cx(
  ...parts: ReadonlyArray<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
