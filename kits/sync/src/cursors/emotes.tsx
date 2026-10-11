import type { CSSProperties, ReactElement } from "react";
import { useEffect, useRef } from "react";
import type { Ease } from "./tokens";
import {
  BESIDE_ARROW,
  BOUNCE,
  cx,
  EMOTE_MS,
  KEY,
  PILL,
  POP_OUT,
  reduced,
  SETTLE,
  springAt,
} from "./tokens";

export const EMOJI = ["👍", "❤️", "🎉", "😂", "👀", "🙌"];

/** How far an emote rises, in em of the cursor, and the arcs a burst cycles through, in em to the side. */
const RISE_EM = 9;
const ARCS = [1.2, -2.2, 2.8, -1.2, 2.2, -2.8];
/** Emotes closer together than this are one burst. */
const BURST_GAP_MS = 1_500;

/** Hands out the arc of each emote I send: the next of a burst turns the other way. */
export class Stream {
  private t = 0;
  private index = 0;

  next(now: number): number {
    this.index = now - this.t < BURST_GAP_MS ? this.index + 1 : 0;
    this.t = now;
    return this.index % ARCS.length;
  }
}

/** The legend of emote keys beside the tip, the six emoji over the digit that sends each; a picture only, the pointer goes through it. */
export function Legend({ leaving }: { leaving: boolean }): ReactElement {
  return (
    <ul
      aria-label="Emote keys"
      className={cx(
        BESIDE_ARROW,
        PILL,
        "flex origin-[-1em_-1.5em] gap-[0.1em] p-[0.25em]",
        leaving
          ? cx(POP_OUT, "zoom-out-95")
          : "animate-in fade-in zoom-in-90 fill-mode-both motion-reduce:animate-none",
      )}
      role="list"
      style={leaving ? undefined : timing(BOUNCE)}
    >
      {EMOJI.map((emoji, index) => (
        <li
          className="flex flex-col items-center px-[0.4em] pb-[0.25em] pt-[0.3em] animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards motion-reduce:animate-none"
          key={emoji}
          style={timing(SETTLE, 40 + index * 18)}
        >
          <span className="text-[1.35em] leading-none">{emoji}</span>
          <kbd className={cx(KEY, "mt-[0.3em] text-[0.65em] leading-tight")}>
            {index + 1}
          </kbd>
        </li>
      ))}
    </ul>
  );
}

/** One emoji born centred on the parent's origin, rising on arc `turn` and fading; `onEnd` when it is gone. */
export function Emoji({
  emoji,
  onEnd,
  turn,
}: {
  emoji: string;
  onEnd: () => void;
  turn: number;
}): ReactElement {
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const flight = element.current!.animate(
      reduced() ? RESTING : arc(ARCS[turn]!),
      { duration: EMOTE_MS, easing: "linear", fill: "both" },
    );
    const timer = setTimeout(onEnd, EMOTE_MS);
    return () => {
      flight.cancel();
      clearTimeout(timer);
    };
  }, [onEnd, turn]);
  return (
    <span
      className="absolute left-0 top-0 block opacity-0 will-change-transform"
      data-emote={emoji}
      ref={element}
    >
      <span className="block text-[2em] leading-none">{emoji}</span>
    </span>
  );
}

/** The flight, sampled: a spring-in, an arc of `side` em to the side while rising, then a fade and a blur. */
function arc(side: number): Keyframe[] {
  const frames: Keyframe[] = [];
  const samples = 28;
  for (let index = 0; index <= samples; index += 1) {
    const u = index / samples;
    const rise = RISE_EM * (1 - (1 - u) ** 3);
    const x = side * Math.sin(Math.PI * u);
    const slope = side * Math.PI * Math.cos(Math.PI * u);
    const climb = RISE_EM * 3 * (1 - u) ** 2 + 0.6;
    const tilt = Math.max(
      -14,
      Math.min(14, ((Math.atan2(slope, climb) * 180) / Math.PI) * 0.5),
    );
    const scale = u < 0.25 ? 0.3 + 0.7 * springAt(0.45, u / 0.25) : 1;
    const fading = Math.max(0, (u - 0.55) / 0.45);
    const blur = Math.max(0, (u - 0.7) / 0.3) * 1.5;
    frames.push({
      transform: `translate(-50%, -50%) translate(${x.toFixed(3)}em, ${(-rise).toFixed(3)}em) rotate(${tilt.toFixed(1)}deg) scale(${scale.toFixed(3)})`,
      opacity: 1 - fading * fading,
      filter: `blur(${blur.toFixed(2)}px)`,
      offset: u,
    });
  }
  return frames;
}

/** The reduced-motion flight: a fade in, a hold and a fade out in place. */
const RESTING: Keyframe[] = [0, 1, 1, 0].map((opacity, index) => ({
  transform: "translate(-50%, -50%) translate(0, -4em)",
  opacity,
  offset: [0, 0.1, 0.7, 1][index],
}));

/** How an `animate-in` class runs: `ease`'s duration and spring, after `delay` ms. */
function timing(ease: Ease, delay = 0): CSSProperties {
  return {
    animationDelay: `${delay}ms`,
    animationDuration: `${ease.duration}ms`,
    animationTimingFunction: ease.easing,
  };
}
