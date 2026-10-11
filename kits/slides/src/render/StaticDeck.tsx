import { useMemo, useRef } from "react";
import { MotionConfig } from "motion/react";
import type { SlideDefinition } from "../core/Slide";
import { CanvasScaler } from "./CanvasScaler";
import { SlideFrame } from "./SlideFrame";
import type { StaticReadyDetail } from "./staticReadiness";
import { useStaticReadiness } from "./useStaticReadiness";

interface StaticDeckProps {
  slides: SlideDefinition[];
  readinessTimeoutMs?: number;
  onReadiness?: (root: HTMLElement, detail: StaticReadyDetail) => void;
}

export function StaticDeck({
  slides,
  readinessTimeoutMs,
  onReadiness,
}: StaticDeckProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const assets = useMemo(
    () => slides.flatMap((slide) => slide.staticAssets),
    [slides],
  );
  useStaticReadiness(rootRef, assets, readinessTimeoutMs, onReadiness);

  return (
    <MotionConfig reducedMotion="always">
      <div
        ref={rootRef}
        className="slide-kit-static"
        data-slide-kit-readiness="pending"
        data-slide-static-root
      >
        {slides.map((slide, index) => (
          <div
            key={slide.id}
            className="slide-kit-static-page"
            data-slide-static-page={index + 1}
          >
            <CanvasScaler staticCanvas surface="static">
              <SlideFrame
                definition={slide}
                slideIndex={index}
                revealedCount={Number.MAX_SAFE_INTEGER}
                surface="static"
              />
            </CanvasScaler>
          </div>
        ))}
      </div>
    </MotionConfig>
  );
}
