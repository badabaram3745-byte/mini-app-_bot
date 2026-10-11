import type { SlideTransition } from "../core/Slide";

export type SlideTransitionDirection = "forward" | "backward";

export interface ResolvedSlideTransition {
  durationMs: number;
  easing: string;
  newKeyframes: Keyframe[];
}

export const STAGE_VIEW_TRANSITION_NAME = "slide-kit-stage";

const REFINED_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export function resolveSlideTransition(
  transition: SlideTransition | undefined,
  direction: SlideTransitionDirection,
): ResolvedSlideTransition {
  switch (transition ?? "fade") {
    case "none":
      return {
        durationMs: 0,
        easing: "linear",
        newKeyframes: [],
      };
    case "fade":
      return {
        durationMs: 240,
        easing: REFINED_EASING,
        newKeyframes: [{ opacity: 0 }, { opacity: 1 }],
      };
    case "slide":
      return {
        durationMs: 280,
        easing: REFINED_EASING,
        newKeyframes: [
          {
            opacity: 0,
            transform:
              direction === "forward"
                ? "translateX(2.5%)"
                : "translateX(-2.5%)",
          },
          { opacity: 1, transform: "none" },
        ],
      };
  }
}

export function animateSlideTransition(
  transition: ResolvedSlideTransition,
  target: HTMLElement = document.documentElement,
): Animation[] {
  if (
    transition.newKeyframes.length === 0 ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return [];
  }
  return [
    target.animate(transition.newKeyframes, {
      duration: transition.durationMs,
      easing: transition.easing,
      fill: "both",
      pseudoElement: `::view-transition-new(${STAGE_VIEW_TRANSITION_NAME})`,
    }),
  ];
}
