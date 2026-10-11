import { type HTMLAttributes, useLayoutEffect, useRef } from "react";
import { MotionConfig } from "motion/react";
import { SlidePositionProvider, useDeckContext } from "../core/deckContext";
import { useLocalization } from "../core/localization";
import type { SlideDefinition } from "../core/Slide";
import { StepRegistry, type StepMode } from "../core/Step";

type SlideFrameSurface =
  | "stage"
  | "thumbnail"
  | "preview"
  | "presenter"
  | "static";

interface SlideFrameProps {
  definition: SlideDefinition;
  slideIndex: number;
  revealedCount: number;
  surface: SlideFrameSurface;
  onStepCountChange?: (stepCount: number) => void;
}

export function SlideFrame({
  definition,
  slideIndex,
  revealedCount,
  surface,
  onStepCountChange,
}: SlideFrameProps) {
  const deck = useDeckContext();
  const messages = useLocalization();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stepMode = resolveStepMode(surface);
  const inactive =
    surface !== "stage" && surface !== "preview" && surface !== "static";

  useLayoutEffect(() => {
    /* istanbul ignore else -- React assigns the slide host before layout effects. */
    if (rootRef.current) {
      rootRef.current.inert = inactive;
    }
  }, [inactive]);

  const inertProps = inactive
    ? ({ "aria-hidden": true } satisfies HTMLAttributes<HTMLDivElement>)
    : {};

  return (
    <SlidePositionProvider slideIndex={slideIndex}>
      <MotionConfig skipAnimations={stepMode !== "interactive"}>
        <StepRegistry
          mode={stepMode}
          revealedCount={revealedCount}
          onStepCountChange={onStepCountChange}
        >
          <div
            {...inertProps}
            ref={rootRef}
            role="group"
            aria-label={messages.slideLabel(slideIndex + 1, deck.slideCount)}
            aria-current={surface === "stage" ? "page" : undefined}
            className={`slide-kit-slide ${definition.className ?? ""}`.trim()}
            data-slide-number={slideIndex + 1}
            style={definition.style}
          >
            {definition.content}
          </div>
        </StepRegistry>
      </MotionConfig>
    </SlidePositionProvider>
  );
}

function resolveStepMode(surface: SlideFrameSurface): StepMode {
  switch (surface) {
    case "stage":
    case "presenter":
      return "interactive";
    case "preview":
      return "controlled";
    case "thumbnail":
    case "static":
      return "static";
  }
}
