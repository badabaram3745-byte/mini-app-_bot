import { useEffect, useState } from "react";
import { useDeckContext } from "../core/deckContext";
import { useLocalization } from "../core/localization";
import type { SlideDefinition } from "../core/Slide";
import { ControlButton } from "./ControlButton";
import { ControlIcon } from "./ControlIcon";
import { PresentationInteractionSurface } from "./PresentationInteractionLayer";
import type { PresentationInteractionController } from "./presentationInteraction";
import { SlideStage } from "./SlideStage";

export function AudiencePresentation({
  controller,
  fullscreen,
  slides,
  onClose,
  onToggleFullscreen,
}: {
  controller: PresentationInteractionController;
  fullscreen: boolean;
  slides: SlideDefinition[];
  onClose: () => void;
  onToggleFullscreen: () => void;
}) {
  const deck = useDeckContext();
  const messages = useLocalization();
  const controlsVisible = useAutoHidingControls();
  const previousDisabled = deck.slideIndex === 0 && deck.revealedCount === 0;
  const nextDisabled =
    deck.slideIndex === deck.slideCount - 1 &&
    deck.revealedCount >= (deck.stepCounts[deck.slideIndex] ?? 0);

  return (
    <section
      className="slide-kit-presentation"
      data-controls-visible={controlsVisible ? "true" : "false"}
      aria-label={messages.presentation}
    >
      <PresentationInteractionSurface
        className="slide-kit-presentation-surface"
        controller={controller}
        expandedImageLabel={messages.expandedImage}
        modalImageFocus
        slideIndex={deck.slideIndex}
      >
        <SlideStage slides={slides} flat />
        <nav
          className="slide-kit-presentation-controls"
          data-presentation-regular-cursor
          aria-label={messages.presentationControls}
        >
          <div className="slide-kit-control-pill slide-kit-presentation-navigation">
            <ControlButton
              iconOnly
              aria-label={messages.previous}
              disabled={previousDisabled}
              onClick={deck.previous}
            >
              <ControlIcon name="previous" />
            </ControlButton>
            <span aria-label={messages.slidePosition}>
              {deck.slideIndex + 1} / {deck.slideCount}
            </span>
            <ControlButton
              iconOnly
              aria-label={messages.next}
              disabled={nextDisabled}
              onClick={deck.next}
            >
              <ControlIcon name="next" />
            </ControlButton>
          </div>
          <ControlButton
            iconOnly
            variant="primary"
            className="slide-kit-presentation-mode-action"
            aria-label={fullscreen ? messages.close : messages.enterFullscreen}
            title={fullscreen ? messages.close : messages.enterFullscreen}
            onClick={fullscreen ? onClose : onToggleFullscreen}
          >
            <ControlIcon name={fullscreen ? "close" : "fullscreen"} />
          </ControlButton>
        </nav>
      </PresentationInteractionSurface>
    </section>
  );
}

function useAutoHidingControls(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let timeout: number | undefined;
    const showControls = () => {
      setVisible(true);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setVisible(false), 2_000);
    };
    showControls();
    window.addEventListener("pointermove", showControls);
    window.addEventListener("touchstart", showControls);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pointermove", showControls);
      window.removeEventListener("touchstart", showControls);
    };
  }, []);

  return visible;
}
