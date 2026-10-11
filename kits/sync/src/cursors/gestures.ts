import type { Point } from "./motion";

/** A pointer position in px with the time it was seen, in ms. */
interface Sample {
  x: number;
  y: number;
  t: number;
}

const WAVE_WINDOW_MS = 1_000;
/** How far the pointer must come back from a leg's far end for the leg to count as a turn. */
const WAVE_LEG_PX = 10;
/** Two full cycles. */
const WAVE_TURNS = 4;
/** The most the pointer may wander vertically, as a share of its horizontal range. */
const WAVE_VERTICAL_SHARE = 0.5;

/**
 * Tells a wave from ordinary pointer movement: four horizontal turns of at
 * least 10 px inside 1 s, staying within half that range vertically. Once
 * waving, every further turn counts until `end()`.
 */
export class Wiggle {
  waving = false;
  private samples: Sample[] = [];

  /** Adds a pointer sample; true when it starts a wave or, while waving, is another turn. */
  push(x: number, y: number, t: number): boolean {
    this.samples.push({ x, y, t });
    while (this.samples[0]!.t < t - WAVE_WINDOW_MS) {
      this.samples.shift();
    }
    const { turns, turned, flat } = scan(this.samples);
    if (this.waving) {
      return turned;
    }
    if (turns >= WAVE_TURNS && flat) {
      this.waving = true;
      return true;
    }
    return false;
  }

  end(): void {
    this.waving = false;
    this.samples = [];
  }
}

/** How many times the pointer turned, whether the last sample was a turn, and whether it stayed flat from the first turn on. */
function scan(samples: Sample[]): {
  turns: number;
  turned: boolean;
  flat: boolean;
} {
  let turns = 0;
  let turned = false;
  let direction = 0;
  let far = samples[0]!.x;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { x, y } of samples) {
    turned = false;
    const ahead = (x - far) * direction;
    if (direction === 0) {
      if (Math.abs(x - far) >= WAVE_LEG_PX) {
        direction = Math.sign(x - far);
        far = x;
      }
    } else if (ahead > 0) {
      far = x;
    } else if (-ahead >= WAVE_LEG_PX) {
      turns += 1;
      turned = true;
      direction = -direction;
      if (turns === 1) {
        minX = maxX = far;
        minY = maxY = y;
      }
      far = x;
    }
    if (turns > 0) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    turns,
    turned,
    flat: maxY - minY <= (maxX - minX) * WAVE_VERTICAL_SHARE,
  };
}

const NEAR_PX = 24;
/** How far a pair may drift apart before the offer is withdrawn. */
const APART_PX = 36;
const DWELL_MS = 300;
const OFFER_MS = 2_000;

/**
 * Measures my pointer against everyone's drawn cursor every frame and names
 * a `partner` once one has stayed within 24 px for 300 ms. The offer stands
 * 2 s, and a pair that let it pass, or took it, is not offered again until
 * they part.
 */
export class Meeting {
  partner: string | undefined;
  private me: Point | undefined;
  private readonly spent = new Set<string>();
  private candidate: string | undefined;
  private dwell: ReturnType<typeof setTimeout> | undefined;
  private offer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;

  constructor(
    private readonly peers: ReadonlyMap<string, { at: Point | undefined }>,
    private readonly onChange: (partner: string | undefined) => void,
  ) {}

  /** My pointer, or undefined once it left. */
  mine(at: Point | undefined): void {
    this.me = at;
    this.measure();
    cancelAnimationFrame(this.frame);
    this.frame = at ? requestAnimationFrame(this.tick) : 0;
  }

  /** Which side of the partner my pointer is on: -1 left, 1 right. */
  side(): 1 | -1 {
    const theirs = this.theirs();
    return this.me && theirs && this.me.x > theirs.x ? 1 : -1;
  }

  /** The point between my pointer and the partner's cursor. */
  point(): Point | undefined {
    const theirs = this.theirs();
    return this.me && theirs
      ? { x: (this.me.x + theirs.x) / 2, y: (this.me.y + theirs.y) / 2 }
      : undefined;
  }

  /** Closes the offer with `id`: the high five happened. */
  done(id: string): void {
    this.spent.add(id);
    if (this.candidate === id) {
      this.settle(undefined);
    }
    if (this.partner === id) {
      this.set(undefined);
    }
  }

  stop(): void {
    clearTimeout(this.dwell);
    clearTimeout(this.offer);
    cancelAnimationFrame(this.frame);
  }

  private readonly tick = (): void => {
    this.measure();
    this.frame = requestAnimationFrame(this.tick);
  };

  private theirs(): Point | undefined {
    return this.partner === undefined
      ? undefined
      : this.peers.get(this.partner)?.at;
  }

  private measure(): void {
    const near = this.nearest(NEAR_PX);
    for (const id of this.spent) {
      if (id !== near) {
        this.spent.delete(id);
      }
    }
    if (this.partner !== undefined && this.nearest(APART_PX) !== this.partner) {
      this.set(undefined);
    }
    if (near !== this.candidate) {
      this.settle(near);
    }
  }

  /** Starts the dwell on `id`, replacing whichever was running. */
  private settle(id: string | undefined): void {
    clearTimeout(this.dwell);
    this.candidate = id;
    if (id === undefined || this.spent.has(id) || id === this.partner) {
      return;
    }
    this.dwell = setTimeout(() => this.set(id), DWELL_MS);
  }

  private set(partner: string | undefined): void {
    clearTimeout(this.offer);
    if (partner !== undefined) {
      this.offer = setTimeout(() => {
        this.spent.add(partner);
        this.set(undefined);
      }, OFFER_MS);
    }
    if (this.partner !== partner) {
      this.partner = partner;
      this.onChange(partner);
    }
  }

  private nearest(within: number): string | undefined {
    if (!this.me) {
      return undefined;
    }
    const me = this.me;
    let best: string | undefined;
    let least = within;
    for (const [id, { at }] of this.peers) {
      const distance = at ? Math.hypot(at.x - me.x, at.y - me.y) : Infinity;
      if (distance <= least) {
        best = id;
        least = distance;
      }
    }
    return best;
  }
}
