import { MotionConfig } from "motion/react";
import { useDeckContext } from "../core/deckContext";
import type { SlideDefinition } from "../core/Slide";
import { CanvasScaler } from "./CanvasScaler";
import { SlideFrame } from "./SlideFrame";

export function SlideStage({
  slides,
  flat = false,
}: {
  slides: SlideDefinition[];
  flat?: boolean;
}) {
  const deck = useDeckContext();
  const activeIndex = Math.min(deck.slideIndex, slides.length - 1);
  const definition = slides[activeIndex]!;

  return (
    <CanvasScaler
      className="slide-kit-stage"
      frameClassName={flat ? undefined : "slide-kit-viewer-frame"}
      surface={flat ? "presentation" : "stage"}
    >
      <MotionConfig reducedMotion="user">
        <SlideFrame
          key={definition.id}
          definition={definition}
          slideIndex={activeIndex}
          revealedCount={
            deck.presenting
              ? (deck.revealedBySlide[activeIndex] ?? 0)
              : Number.MAX_SAFE_INTEGER
          }
          surface="stage"
          onStepCountChange={(stepCount) =>
            deck.setStepCount(activeIndex, stepCount)
          }
        />
      </MotionConfig>
    </CanvasScaler>
  );
}
