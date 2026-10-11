import type { ReactElement, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { colorOf } from "../colors";
import type { JsonObject } from "../shared/shared";
import { shared, useBroadcast } from "../shared/shared";
import { EMOJI, Emoji, Legend, Stream } from "./emotes";
import { Meeting, Wiggle } from "./gestures";
import { AtPointer, Layer } from "./glyph";
import type { Puppet } from "./hand";
import { Burst, HandSlot } from "./hand";
import type { Point, Replay, Space } from "./motion";
import { CLAP_MS, HOLD_MS } from "./tokens";
import type { CursorPoint } from "./wire";
import { emoteOf, highFiveOf, regionOf, waveOf } from "./wire";

/** One collaborator's cursor as the reactions meet it: where it is drawn now in px of the surface, or undefined while it is not, its hand and arrow, and its replay. */
export interface Peer {
  at: Point | undefined;
  puppet: Puppet | null;
  replay: Replay;
}

/** My pointer over the surface as its last event left it: px, when in ms, and whether a button is held. */
export interface Pointer extends Point {
  t: number;
  down: boolean;
}

/** Numbers everything shown, across every `Reactions`, for React keys. */
let serial = 0;

/**
 * Emotes, high fives and waves over any surface: `1`–`6` sends an emoji from
 * my pointer and `E` shows the legend, resting on a peer's drawn cursor
 * offers a high five that a click or `Space` fires, and a wiggle waves. The
 * three broadcasts go out and come in here, and everyone's hands are driven
 * through `peers`.
 */
export function Reactions({
  legend,
  onLegend,
  onWave,
  peers,
  pointer,
  region,
  space,
  toWire,
}: {
  legend: Point | undefined;
  /** Where the legend should show, or close (undefined); the host keeps it. */
  onLegend: (at: Point | undefined) => void;
  /** My wave starts or ends. */
  onWave?: (on: boolean) => void;
  peers: ReadonlyMap<string, Peer>;
  pointer: Pointer | undefined;
  region?: string;
  space: Space;
  /** A point of the surface as the wire point everyone else reads, or nothing when it has none. */
  toWire: (at: Point) => CursorPoint | undefined;
}): ReactElement {
  const [partner, setPartner] = useState<string>();
  const [shown, setShown] = useState<
    { key: number; at: Point; node: ReactNode }[]
  >([]);
  const [meeting] = useState(() => new Meeting(peers, setPartner));
  const [wiggle] = useState(() => new Wiggle());
  const [stream] = useState(() => new Stream());
  const hand = useRef<Puppet>(null);
  const latest = useRef(pointer);
  latest.current = pointer;
  /** The pointer the legend opened at. */
  const shownAt = useRef<Pointer>();
  /** The last pair that clapped and when. */
  const lastClap = useRef({ pair: "", t: 0 });
  /** While I wave: the timer that ends it and the payload its end is sent with. */
  const waving = useRef<{
    release: ReturnType<typeof setTimeout>;
    payload: JsonObject;
  }>();
  const me = shared.me.user.id;

  const show = useCallback(
    (at: Point, node: (done: () => void) => ReactNode) => {
      const key = (serial += 1);
      const done = () =>
        setShown((all) => all.filter((item) => item.key !== key));
      setShown((all) => [...all, { key, at, node: node(done) }]);
    },
    [],
  );

  const float = useCallback(
    (at: Point, emoji: string) => {
      const turn = stream.next(performance.now());
      show(at, (done) => <Emoji emoji={emoji} onEnd={done} turn={turn} />);
    },
    [show, stream],
  );

  /** Both participants' hands meet at `target`; theirs on their layer, mine at my pointer. */
  const highFive = useCallback(
    (target: Point, ids: [string, string]) => {
      const pair = [...ids].sort().join(" ");
      const now = performance.now();
      if (
        pair === lastClap.current.pair &&
        now - lastClap.current.t < CLAP_MS
      ) {
        return;
      }
      lastClap.current = { pair, t: now };
      const starts = ids.map((id) =>
        id === me ? latest.current : peers.get(id)?.at,
      );
      const left =
        starts[0] && starts[1] && starts[0].x !== starts[1].x
          ? starts[0].x < starts[1].x
          : true;
      ids.forEach((id, index) => {
        const start = starts[index];
        const puppet = id === me ? hand.current : peers.get(id)?.puppet;
        if (start && puppet) {
          void puppet.clap(
            { x: target.x - start.x, y: target.y - start.y },
            (index === 0) === left ? -1 : 1,
          );
        }
      });
      const colors = ids.map((id) => colorOf(id).backgroundColor);
      show(target, (done) => <Burst colors={colors} onEnd={done} />);
      if (ids.includes(me)) {
        meeting.done(ids[0] === me ? ids[1] : ids[0]);
      }
    },
    [me, meeting, peers, show],
  );

  const fire = useCallback(() => {
    const target = meeting.point();
    const partner = meeting.partner;
    const point = target && toWire(target);
    if (!point || partner === undefined) {
      return;
    }
    shared.broadcast("cursor:high-five", { ...point, with: partner });
    highFive(target, [me, partner]);
  }, [highFive, me, meeting, toWire]);

  const emote = useCallback(
    (emoji: string) => {
      const point = latest.current && toWire(latest.current);
      if (point) {
        shared.broadcast("cursor:emote", { ...point, emoji });
        float(latest.current!, emoji);
      }
    },
    [float, toWire],
  );

  const endWave = useCallback(() => {
    wiggle.end();
    const wave = waving.current;
    if (wave) {
      clearTimeout(wave.release);
      waving.current = undefined;
      hand.current?.wave(false);
      onWave?.(false);
      shared.broadcast("cursor:wave", { ...wave.payload, on: false });
    }
  }, [onWave, wiggle]);

  useLayoutEffect(() => {
    if (!pointer) {
      endWave();
      meeting.mine(undefined);
      return;
    }
    meeting.mine(pointer);
    hand.current?.track(pointer.x, pointer.t);
    if (pointer.down) {
      endWave();
    } else if (wiggle.push(pointer.x, pointer.y, pointer.t)) {
      const payload = waving.current?.payload ?? regionOf(region);
      if (waving.current) {
        clearTimeout(waving.current.release);
      } else {
        hand.current?.wave(true);
        onWave?.(true);
        shared.broadcast("cursor:wave", { ...payload, on: true });
      }
      waving.current = { release: setTimeout(endWave, HOLD_MS), payload };
    }
  }, [endWave, meeting, onWave, pointer, region, wiggle]);

  useLayoutEffect(() => {
    if (legend && shownAt.current !== pointer) {
      onLegend(undefined);
    }
  }, [legend, onLegend, pointer]);

  const ending = useRef(endWave);
  ending.current = endWave;
  useEffect(
    () => () => {
      ending.current();
      meeting.stop();
    },
    [meeting],
  );

  useEffect(() => {
    if (partner === undefined) {
      return;
    }
    const theirs = peers.get(partner)?.puppet;
    const mine = hand.current;
    const side = meeting.side();
    mine?.arm(true, side);
    theirs?.arm(true, -side as 1 | -1);
    return () => {
      theirs?.arm(false);
      mine?.arm(false);
    };
  }, [meeting, partner, peers]);

  const pointing = pointer !== undefined;
  useLayoutEffect(() => {
    if (!pointing) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      const key = plainKey(event);
      const emoji = EMOJI[Number(key) - 1];
      if (key === "e" || key === "E") {
        shownAt.current = latest.current;
        onLegend(legend ? undefined : latest.current);
      } else if (emoji !== undefined) {
        emote(emoji);
        if (legend) {
          onLegend(undefined);
        }
      } else if (legend && key === "Escape") {
        onLegend(undefined);
      } else if (key === " " && meeting.partner !== undefined) {
        fire();
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", fire);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", fire);
    };
  }, [emote, fire, legend, meeting, onLegend, pointing]);

  useBroadcast("cursor:emote", (payload, from) => {
    const emote = emoteOf(payload, region, space.units);
    if (emote && from.id !== me && EMOJI.includes(emote.emoji)) {
      peers.get(from.id)?.replay.wake();
      float(peers.get(from.id)?.at ?? space.resolve(emote), emote.emoji);
    }
  });

  useBroadcast("cursor:high-five", (payload, from) => {
    const five = highFiveOf(payload, region, space.units);
    if (five && from.id !== me) {
      peers.get(from.id)?.replay.wake();
      peers.get(five.with)?.replay.wake();
      highFive(space.resolve(five), [from.id, five.with]);
    }
  });

  useBroadcast("cursor:wave", (payload, from) => {
    const wave = waveOf(payload, region);
    if (wave) {
      peers.get(from.id)?.replay.wake();
      peers.get(from.id)?.puppet?.wave(wave.on);
    }
  });

  const color = colorOf(me).backgroundColor;
  return (
    <>
      {shown.map(({ key, at, node }) => (
        <Layer at={at} key={key}>
          {node}
        </Layer>
      ))}
      {pointer && (
        <Layer at={pointer}>
          <HandSlot color={color} ref={hand} />
        </Layer>
      )}
      <AtPointer at={legend}>
        {(leaving) => <Legend leaving={leaving} />}
      </AtPointer>
    </>
  );
}

/** The key of a plain press meant for the page: none while a modifier is held, the key repeats, something already handled it, or a field or button has the keys. */
export function plainKey(event: KeyboardEvent): string | undefined {
  const target = event.target;
  return event.defaultPrevented ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    (target instanceof HTMLElement &&
      (target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement))
    ? undefined
    : event.key;
}
