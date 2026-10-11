import type { CSSProperties, ReactElement, ReactNode } from "react";
import { forwardRef, useRef } from "react";
import type { User } from "../user";
import type { Puppet } from "./hand";
import { HandSlot } from "./hand";
import type { Point } from "./motion";
import { BESIDE_ARROW, BUBBLE, cx, POP_IN, POP_OUT, useLinger } from "./tokens";

/** The arrow's outline, its tip at (17, 6.2); the view box starts there so the tip is the top-left corner. */
const ARROW =
  "M17 6.2 65.1 34.8C66.3 35.5 66.1 36.6 65 37.1L43 45.5C42 45.9 41.3 46.6 40.7 47.4L26.5 66.1C25.8 67.2 24.6 66.8 24.3 65.7L13.3 10.5C12.9 8.8 13.4 7.3 14.9 6.6C15.5 6.3 16.2 6.1 17 6.2Z";

/** One person's cursor as drawn, in em of the parent: the arrow with its tip at the origin, name and message in a pill of `colors` beside it, and the hand the `Puppet` ref drives. */
export const CursorGlyph = forwardRef<
  Puppet,
  {
    colors: { backgroundColor: string; color: string };
    message: string | undefined;
    user: User;
  }
>(function CursorGlyph({ colors, message, user }, ref): ReactElement {
  const arrow = useRef<HTMLDivElement>(null);
  const shown = useLinger(message);
  return (
    <div
      aria-label={user.name}
      className={cx(POP_IN, "relative inline-flex origin-top-left zoom-in-50")}
      role="img"
    >
      <div
        className="origin-top-left transition-[filter] duration-300 motion-reduce:transition-none data-[near]:drop-shadow-[0_0_0.4em_currentColor]"
        ref={arrow}
        style={{ color: colors.backgroundColor }}
      >
        <CursorArrow className="h-[1.25em] drop-shadow" />
      </div>
      <div className={cx(BESIDE_ARROW, BUBBLE, "flex flex-col")} style={colors}>
        <span
          className={cx(
            "whitespace-nowrap text-[0.9em] font-medium leading-tight transition-opacity duration-150 motion-reduce:transition-none",
            shown.value !== undefined && "opacity-80",
          )}
        >
          {user.name}
        </span>
        {shown.value !== undefined && (
          <span
            className={cx(
              "break-words",
              shown.leaving
                ? cx(POP_OUT, "zoom-out-95")
                : cx(POP_IN, "slide-in-from-top-1"),
            )}
          >
            {shown.value}
          </span>
        )}
      </div>
      <HandSlot arrow={arrow} color={colors.backgroundColor} ref={ref} />
    </div>
  );
});

/**
 * The arrow `Cursors` draws: its tip is the top-left corner, its fill the
 * current text colour, its edge white. Size it with `className`, `h-5` say,
 * to build a cursor of your own.
 */
export function CursorArrow({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      overflow="visible"
      preserveAspectRatio="xMinYMin meet"
      style={style}
      viewBox="17 6 50 61"
    >
      <path
        d={ARROW}
        fill="currentColor"
        stroke="white"
        strokeLinejoin="round"
        strokeWidth="6"
      />
    </svg>
  );
}

/** A full-size box translated to `at`, px of the surface, or left for the host to place and fade when `at` is not given; its content sits at the box's corner. */
export const Layer = forwardRef<
  HTMLDivElement,
  { at?: Point; children: ReactNode }
>(function Layer({ at, children }, ref): ReactElement {
  return (
    <div
      className="absolute inset-0 transition-opacity duration-300 will-change-transform motion-reduce:transition-none"
      ref={ref}
      style={at && { transform: `translate(${at.x}px, ${at.y}px)` }}
    >
      <div className="visible w-max">{children}</div>
    </div>
  );
});

/** What sits at my pointer while `at` is given, and for LINGER_MS after so it can pop out; `children` is told when it is leaving. */
export function AtPointer({
  at,
  children,
}: {
  at: Point | undefined;
  children: (leaving: boolean) => ReactNode;
}): ReactElement | null {
  const shown = useLinger(at);
  if (shown.value === undefined) {
    return null;
  }
  return <Layer at={shown.value}>{children(shown.leaving)}</Layer>;
}
