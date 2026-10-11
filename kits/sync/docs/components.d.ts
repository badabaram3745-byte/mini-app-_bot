import type { JsonObject } from "./shared";
import type { CSSProperties, InputHTMLAttributes, ReactElement, ReactNode, RefObject, TextareaHTMLAttributes } from "react";

/** A person, the same shape as the ClickUp kit's `User`. */
interface User {
    kind: "user";
    id: string;
    name: string;
    /** Link to the person's profile; empty when the host does not name one. */
    url: string;
    /** Avatar URL. */
    image?: string;
}

/** Where a pointer is, as `<Cursors>` sends it in `presence.cursor` and `cursor:move`: fractions of its region or, with `anchor`, of that element's box, the region it is in and the sender's clock in ms. Over a surface seen through a camera, `space: "page"` and that surface's own units instead. */
type CursorPoint = JsonObject & {
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
type Emote = CursorPoint & {
    emoji: string;
};
/** The point two hands meet at, and whose hand the sender's meets. */
type HighFive = CursorPoint & {
    with: string;
};
/** The sender's wave starting or ending, in the region it started in. */
interface Wave {
    region?: string;
    on: boolean;
}
/** Text someone selected inside a `<Cursors>` area, as `presence.selection`: the path of each end from that area (child indices, then the offset in the last node) and a hash of the text, so it is drawn only over the same text. */
type TextSelection = JsonObject & {
    from: number[];
    to: number[];
    hash: string;
    region?: string;
};
/** What an `id` must look like to travel: generated ids pass, names and titles do not. */
declare const TOKEN: RegExp;
declare const MAX_STEPS = 24;
declare function fraction(value: number): number;
/** The region key a point or a wave carries, when it has one. */
declare function regionOf(region: string | undefined): JsonObject;
/** The units a `<Cursors>` reads and writes: its region's fractions, or with a `space`, the surface's own units tagged `"page"`. */
type Units = "page" | undefined;
/** `value` when it is a cursor point in `region` and `units` as `<Cursors>` sends one; an anchor this page cannot walk is left out. */
declare function pointOf(value: unknown, region: string | undefined, units?: Units): CursorPoint | undefined;
/** `payload` when it is a `cursor:emote` in `region` and `units`. */
declare function emoteOf(payload: unknown, region: string | undefined, units: Units): Emote | undefined;
/** `payload` when it is a `cursor:high-five` in `region` and `units`. */
declare function highFiveOf(payload: unknown, region: string | undefined, units: Units): HighFive | undefined;
/** `payload` when it is a `cursor:wave` in `region`. */
declare function waveOf(payload: unknown, region: string | undefined): Wave | undefined;
/** The presence's cursor while it is in `region` and `units`. */
declare function cursorOf(presence: JsonObject, region: string | undefined, units?: Units): CursorPoint | undefined;
/** The presence's chat message while they are typing one. */
declare function messageOf(presence: JsonObject): string | undefined;
/** The presence's selection when it has the shape `<Cursors>` writes and is in `region`. */
declare function selectionOf(presence: JsonObject, region: string | undefined): TextSelection | undefined;
/** My three presence keys as I have them now; every publish sends all three and leaves the rest of my presence alone. */
declare const mine: {
    cursor?: CursorPoint;
    message?: string;
    selection?: TextSelection;
};
/** Notes where my pointer is without publishing it; the next publish carries it. */
declare function moved(cursor: CursorPoint): void;
/** Sets the given keys of mine, `undefined` taking one away, and publishes all of them. */
declare function publish(update?: Partial<typeof mine>): void;

/** A position in px of the surface a cursor is drawn on. */
interface Point {
    x: number;
    y: number;
}
/** The surface a cursor is drawn on: the units of the points it reads and writes, and where such a point falls on it, in px, as it lays out now. */
interface Space {
    readonly units: Units;
    resolve(sample: CursorPoint): Point;
    /** Whether the viewer looks at the surface through a camera of their own; a target that moved since last frame is then followed at once rather than eased. */
    readonly camera?: boolean;
}
/**
 * Replays one person's cursor samples on the sender's clock, behind by a
 * delay that grows when a sample lands late and shrinks every two seconds.
 * Between samples it moves straight, and whatever the target moves that the
 * pointer did not becomes an offset that decays instead of a jump; through a
 * camera the cursor stays on the artwork.
 */
declare class Glide {
    private samples;
    /** Local clock minus sender clock, the smallest seen: the least delayed delivery. */
    private offset;
    private delay;
    /** The smallest lead the buffer had when a sample landed since the last review. */
    private lead;
    private reviewedAt;
    private lastNow;
    /** What was aimed at last frame, to tell a shift of this page from the pointer's own motion. */
    private aimed;
    /** The offset still to decay and its velocity. */
    private residual;
    private residualVelocity;
    /** Adds a sample as it lands; without a sender clock its arrival time stands in. Starts over when the sender's clock goes backwards or a sample lands more than the longest delay sooner than any before. */
    push(point: CursorPoint, arrivedAt: number): void;
    /** Where to draw at local time `now` on `space`, or undefined before the first sample. */
    draw(now: number, space: Space): Point | undefined;
    /** Forgets the offset being decayed. */
    rest(): void;
    /** The hops of the anchor crossings between sender times `from` and `to`: how far each lies from where the pointer's own step would have carried the cursor. */
    private hopped;
    /** The position at sender time `T`: linear between the samples around it, inside one anchor along the fractions of its box, across anchors by the pointer's own step from the earlier sample. */
    private place;
    /** The samples around sender time `T`: `p1` at or before it, `p2` after it when there is one, and how far between them `T` lies. */
    private locate;
    private playhead;
    /** Grows the delay by how far behind the playhead this sample landed, if it did, and reviews the delay every two seconds. */
    private adapt;
}
/**
 * Replays one collaborator's cursor on a surface, gliding (or jumping under
 * reduced motion) and fading `IDLE_MS` after the last sample; each frame's
 * position goes to `onFrame`, undefined once faded. `stop()` only stops: the
 * host removes what it drew.
 */
declare class Replay {
    private readonly space;
    private readonly onFrame;
    private readonly glide;
    private frame;
    private idle;
    private last;
    private faded;
    /** The newest sample, drawn as is under reduced motion. */
    private rest;
    constructor(space: Space, onFrame: (at: Point | undefined) => void);
    follow(point: CursorPoint): void;
    /** Shows the cursor where it was, draws it every frame, and starts the `IDLE_MS` to fading it. */
    wake(): void;
    stop(): void;
    private readonly fade;
    /** Draws where the samples fall on the surface now, each frame while the cursor shows. */
    private readonly draw;
}

/**
 * How a `<Cursors>` over a surface each viewer looks at through their own
 * camera (an `<svg viewBox>`, a `<canvas>`, a panned and zoomed layer) maps
 * the viewport to the units positions are shared in, and back; both are pure
 * and read as the camera stands at the moment of the call.
 */
export interface CursorSpace {
    /** A point of my viewport as the units I publish: the chart, page or world coordinate under it. */
    toContent(clientX: number, clientY: number): Point;
    /** A published point as client px, where my camera shows it now. */
    toClient(x: number, y: number): Point;
}
/** A surface seen through a camera: a wire point falls where the host's camera shows its units now, in px of the overlay. */
declare class CameraSpace implements Space {
    private readonly overlay;
    private readonly space;
    readonly units: Units;
    readonly camera = true;
    constructor(overlay: () => HTMLElement, space: () => CursorSpace);
    resolve(point: CursorPoint): Point;
}
declare function finite(at: Point): Point | undefined;

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
/**
 * Shows everyone else's pointer over the parent element (give it
 * `className="relative"`), or over the whole page when no parent is
 * positioned; never your own. Each cursor is an arrow with the person's name
 * in their colour that follows their movement a moment behind and fades when
 * they stop, pointing at the same element on every screen size and scroll
 * offset, at the same fraction of `frame`, or on the same artwork through
 * each viewer's own camera with a `space`.
 */
export declare function Cursors({ chat, emotes, frame, region, render, selection, space, }: CursorsProps): ReactElement;

/** An open hand in `color`, its wrist on the parent's origin, and the `Puppet` that animates it as the ref; `arrow` is the arrow the hand stands in for. */
declare const HandSlot: import("react").ForwardRefExoticComponent<{
    arrow?: RefObject<Element>;
    color: string;
} & import("react").RefAttributes<Puppet>>;
/** The hand's pose from the pointer's horizontal velocity: it swings with the motion, leans into it and squashes on each turn. */
declare class Swing {
    private angle;
    private velocity;
    private lastX;
    private lastT;
    /** A position sample in px at time `t` in ms. */
    push(x: number, t: number): void;
    /** The transform for this frame; the velocity decays while no sample lands. */
    pose(now: number): string;
    reset(): void;
}
/** When the hands meet inside the clap clip. */
declare const IMPACT_MS = 440;
/** Drives one cursor's hand and arrow: a small hand beside the tip while a high five is on offer, the hand in place of the arrow while its owner waves, and the high-five clip. */
declare class Puppet {
    private readonly slot;
    private readonly svg;
    private readonly arrow;
    private readonly swing;
    private readonly running;
    private state;
    /** The side a high five on offer wants the small hand on, kept through a clap. */
    private armed;
    private frame;
    private bob;
    private watchdog;
    constructor(slot: RefObject<HTMLDivElement>, svg: RefObject<SVGSVGElement>, arrow: RefObject<Element>);
    /** Shows a small hand beside the tip while a high five is on offer, on `side` of it: the side this hand will come in from. */
    arm(on: boolean, side?: 1 | -1): void;
    wave(on: boolean): void;
    /** A position sample of the hand's owner, in px at time `t`, for the swing; while waving it also keeps the hand from timing out. */
    track(x: number, t: number): void;
    /** Runs the high-five clip: the hand comes in from `side` of the meeting point `to` (relative to the tip, in px), meets the other, recoils and comes back; resolves when it is back. */
    clap(to: Point, side: 1 | -1): Promise<void>;
    stop(): void;
    /** Ends the bob, the swing and its watchdog. */
    private still;
    private readonly draw;
    /** Names the hand's state on its slot, and the glow on the arrow while a high five is on offer. */
    private mark;
    /** Animates the slot to `to`: from `from` while the hand is hidden, else from wherever its last animation left it. */
    private enter;
    /** Animates `element` through `frames`, from wherever its last animation left it. */
    private run;
}
/** The clap's impact, centred on the parent's origin: dots in the two colours flying out and a ring widening; `onEnd` when they are gone. */
declare function Burst({ colors, onEnd, }: {
    colors: string[];
    onEnd: () => void;
}): ReactElement;

/** One person's cursor as drawn, in em of the parent: the arrow with its tip at the origin, name and message in a pill of `colors` beside it, and the hand the `Puppet` ref drives. */
declare const CursorGlyph: import("react").ForwardRefExoticComponent<{
    colors: {
        backgroundColor: string;
        color: string;
    };
    message: string | undefined;
    user: User;
} & import("react").RefAttributes<Puppet>>;
/**
 * The arrow `Cursors` draws: its tip is the top-left corner, its fill the
 * current text colour, its edge white. Size it with `className`, `h-5` say,
 * to build a cursor of your own.
 */
export declare function CursorArrow({ className, style, }: {
    className?: string;
    style?: CSSProperties;
}): ReactElement;
/** A full-size box translated to `at`, px of the surface, or left for the host to place and fade when `at` is not given; its content sits at the box's corner. */
declare const Layer: import("react").ForwardRefExoticComponent<{
    at?: Point;
    children: ReactNode;
} & import("react").RefAttributes<HTMLDivElement>>;
/** What sits at my pointer while `at` is given, and for LINGER_MS after so it can pop out; `children` is told when it is leaving. */
declare function AtPointer({ at, children, }: {
    at: Point | undefined;
    children: (leaving: boolean) => ReactNode;
}): ReactElement | null;

export interface SharedTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    /** The document path, like `cards/${card.id}`. */
    doc: string;
    field: string;
}
/**
 * A textarea for a `sharedText()` field; read-only for any other field.
 * Edits apply to the shared text at once (IME input at composition end),
 * `onChange` fires afterwards with the resulting value, the caret survives
 * remote edits, and `value` and `defaultValue` are ignored.
 */
export declare function SharedTextarea({ doc, field, ...attributes }: SharedTextareaProps): ReactElement;
export interface SharedInputProps extends InputHTMLAttributes<HTMLInputElement> {
    doc: string;
    field: string;
}
/** A one-line input for a `sharedText()` field; read-only for any other field. `value`, `defaultValue` and `type` are ignored: it is always `type="text"`, the one input type whose caret the binding can follow. */
export declare function SharedInput({ doc, field, ...attributes }: SharedInputProps): ReactElement;
