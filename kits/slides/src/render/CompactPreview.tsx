import type { SlideDefinition } from "../core/Slide";
import { useLocalization } from "../core/localization";
import { CanvasScaler } from "./CanvasScaler";
import { SlideFrame } from "./SlideFrame";

export function CompactPreview({ slide }: { slide: SlideDefinition }) {
  const messages = useLocalization();
  return (
    <main
      className="slide-kit-compact-preview"
      aria-label={messages.slidePreview}
    >
      <CanvasScaler surface="compact-preview">
        <SlideFrame
          definition={slide}
          slideIndex={0}
          revealedCount={Number.MAX_SAFE_INTEGER}
          surface="preview"
        />
      </CanvasScaler>
    </main>
  );
}
