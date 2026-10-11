import { useDeckContext } from "../core/deckContext";
import { useLocalization } from "../core/localization";
import type { SlideDefinition } from "../core/Slide";
import { SlideViewers } from "./SlideViewers";

export function SlideProgressRail({
  slides,
  visible,
}: {
  slides: SlideDefinition[];
  visible: boolean;
}) {
  const deck = useDeckContext();
  const messages = useLocalization();

  return (
    <nav
      className="slide-kit-progress-rail"
      aria-hidden={visible ? undefined : true}
      aria-label={messages.slides}
      data-visible={visible ? "true" : undefined}
    >
      {slides.map((slide, index) => (
        <button
          key={slide.id}
          type="button"
          aria-current={index === deck.slideIndex ? "page" : undefined}
          aria-label={messages.goToSlideNumber(index + 1)}
          tabIndex={visible ? 0 : -1}
          onClick={() => deck.goToSlide(index + 1)}
        >
          <SlideViewers
            className="slide-kit-progress-viewers"
            size={14}
            slideNumber={index + 1}
          />
        </button>
      ))}
    </nav>
  );
}
