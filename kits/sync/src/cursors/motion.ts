import { IDLE_MS, reduced } from "./tokens";
import type { CursorPoint, Units } from "./wire";

/** A position in px of the surface a cursor is drawn on. */
export interface Point {
  x: number;
  y: number;
}

/** The surface a cursor is drawn on: the units of the points it reads and writes, and where such a point falls on it, in px, as it lays out now. */
export interface Space {
  readonly units: Units;
  resolve(sample: CursorPoint): Point;
  /** Whether the viewer looks at the surface through a camera of their own; a target that moved since last frame is then followed at once rather than eased. */
  readonly camera?: boolean;
}

/** A cursor position with the sender's clock, in ms. */
type Sample = CursorPoint & { t: number };

const MIN_DELAY_MS = 16;
const MAX_DELAY_MS = 300;
/** How often the delay is reviewed against the lead the buffer kept. */
const REVIEW_MS = 2_000;
/** The lead the buffer should keep at every arrival; more than this is given back. */
const SLACK_MS = 32;
/** The most samples kept unplayed. */
const MAX_SAMPLES = 256;
/** How long the offset left by a hop or a reflow takes to decay, critically damped. */
const SETTLE_S = 0.24;
/** The longest frame the decay steps over. */
const MAX_STEP_MS = 50;

/**
 * Replays one person's cursor samples on the sender's clock, behind by a
 * delay that grows when a sample lands late and shrinks every two seconds.
 * Between samples it moves straight, and whatever the target moves that the
 * pointer did not becomes an offset that decays instead of a jump; through a
 * camera the cursor stays on the artwork.
 */
export class Glide {
  private samples: Sample[] = [];
  /** Local clock minus sender clock, the smallest seen: the least delayed delivery. */
  private offset = Infinity;
  private delay = MIN_DELAY_MS;
  /** The smallest lead the buffer had when a sample landed since the last review. */
  private lead = Infinity;
  private reviewedAt = 0;
  private lastNow = 0;
  /** What was aimed at last frame, to tell a shift of this page from the pointer's own motion. */
  private aimed: Placed | undefined;
  /** The offset still to decay and its velocity. */
  private residual: Point = { x: 0, y: 0 };
  private residualVelocity: Point = { x: 0, y: 0 };

  /** Adds a sample as it lands; without a sender clock its arrival time stands in. Starts over when the sender's clock goes backwards or a sample lands more than the longest delay sooner than any before. */
  push(point: CursorPoint, arrivedAt: number): void {
    const t = point.t ?? arrivedAt;
    const delivery = arrivedAt - t;
    const last = this.samples[this.samples.length - 1];
    if (last && t === last.t) {
      return;
    }
    if (last && (t < last.t || delivery < this.offset - MAX_DELAY_MS)) {
      this.samples = [];
      this.offset = Infinity;
    }
    if (this.offset === Infinity) {
      this.reviewedAt = arrivedAt;
    } else {
      this.adapt(t, arrivedAt);
    }
    const offset = Math.min(this.offset, delivery);
    if (offset < this.offset && this.offset !== Infinity) {
      this.delay = Math.min(MAX_DELAY_MS, this.delay + this.offset - offset);
    }
    this.offset = offset;
    this.samples.push({ ...point, t });
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }
  }

  /** Where to draw at local time `now` on `space`, or undefined before the first sample. */
  draw(now: number, space: Space): Point | undefined {
    if (this.samples.length === 0) {
      return undefined;
    }
    const T = this.playhead(now);
    const placed = this.place(T, space);
    const dt = Math.min(MAX_STEP_MS, now - this.lastNow) / 1000;
    const previous = this.aimed;
    this.aimed = placed;
    this.lastNow = now;
    if (previous && !space.camera) {
      const shift = sub(
        add(space.resolve(previous.sample), previous.extra),
        previous.target,
      );
      const jump = add(shift, this.hopped(previous.t, placed.t, space));
      this.residual = sub(this.residual, jump);
    }
    this.residual = spring(
      this.residual,
      this.residualVelocity,
      { x: 0, y: 0 },
      dt,
    );
    if (length(this.residual) < 0.5 && length(this.residualVelocity) < 1) {
      this.residual = { x: 0, y: 0 };
      this.residualVelocity = { x: 0, y: 0 };
    }
    return add(placed.target, this.residual);
  }

  /** Forgets the offset being decayed. */
  rest(): void {
    this.aimed = undefined;
    this.residual = { x: 0, y: 0 };
    this.residualVelocity = { x: 0, y: 0 };
  }

  /** The hops of the anchor crossings between sender times `from` and `to`: how far each lies from where the pointer's own step would have carried the cursor. */
  private hopped(from: number, to: number, space: Space): Point {
    let total = { x: 0, y: 0 };
    const samples = this.samples;
    for (let index = 1; index < samples.length; index += 1) {
      const before = samples[index - 1]!;
      const q = samples[index]!;
      if (q.t <= from || q.t > to || keyOf(before) === keyOf(q)) {
        continue;
      }
      total = add(
        total,
        sub(
          space.resolve(q),
          add(space.resolve(before), step(before, q, space)),
        ),
      );
    }
    return total;
  }

  /** The position at sender time `T`: linear between the samples around it, inside one anchor along the fractions of its box, across anchors by the pointer's own step from the earlier sample. */
  private place(T: number, space: Space): Placed {
    const { p1, p2, u } = this.locate(T);
    const none = { x: 0, y: 0 };
    if (!p2 || u <= 0) {
      return { target: space.resolve(p1), sample: p1, extra: none, t: p1.t };
    }
    if (keyOf(p1) !== keyOf(p2)) {
      const extra = scale(step(p1, p2, space), u);
      return {
        target: add(space.resolve(p1), extra),
        sample: p1,
        extra,
        t: p1.t,
      };
    }
    const sample: Sample = {
      ...p2,
      x: mix(p1.x, p2.x, u),
      y: mix(p1.y, p2.y, u),
      ...(p1.dx !== undefined && p2.dx !== undefined
        ? { dx: mix(p1.dx, p2.dx, u), dy: mix(p1.dy!, p2.dy!, u) }
        : {}),
    };
    return { target: space.resolve(sample), sample, extra: none, t: p1.t };
  }

  /** The samples around sender time `T`: `p1` at or before it, `p2` after it when there is one, and how far between them `T` lies. */
  private locate(T: number): { p1: Sample; p2: Sample | undefined; u: number } {
    const samples = this.samples;
    let index = 0;
    while (index + 1 < samples.length && samples[index + 1]!.t <= T) {
      index += 1;
    }
    const p1 = samples[index]!;
    const p2 = samples[index + 1];
    return { p1, p2, u: p2 ? (T - p1.t) / (p2.t - p1.t) : 0 };
  }

  private playhead(now: number): number {
    return now - this.offset - this.delay;
  }

  /** Grows the delay by how far behind the playhead this sample landed, if it did, and reviews the delay every two seconds. */
  private adapt(t: number, arrivedAt: number): void {
    const lead = t - this.playhead(arrivedAt);
    if (lead < 0) {
      this.delay = Math.min(MAX_DELAY_MS, this.delay - lead);
    }
    this.lead = Math.min(this.lead, Math.max(0, lead));
    if (arrivedAt - this.reviewedAt >= REVIEW_MS) {
      if (this.lead > SLACK_MS) {
        this.delay = Math.max(
          MIN_DELAY_MS,
          this.delay - (this.lead - SLACK_MS) / 2,
        );
      }
      this.lead = Infinity;
      this.reviewedAt = arrivedAt;
    }
  }
}

/**
 * Replays one collaborator's cursor on a surface, gliding (or jumping under
 * reduced motion) and fading `IDLE_MS` after the last sample; each frame's
 * position goes to `onFrame`, undefined once faded. `stop()` only stops: the
 * host removes what it drew.
 */
export class Replay {
  private readonly glide = new Glide();
  private frame = 0;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private last: Point | undefined;
  private faded = false;
  /** The newest sample, drawn as is under reduced motion. */
  private rest: CursorPoint | undefined;

  constructor(
    private readonly space: Space,
    private readonly onFrame: (at: Point | undefined) => void,
  ) {}

  follow(point: CursorPoint): void {
    this.rest = point;
    if (!reduced()) {
      this.glide.push(point, performance.now());
    }
    this.wake();
  }

  /** Shows the cursor where it was, draws it every frame, and starts the `IDLE_MS` to fading it. */
  wake(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(this.fade, IDLE_MS);
    if (this.faded) {
      this.faded = false;
      this.onFrame(this.last);
    }
    if (this.frame === 0) {
      this.draw();
    }
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    clearTimeout(this.idle);
  }

  private readonly fade = (): void => {
    this.faded = true;
    this.glide.rest();
    this.onFrame(undefined);
  };

  /** Draws where the samples fall on the surface now, each frame while the cursor shows. */
  private readonly draw = (): void => {
    if (this.faded) {
      this.frame = 0;
      return;
    }
    const at = reduced()
      ? this.rest && this.space.resolve(this.rest)
      : this.glide.draw(performance.now(), this.space);
    if (at && !(this.last && this.last.x === at.x && this.last.y === at.y)) {
      this.last = at;
      this.onFrame(at);
    }
    this.frame = requestAnimationFrame(this.draw);
  };
}

/** Where a sender time falls: the target in px, the sample resolved for it, the pointer's step added on top and the sample's clock. */
interface Placed {
  target: Point;
  sample: CursorPoint;
  extra: Point;
  t: number;
}

function keyOf(sample: CursorPoint): string | undefined {
  return sample.anchor?.join("/");
}

/** The pointer's own step from `a` to `b` on the sender's page, in px of this one. */
function step(a: CursorPoint, b: CursorPoint, space: Space): Point {
  return sub(
    space.resolve({ x: b.x, y: b.y }),
    space.resolve({ x: a.x, y: a.y }),
  );
}

function mix(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(a: Point, by: number): Point {
  return { x: a.x * by, y: a.y * by };
}

function length(a: Point): number {
  return Math.hypot(a.x, a.y);
}

/** One step of a critically damped spring from `from` toward `to` over `dt` seconds, settling within SETTLE_S; `velocity` is updated in place. */
function spring(from: Point, velocity: Point, to: Point, dt: number): Point {
  const omega = -Math.log(0.02) / SETTLE_S;
  const next = { x: from.x, y: from.y };
  for (const axis of ["x", "y"] as const) {
    velocity[axis] +=
      ((to[axis] - from[axis]) * omega * omega - 2 * omega * velocity[axis]) *
      dt;
    next[axis] = from[axis] + velocity[axis] * dt;
  }
  return next;
}
