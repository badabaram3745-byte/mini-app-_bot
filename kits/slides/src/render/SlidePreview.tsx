import { useRef } from "react";
import { MotionConfig } from "motion/react";
import type { SlideDefinition } from "../core/Slide";
import { CanvasScaler } from "./CanvasScaler";
import { SlideFrame } from "./SlideFrame";
import { useStaticReadiness } from "./useStaticReadiness";

export function SlidePreview({
  slides,
  requestedPage,
}: {
  slides: SlideDefinition[];
  requestedPage: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const parsedPage = Number(requestedPage);
  const slideIndex =
    Number.isInteger(parsedPage) &&
    parsedPage >= 1 &&
    parsedPage <= slides.length
      ? parsedPage - 1
      : 0;
  const slide = slides[slideIndex]!;
  useStaticReadiness(rootRef, slide.staticAssets);

  return (
    <MotionConfig reducedMotion="always">
      <div
        ref={rootRef}
        id={`slide-preview-${slideIndex + 1}`}
        className="slide-kit-preview"
        data-slide-kit-readiness="pending"
        data-slide-preview-page={slideIndex + 1}
        data-slide-preview-root
      >
        <CanvasScaler surface="preview">
          <SlideFrame
            definition={slide}
            slideIndex={slideIndex}
            revealedCount={Number.MAX_SAFE_INTEGER}
            surface="preview"
          />
        </CanvasScaler>
      </div>
    </MotionConfig>
  );
}
