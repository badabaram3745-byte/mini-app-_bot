import type { ReactElement, RefObject } from "react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Point } from "./motion";
import type { Ease } from "./tokens";
import {
  ANTICIPATE_MS,
  BOUNCE,
  CLAP_MS,
  FADE,
  play,
  reduced,
  SNAP,
  spring,
} from "./tokens";

/** Where each hand's wrist sits at contact, either side of the meeting point, and where it recoils to, in px. */
const TOUCH_PX = 18;
const RECOIL_PX = 30;
/** Microsoft's Fluent Emoji Flat "Raised hand" (MIT), mirrored and fitted to a 100 × 120 box with the wrist at the bottom centre. */
const HAND =
  "M80.1 25.9C74.7 25.9 73.1 28.9 73.1 28.9L72.7 21.3C72.4 17.3 67.8 13.4 63.4 13.4C57.5 13.4 55.2 17.7 55.2 17.7C55.6 8.6 52.3 4 44.1 4C37.5 4.4 34.8 10.7 35.3 17.7C35.3 17.7 32.5 12.2 24.8 12.9C20.5 13.3 17 17.7 17 25L17.7 56.8C17.7 56.8 12.8 49.7 9.1 47.6C5.5 45.5 -0.6 45.6 -3.6 48.8C-7.1 52.5 -7.8 58.4 -5.2 62C4.2 74.2 13.3 87.8 16.1 93.4C23.5 108.4 34.8 120 50 120C68.4 120 85.4 106.5 87.4 81.9C89.4 57.3 89.7 37.2 89.7 37.2C90 32.9 86.6 25.9 80.1 25.9Z";
/** Fluent's three finger creases. */
const CREASES =
  "M51.4 14.4L49.2 46.6C49.1 47.7 50 48.7 51.1 48.8C52.3 48.8 53.2 48 53.3 46.8L55.3 17.5C55.2 17.6 55.2 17.7 55.2 17.7C55.6 9.1 52.7 4.5 45.5 4C47.4 4.1 48.9 5 49.9 6.7C51 8.5 51.6 11.2 51.4 14.4ZM35.3 17.7C35.3 17.3 35.2 17 35.2 16.6C35.9 18.6 36.2 20.8 36.3 23L36.8 48.5C36.9 49.6 35.9 50.6 34.8 50.6C33.7 50.6 32.7 49.7 32.7 48.6L32.2 23.2C32.1 20 31.3 17.3 30.1 15.5C29.2 14 27.9 13.1 26.3 12.9C32.9 13 35.3 17.7 35.3 17.7ZM73.1 28.8L72.7 21.3C72.4 17.4 67.9 13.5 63.5 13.4C65.4 13.7 66.7 14.2 67.5 14.9C68.3 15.5 68.9 16.2 69.2 17.2C70 19.1 69.8 21.8 69.5 25L65.9 51.6C65.7 52.8 66.5 53.8 67.7 54C68.8 54.1 69.8 53.3 70 52.2L73.1 28.8Z";
/** A darker shade of the hand's own colour, for its outline and creases. */
const OUTLINE = "color-mix(in oklab, currentColor 72%, black)";

/** An open hand in `color`, its wrist on the parent's origin, and the `Puppet` that animates it as the ref; `arrow` is the arrow the hand stands in for. */
export const HandSlot = forwardRef<
  Puppet,
  { arrow?: RefObject<Element>; color: string }
>(function HandSlot({ arrow = { current: null }, color }, ref): ReactElement {
  const slot = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [puppet] = useState(() => new Puppet(slot, svg, arrow));
  useImperativeHandle(ref, () => puppet, [puppet]);
  useEffect(() => () => puppet.stop(), [puppet]);
  return (
    <div
      className="absolute left-[-1.25em] top-[-3em] h-[3em] w-[2.5em] origin-bottom opacity-0 will-change-transform"
      data-hand=""
      ref={slot}
    >
      <svg
        aria-hidden="true"
        className="h-full w-full origin-bottom drop-shadow"
        overflow="visible"
        ref={svg}
        style={{ color }}
        viewBox="0 0 100 120"
      >
        <path
          d={HAND}
          fill="none"
          stroke="white"
          strokeLinejoin="round"
          strokeWidth="13"
        />
        <path
          d={HAND}
          fill="currentColor"
          strokeLinejoin="round"
          strokeWidth="3"
          style={{ stroke: OUTLINE }}
        />
        <path
          d={CREASES}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          style={{ fill: OUTLINE, stroke: OUTLINE }}
        />
      </svg>
    </div>
  );
});

/** The hand's pose from the pointer's horizontal velocity: it swings with the motion, leans into it and squashes on each turn. */
export class Swing {
  private angle = 0;
  private velocity = 0;
  private lastX: number | undefined;
  private lastT = 0;

  /** A position sample in px at time `t` in ms. */
  push(x: number, t: number): void {
    if (this.lastX !== undefined && t > this.lastT) {
      const velocity = ((x - this.lastX) / (t - this.lastT)) * 1000;
      this.velocity = this.velocity * 0.4 + velocity * 0.6;
    }
    this.lastX = x;
    this.lastT = t;
  }

  /** The transform for this frame; the velocity decays while no sample lands. */
  pose(now: number): string {
    if (now - this.lastT > 48) {
      this.velocity *= 0.8;
    }
    const target = Math.max(-32, Math.min(32, this.velocity * 0.035));
    const previous = this.angle;
    this.angle += (target - this.angle) * 0.28;
    const squash = 1 - Math.min(0.18, Math.abs(this.angle - previous) / 240);
    return `rotate(${this.angle.toFixed(2)}deg) skewX(${(-this.angle * 0.2).toFixed(2)}deg) scale(${squash.toFixed(3)}, ${(1 / squash).toFixed(3)})`;
  }

  reset(): void {
    this.angle = 0;
    this.velocity = 0;
    this.lastX = undefined;
    this.lastT = performance.now();
  }
}

const HIDDEN = "scale(0.3)";
/** A waving hand whose owner sent no motion for this long goes back to an arrow. */
const WAVE_WATCHDOG_MS = 1_500;
/** When the hands meet inside the clap clip. */
export const IMPACT_MS = 440;

type State = "" | "arm" | "wave" | "clap";

/** Drives one cursor's hand and arrow: a small hand beside the tip while a high five is on offer, the hand in place of the arrow while its owner waves, and the high-five clip. */
export class Puppet {
  private readonly swing = new Swing();
  private readonly running = new Map<Element, Animation>();
  private state: State = "";
  /** The side a high five on offer wants the small hand on, kept through a clap. */
  private armed: 1 | -1 | undefined;
  private frame = 0;
  private bob: Animation | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly slot: RefObject<HTMLDivElement>,
    private readonly svg: RefObject<SVGSVGElement>,
    private readonly arrow: RefObject<Element>,
  ) {}

  /** Shows a small hand beside the tip while a high five is on offer, on `side` of it: the side this hand will come in from. */
  arm(on: boolean, side: 1 | -1 = -1): void {
    this.armed = on ? side : undefined;
    const slot = this.slot.current;
    if (!slot || this.state === "clap") {
      return;
    }
    this.bob?.cancel();
    if (on) {
      this.enter(
        {
          transform: `translate(${side * 1.1}em, 0.3em) ${HIDDEN}`,
          opacity: 0,
        },
        {
          transform: `translate(${side * 1.1}em, -0.3em) scale(0.55)`,
          opacity: 0.7,
        },
        BOUNCE,
      );
      if (!reduced()) {
        this.bob = slot.animate(
          [0, -2, 0].map((y) => ({ transform: `translateY(${y}px)` })),
          {
            composite: "add",
            duration: 1_200,
            easing: "ease-in-out",
            iterations: Infinity,
          },
        );
      }
    } else {
      this.run(slot, [{ transform: HIDDEN, opacity: 0 }], FADE);
    }
    this.mark(on ? "arm" : "");
  }

  wave(on: boolean): void {
    const slot = this.slot.current;
    const arrow = this.arrow.current;
    if (!slot || this.state === "clap") {
      return;
    }
    this.still();
    if (on) {
      this.swing.reset();
      this.watchdog = setTimeout(() => this.wave(false), WAVE_WATCHDOG_MS);
      this.enter(
        { transform: "scale(0.4)", opacity: 0 },
        { transform: "scale(1)", opacity: 1 },
        BOUNCE,
      );
      if (arrow) {
        this.run(arrow, [{ transform: "scale(0.7)", opacity: 0 }], {
          duration: 150,
          easing: "ease-out",
        });
      }
      if (!reduced()) {
        this.frame = requestAnimationFrame(this.draw);
      }
    } else {
      this.run(slot, [{ transform: "scale(0.6)", opacity: 0 }], FADE);
      if (arrow) {
        this.run(arrow, [{ transform: "scale(1)", opacity: 1 }], SNAP);
      }
    }
    this.mark(on ? "wave" : "");
  }

  /** A position sample of the hand's owner, in px at time `t`, for the swing; while waving it also keeps the hand from timing out. */
  track(x: number, t: number): void {
    this.swing.push(x, t);
    if (this.state === "wave") {
      clearTimeout(this.watchdog);
      this.watchdog = setTimeout(() => this.wave(false), WAVE_WATCHDOG_MS);
    }
  }

  /** Runs the high-five clip: the hand comes in from `side` of the meeting point `to` (relative to the tip, in px), meets the other, recoils and comes back; resolves when it is back. */
  clap(to: Point, side: 1 | -1): Promise<void> {
    const slot = this.slot.current;
    const arrow = this.arrow.current;
    if (!slot) {
      return Promise.resolve();
    }
    this.still();
    this.mark("clap");
    const mirror = `scaleX(${-side})`;
    const at = (back: number, scale: string) =>
      `translate(${(to.x + side * back).toFixed(1)}px, ${to.y.toFixed(1)}px) ${mirror} ${scale}`;
    const pulled = `translate(${side * 6}px, 0) ${mirror} scale(0.5)`;
    const clip = this.run(
      slot,
      beats([
        [pulled, 0, 0, "ease-out"],
        [pulled, 1, ANTICIPATE_MS, SNAP.easing],
        [at(TOUCH_PX, "scale(1)"), 1, IMPACT_MS, "ease-out"],
        [at(TOUCH_PX - 4, "scale(1.15, 0.85)"), 1, 520, spring(0.45)],
        [at(RECOIL_PX, "scale(1)"), 1, 700, "linear"],
        [at(RECOIL_PX, "scale(1)"), 1, 1_100, SNAP.easing],
        [`${mirror} scale(0.5)`, 0, CLAP_MS],
      ]),
      { duration: CLAP_MS, easing: "linear" },
      hold(`${mirror} scale(1)`, [0, 1, 1, 0]),
    );
    if (arrow) {
      const away = `translate(${side * 6}px, 0) scale(0.85)`;
      this.run(
        arrow,
        beats([
          ["scale(1)", 1, 0, "ease-out"],
          [away, 1, ANTICIPATE_MS, "ease-out"],
          [away, 0, 320, "linear"],
          [away, 0, 1_100, SNAP.easing],
          ["scale(1)", 1, CLAP_MS],
        ]),
        { duration: CLAP_MS, easing: "linear" },
        hold("scale(1)", [1, 0, 0, 1]),
      );
    }
    const settle = () => {
      this.mark("");
      if (this.armed !== undefined) {
        this.arm(true, this.armed);
      }
    };
    return clip.finished.then(settle, () => this.mark(""));
  }

  stop(): void {
    this.still();
    this.running.forEach((animation) => animation.cancel());
  }

  /** Ends the bob, the swing and its watchdog. */
  private still(): void {
    this.bob?.cancel();
    cancelAnimationFrame(this.frame);
    clearTimeout(this.watchdog);
    this.svg.current?.style.removeProperty("transform");
  }

  private readonly draw = (): void => {
    const svg = this.svg.current;
    if (svg) {
      svg.style.transform = this.swing.pose(performance.now());
    }
    this.frame = requestAnimationFrame(this.draw);
  };

  /** Names the hand's state on its slot, and the glow on the arrow while a high five is on offer. */
  private mark(state: State): void {
    this.state = state;
    const slot = this.slot.current;
    if (slot) {
      slot.dataset.hand = state;
    }
    const arrow = this.arrow.current;
    if (arrow instanceof HTMLElement) {
      if (state === "arm") {
        arrow.dataset.near = "";
      } else {
        delete arrow.dataset.near;
      }
    }
  }

  /** Animates the slot to `to`: from `from` while the hand is hidden, else from wherever its last animation left it. */
  private enter(from: Keyframe, to: Keyframe, ease: Ease): void {
    this.run(this.slot.current!, this.state === "" ? [from, to] : [to], ease);
  }

  /** Animates `element` through `frames`, from wherever its last animation left it. */
  private run(
    element: Element,
    frames: Keyframe[],
    ease: Ease,
    still?: Keyframe[],
  ): Animation {
    const previous = this.running.get(element);
    if (previous) {
      try {
        previous.commitStyles();
      } catch {
        // A detached element has no styles to keep.
      }
      previous.cancel();
    }
    const animation = play(element, frames, ease, still);
    this.running.set(element, animation);
    return animation;
  }
}

/** Keyframes of the clap clip from its beats: a transform and opacity at a time in ms, eased to the next beat. */
function beats(
  clip: Array<
    [transform: string, opacity: number, ms: number, easing?: string]
  >,
): Keyframe[] {
  return clip.map(([transform, opacity, ms, easing]) => ({
    transform,
    opacity,
    offset: ms / CLAP_MS,
    ...(easing === undefined ? {} : { easing }),
  }));
}

/** The reduced-motion clap: still at `transform`, at the given opacities at the start, the impact, the end of the hold and the end. */
function hold(transform: string, opacity: [number, number, number, number]) {
  return beats(
    [0, 150, 1_100, CLAP_MS].map(
      (ms, index) =>
        [transform, opacity[index]!, ms] as [string, number, number],
    ),
  );
}

/** The clap's impact, centred on the parent's origin: dots in the two colours flying out and a ring widening; `onEnd` when they are gone. */
export function Burst({
  colors,
  onEnd,
}: {
  colors: string[];
  onEnd: () => void;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dots = root.current!.querySelectorAll<HTMLElement>("[data-dot]");
    const animations = [...dots].map((dot, index) =>
      play(
        dot,
        [
          { transform: `rotate(${index * 45}deg) translate(0)`, opacity: 1 },
          {
            transform: `rotate(${index * 45}deg) translate(2.4em) scale(0.4)`,
            opacity: 0,
          },
        ],
        { duration: 600, easing: "ease-out", delay: IMPACT_MS },
      ),
    );
    const ring = root.current!.querySelector<HTMLElement>("[data-ring]")!;
    animations.push(
      play(
        ring,
        [
          { transform: "scale(0.2)", opacity: 0.8 },
          { transform: "scale(1)", opacity: 0 },
        ],
        { duration: 400, easing: "ease-out", delay: IMPACT_MS },
      ),
    );
    const timer = setTimeout(onEnd, IMPACT_MS + 600);
    return () => {
      animations.forEach((animation) => animation.cancel());
      clearTimeout(timer);
    };
  }, [onEnd]);
  return (
    <div
      aria-label="High five!"
      className="absolute left-[-1.25em] top-[-1.25em] h-[2.5em] w-[2.5em]"
      ref={root}
      role="img"
    >
      <i
        className="absolute inset-0 rounded-full border-2 opacity-0"
        data-ring=""
        style={{ borderColor: colors[0] }}
      />
      {Array.from({ length: 8 }, (_, index) => (
        <i
          className="absolute left-1/2 top-1/2 -ml-[0.225em] -mt-[0.225em] h-[0.45em] w-[0.45em] rounded-full opacity-0"
          data-dot=""
          key={index}
          style={{ background: colors[index % colors.length] }}
        />
      ))}
    </div>
  );
}
