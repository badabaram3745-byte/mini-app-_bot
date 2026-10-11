import type { ReactElement, ReactNode } from "react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { colorOf } from "../colors";
import { kitState } from "../shared/myState";
import type { Collaborator, JsonObject } from "../shared/shared";
import { shared, useBroadcast, useCollaborators } from "../shared/shared";
import { warnOnce } from "../shared/warn";
import type { User } from "../user";
import { anchorAt, areaOf, DomSpace } from "./anchor";
import type { CursorSpace } from "./camera";
import { CameraSpace, finite } from "./camera";
import { AtPointer, CursorGlyph, Layer } from "./glyph";
import type { Puppet } from "./hand";
import type { Point, Space } from "./motion";
import { Replay } from "./motion";
import type { Peer, Pointer } from "./reactions";
import { plainKey, Reactions } from "./reactions";
import { paint, rangeOf, selectionIn } from "./selection";
import {
  BESIDE_ARROW,
  BUBBLE,
  cx,
  KEY,
  LINGER_MS,
  PILL,
  POP_IN,
  POP_OUT,
} from "./tokens";
import type { CursorPoint, Units } from "./wire";
import {
  cursorOf,
  fraction,
  messageOf,
  moved,
  pointOf,
  publish,
  regionOf,
  selectionOf,
} from "./wire";

export type { CursorSpace } from "./camera";

export interface Cursor {
  user: User;
  /** Their colour, the same as their `Avatar`. */
  color: string;
  presence: JsonObject;
  /** The default arrow and name, to decorate or to return for some people. */
  arrow: ReactNode;
}

export interface CursorsProps {
  /** Press `/` to type a message everyone sees at your cursor; Escape closes it. On by default. */
  chat?: boolean;
  /** Press `1`–`6` to react with an emoji at your cursor (`E` shows which key is which), wiggle the pointer to wave, and rest it on someone's cursor to high five; a hint of the keys shows once. On by default. */
  emotes?: boolean;
  /** A selector for the element positions are fractions of, inside the element this covers; that element itself by default. A fixed-aspect board centred in a responsive page keeps cursors exact on every screen, and pointers beside it show beside it. */
  frame?: string;
  /** Names the space this covers, like `slide-${index}`: cursors written here carry it, and only cursors from the same region are drawn. Lets several `<Cursors>` share a page. */
  region?: string;
  /** Draws one collaborator's cursor in place of the default arrow and name. */
  render?: (cursor: Cursor) => ReactNode;
  /** Text you select here is highlighted in your colour for everyone else, where their page shows the same text. On by default. */
  selection?: boolean;
  /** For a canvas each viewer pans and zooms for themselves (an `<svg viewBox>`, a `<canvas>`, a transformed layer): `toContent(clientX, clientY)` maps my pointer to the units positions are shared in and `toClient(x, y)` maps a shared point back to my screen, so everyone's cursors ride the artwork through my camera. Positions then carry no anchor and `frame` is ignored. */
  space?: CursorSpace;
}

/** What sits at my pointer: the chat input, or the legend where it opened. */
type Mode = "chat" | { legend: Point };

/** How long a pointer holds still before where it is counts as where it rests. */
const REST_MS = 150;
const CHAT_IDLE_MS = 5_000;
const CHAT_PLACEHOLDER = "Say something…";
const HINT_MS = 3_000;
/** How many `<Cursors>` are mounted per region. */
const mounted = new Map<string | undefined, number>();
/** Pointer moves an inner region already took. */
const claimed = new WeakSet<Event>();

/**
 * Shows everyone else's pointer over the parent element (give it
 * `className="relative"`), or over the whole page when no parent is
 * positioned; never your own. Each cursor is an arrow with the person's name
 * in their colour that follows their movement a moment behind and fades when
 * they stop, pointing at the same element on every screen size and scroll
 * offset, at the same fraction of `frame`, or on the same artwork through
 * each viewer's own camera with a `space`.
 */
export function Cursors({
  chat = true,
  emotes = true,
  frame,
  region,
  render,
  selection = true,
  space,
}: CursorsProps): ReactElement {
  const overlay = useRef<HTMLDivElement>(null);
  /** The element my pointer events come from. */
  const area = useRef<HTMLElement>();
  const camera = useRef(space);
  camera.current = space;
  const through = space !== undefined;
  const surface = useMemo<Space>(
    () =>
      through
        ? new CameraSpace(
            () => overlay.current!,
            () => camera.current!,
          )
        : new DomSpace(() => overlay.current!),
    [through],
  );
  const others = useCollaborators(
    useMemo(() => inRegion(region, surface.units), [region, surface]),
  );
  const selections = useCollaborators(
    useMemo(() => selectionsIn(region), [region]),
  );
  const arrived = useCollaborators((all) => all.length > 0);
  const [mine, setMine] = useState<Pointer>();
  const [mode, setMode] = useState<Mode>();
  const [hinting, setHinting] = useState(false);
  /** Everyone's cursor by user id. */
  const peers = useRef(new Map<string, Peer>());
  const [placed, setPlaced] = useState(false);
  useLayoutEffect(() => setPlaced(true), []);
  const pointing = mine !== undefined;
  const legend = typeof mode === "object" ? mode.legend : undefined;
  const showLegend = useCallback(
    (at: Point | undefined) => setMode(at && { legend: at }),
    [],
  );

  /** My pointer at `at` as the point everyone else reads: the camera's units with a `space`, else fractions of the overlay plus the element under it unless a `frame` sets the fractions. */
  const toWire = useCallback(
    (at: Point): (CursorPoint & { t: number }) | undefined => {
      const element = overlay.current!;
      const rect = element.getBoundingClientRect();
      const t = Math.round(performance.now());
      if (surface.units === "page") {
        const content = finite(
          camera.current!.toContent(rect.left + at.x, rect.top + at.y),
        );
        return (
          content && {
            x: fraction(content.x),
            y: fraction(content.y),
            ...regionOf(region),
            space: "page",
            t,
          }
        );
      }
      return {
        x: fraction(at.x / rect.width),
        y: fraction(at.y / rect.height),
        ...(frame === undefined
          ? anchorAt(area.current!, element, rect.left + at.x, rect.top + at.y)
          : undefined),
        ...regionOf(region),
        t,
      };
    },
    [frame, region, surface],
  );

  useLayoutEffect(() => {
    if (frame === undefined) {
      return;
    }
    if (surface.units === "page") {
      warnOnce(
        `cursors:frame:space:${frame}`,
        `<Cursors frame=${JSON.stringify(frame)}> also has a space, whose units positions are in, so the frame is ignored.`,
      );
      return;
    }
    const element = overlay.current!;
    const outer = areaOf(element);
    const inner = outer.querySelector<HTMLElement>(frame);
    if (!inner) {
      warnOnce(
        `cursors:frame:${frame}`,
        `<Cursors frame=${JSON.stringify(frame)}> matches nothing inside the element it covers, so positions are fractions of that element.`,
      );
      return;
    }
    const fit = () => {
      const around = outer.getBoundingClientRect();
      const box = inner.getBoundingClientRect();
      element.style.left = `${box.left - around.left - outer.clientLeft}px`;
      element.style.top = `${box.top - around.top - outer.clientTop}px`;
      element.style.width = `${box.width}px`;
      element.style.height = `${box.height}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    observer.observe(inner);
    return () => {
      observer.disconnect();
      for (const property of ["left", "top", "width", "height"]) {
        element.style.removeProperty(property);
      }
    };
  }, [frame, surface]);

  useLayoutEffect(() => {
    const element = overlay.current!;
    const target = areaOf(element);
    area.current = target;
    if (
      target !== document.documentElement &&
      element.parentElement !== target
    ) {
      warnOnce(
        "cursors:parent",
        '<Cursors> covers a larger element than its parent because the parent is not positioned; add className="relative" to the parent to cover only it.',
      );
    }
    if ((mounted.get(region) ?? 0) > 0) {
      warnOnce(
        `cursors:twice:${region}`,
        "<Cursors> is mounted twice for one region; presence.cursor is one key, so give each a region of its own.",
      );
    }
    mounted.set(region, (mounted.get(region) ?? 0) + 1);
    let rest: ReturnType<typeof setTimeout> | undefined;
    /** Whether my pointer is over my content. */
    let here = false;
    /** Where my pointer was last, in px of the overlay, and the point it went out as. */
    let last: { at: Point; sent: CursorPoint | undefined } | undefined;
    /** The frame loop that follows my camera while my pointer rests. */
    let watching = 0;
    /** My pointer is no longer over my content. */
    const lost = () => {
      clearTimeout(rest);
      cancelAnimationFrame(watching);
      watching = 0;
      here = false;
      last = undefined;
      setMine(undefined);
      setMode(undefined);
    };
    /** Sends `point` as where I am now, and where I rest once I hold still. */
    const send = (point: CursorPoint) => {
      moved(point);
      if (cursorOf(shared.me.presence, region, surface.units) === undefined) {
        publish();
      }
      clearTimeout(rest);
      rest = setTimeout(publish, REST_MS);
    };
    const watch = () => {
      watching = 0;
      if (!here || !last) {
        return;
      }
      const point = toWire(last.at);
      if (point && (point.x !== last.sent?.x || point.y !== last.sent?.y)) {
        last.sent = point;
        send(point);
      }
      watching = requestAnimationFrame(watch);
    };
    const move = (event: PointerEvent) => {
      if (claimed.has(event)) {
        lost();
        return;
      }
      claimed.add(event);
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }
      const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const point = toWire(at);
      if (point) {
        shared.broadcast("cursor:move", point);
        send(point);
      }
      here = true;
      last = { at, sent: point };
      if (surface.units === "page" && watching === 0) {
        watching = requestAnimationFrame(watch);
      }
      if (chat || emotes) {
        setMine({
          ...at,
          t: point?.t ?? Math.round(performance.now()),
          down: event.buttons !== 0,
        });
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (here && plainKey(event) === "/") {
        setMode("chat");
        event.preventDefault();
      }
    };
    const leave = () => {
      lost();
      publish({ cursor: undefined, message: undefined });
    };
    const selecting = () =>
      selectionOf(shared.me.presence, region) !== undefined;
    const select = () => {
      const selected = selectionIn(target, region);
      if (selected || selecting()) {
        publish({ selection: selected });
      }
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        lost();
        publish({
          cursor: undefined,
          message: undefined,
          selection: undefined,
        });
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", hidden);
    if (selection) {
      document.addEventListener("selectionchange", select);
    }
    if (chat) {
      window.addEventListener("keydown", onKey);
    }
    return () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("selectionchange", select);
      window.removeEventListener("keydown", onKey);
      mounted.set(region, mounted.get(region)! - 1);
      lost();
      if (cursorOf(shared.me.presence, region, surface.units) !== undefined) {
        publish({ cursor: undefined, message: undefined });
      }
      if (selecting()) {
        publish({ selection: undefined });
      }
    };
  }, [chat, emotes, frame, region, selection, surface, toWire]);

  useBroadcast("cursor:move", (payload, from) => {
    const point = pointOf(payload, region, surface.units);
    if (point !== undefined) {
      peers.current.get(from.id)?.replay.follow(point);
    }
  });

  const nativeCursor = useRef("");
  const wave = useCallback((on: boolean) => {
    const style = area.current!.style;
    if (on) {
      nativeCursor.current = style.cursor;
    }
    style.cursor = on ? "none" : nativeCursor.current;
  }, []);

  useEffect(() => {
    if (!arrived || !pointing || !(chat || emotes)) {
      return;
    }
    let live = true;
    void kitState("#cursors", { hinted: false }).then((seen) => {
      if (live && !seen.get().hinted) {
        seen.set({ hinted: true });
        setHinting(true);
      }
    });
    return () => {
      live = false;
    };
  }, [arrived, chat, emotes, pointing]);

  useEffect(() => {
    if (!hinting) {
      return;
    }
    const timer = setTimeout(() => setHinting(false), HINT_MS);
    return () => clearTimeout(timer);
  }, [hinting]);

  useLayoutEffect(() => {
    if (!selection) {
      return;
    }
    const painted = selections.flatMap(({ id, selection: theirs }) => {
      const range = rangeOf(area.current!, theirs);
      return range ? [paint(range, colorOf(id).backgroundColor)] : [];
    });
    return () => painted.forEach((unpaint) => unpaint());
  }, [selections, selection]);

  return (
    <div
      className="pointer-events-none invisible absolute inset-0 z-50 select-none text-[16px]"
      ref={overlay}
    >
      {placed &&
        others.map((other) => (
          <CursorLayer
            collaborator={other}
            key={`${surface.units}:${other.user.id}`}
            peers={peers.current}
            region={region}
            render={render}
            space={surface}
          />
        ))}
      {emotes && (
        <Reactions
          legend={legend}
          onLegend={showLegend}
          onWave={wave}
          peers={peers.current}
          pointer={mine}
          region={region}
          space={surface}
          toWire={toWire}
        />
      )}
      {chat && (
        <Chat
          at={mine}
          onClose={() => setMode(undefined)}
          open={mode === "chat"}
        />
      )}
      <Hint
        at={hinting && mode === undefined ? mine : undefined}
        chat={chat}
        emotes={emotes}
      />
    </div>
  );
}

/** One collaborator's cursor: its replay places and fades the layer, it pops in on arrival and out on leaving, and it stands in `peers` for the reactions. */
const CursorLayer = memo(function CursorLayer({
  collaborator: { user, presence },
  peers,
  region,
  render,
  space,
}: {
  collaborator: Collaborator;
  peers: Map<string, Peer>;
  region: string | undefined;
  render: CursorsProps["render"];
  space: Space;
}): ReactElement {
  const layer = useRef<HTMLDivElement>(null);
  const puppet = useRef<Puppet>(null);
  const [peer] = useState((): Peer => {
    const peer: Peer = {
      at: undefined,
      puppet: null,
      replay: new Replay(space, (at) => {
        const style = layer.current!.style;
        peer.at = at;
        if (at) {
          style.transform = `translate(${at.x}px, ${at.y}px)`;
          style.opacity = "1";
          puppet.current?.track(at.x, performance.now());
        } else {
          style.opacity = "0";
        }
      }),
    };
    return peer;
  });
  useLayoutEffect(() => {
    peer.puppet = puppet.current;
    peers.set(user.id, peer);
    return () => {
      peers.delete(user.id);
      peer.replay.stop();
      popOut(layer.current!);
    };
  }, [peer, peers, user.id]);
  useLayoutEffect(
    () => peer.replay.follow(cursorOf(presence, region, space.units)!),
    [peer, presence, region, space],
  );

  const drawn = (
    <CursorGlyph
      colors={colorOf(user.id)}
      message={messageOf(presence)}
      ref={puppet}
      user={user}
    />
  );
  return (
    <Layer ref={layer}>
      {render
        ? render({
            user,
            color: colorOf(user.id).backgroundColor,
            presence,
            arrow: drawn,
          })
        : drawn}
    </Layer>
  );
});

/** Leaves a copy of the layer behind to pop out in place. */
function popOut(layer: HTMLElement): void {
  const ghost = layer.cloneNode(true) as HTMLElement;
  ghost.setAttribute("aria-hidden", "true");
  const content = (ghost.firstElementChild as HTMLElement | null) ?? ghost;
  content.className = cx(
    content.className,
    POP_OUT,
    "origin-top-left zoom-out-50 [&_*]:animate-none",
  );
  layer.after(ghost);
  setTimeout(() => ghost.remove(), LINGER_MS);
}

/** My cursor chat: an input at my pointer while `open`, each keystroke my `message`, cleared when the input closes or after 5 s without typing. */
function Chat({
  at,
  onClose,
  open,
}: {
  at: Point | undefined;
  onClose: () => void;
  open: boolean;
}): ReactElement | null {
  const input = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const type = (next: string) => {
    setText(next);
    publish({ message: next || undefined });
  };
  const attach = useCallback(
    (element: HTMLInputElement | null) => {
      input.current = element;
      if (element && open) {
        element.focus();
      }
    },
    [open],
  );

  useEffect(() => {
    if (open) {
      setText("");
    } else {
      publish({ message: undefined });
    }
  }, [open]);

  useEffect(() => {
    if (!open || !text) {
      return;
    }
    const timer = setTimeout(() => type(""), CHAT_IDLE_MS);
    return () => clearTimeout(timer);
  }, [open, text]);

  const close = () => {
    onClose();
    input.current?.blur();
  };
  return (
    <AtPointer at={open ? at : undefined}>
      {(leaving) => (
        <label
          className={cx(
            BESIDE_ARROW,
            "block origin-[-1em_-1.5em] cursor-text",
            leaving
              ? cx(POP_OUT, "zoom-out-95")
              : cx(POP_IN, "pointer-events-auto zoom-in-95"),
          )}
        >
          <span
            aria-hidden="true"
            className={cx(
              BUBBLE,
              "invisible block overflow-hidden whitespace-pre",
            )}
          >
            {text || CHAT_PLACEHOLDER}
          </span>
          <input
            aria-label="Cursor chat"
            className={cx(
              BUBBLE,
              "absolute inset-0 w-full placeholder:text-current placeholder:opacity-60 selection:bg-white/30",
            )}
            onBlur={close}
            onChange={(event) => type(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && close()}
            placeholder={CHAT_PLACEHOLDER}
            readOnly={leaving}
            ref={attach}
            style={{ ...colorOf(shared.me.user.id), outline: "none" }}
            value={text}
          />
        </label>
      )}
    </AtPointer>
  );
}

/** The one-time chip under my pointer naming the keys that are on. */
function Hint({
  at,
  chat,
  emotes,
}: {
  at: Point | undefined;
  chat: boolean;
  emotes: boolean;
}): ReactElement | null {
  return (
    <AtPointer at={at}>
      {(leaving) => (
        <div
          className={cx(
            BESIDE_ARROW,
            PILL,
            "origin-[-1em_-1.5em] whitespace-nowrap px-[0.7em] py-[0.35em]",
            leaving
              ? cx(POP_OUT, "zoom-out-95")
              : cx(POP_IN, "slide-in-from-top-1"),
          )}
          role="status"
        >
          {chat && (
            <>
              <kbd className={KEY}>/</kbd> chat
            </>
          )}
          {chat && emotes && " · "}
          {emotes && (
            <>
              <kbd className={KEY}>1</kbd>–<kbd className={KEY}>6</kbd> react
            </>
          )}
        </div>
      )}
    </AtPointer>
  );
}

/** Everyone whose cursor is in `region` and `units`; no region matches cursors written without one. */
function inRegion(region: string | undefined, units: Units) {
  return (all: readonly Collaborator[]): readonly Collaborator[] =>
    all.filter(
      (other) => cursorOf(other.presence, region, units) !== undefined,
    );
}

/** Each selection in `region` with whose it is. */
function selectionsIn(region: string | undefined) {
  return (all: readonly Collaborator[]) =>
    all.flatMap(({ user, presence }) => {
      const selection = selectionOf(presence, region);
      return selection ? [{ id: user.id, selection }] : [];
    });
}
