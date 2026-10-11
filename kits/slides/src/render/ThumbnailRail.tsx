import {
  type RefCallback,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useDeckContext } from "../core/deckContext";
import { getOwnerWindow } from "../core/domEnvironment";
import { useLocalization } from "../core/localization";
import type { SlideDefinition } from "../core/Slide";
import { CanvasScaler } from "./CanvasScaler";
import { SlideFrame } from "./SlideFrame";
import { SlideViewers } from "./SlideViewers";

const SCROLL_MARGIN_PX = 12;

const ACTIVE_THUMBNAIL_SELECTOR = '.slide-kit-thumbnail[data-active="true"]';

export function ThumbnailRail({
  slides,
  collapsed,
}: {
  slides: SlideDefinition[];
  collapsed: boolean;
}) {
  const deck = useDeckContext();
  const messages = useLocalization();
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null);
  const rootRef: RefCallback<HTMLElement> = useCallback((element) => {
    setRootElement(element);
  }, []);
  useActiveThumbnailInView(rootElement, deck.slideIndex, collapsed);

  return (
    <aside className="slide-kit-thumbnail-panel" aria-label={messages.slides}>
      <div ref={rootRef} className="slide-kit-thumbnails">
        {slides.map((slide, index) => (
          <LazyThumbnail
            key={slide.id}
            definition={slide}
            slideIndex={index}
            active={index === deck.slideIndex}
            rootElement={rootElement}
            selectLabel={messages.goToSlideNumber(index + 1)}
            onSelect={() => deck.goToSlide(index + 1)}
          />
        ))}
      </div>
    </aside>
  );
}

function useActiveThumbnailInView(
  rail: HTMLElement | null,
  slideIndex: number,
  collapsed: boolean,
): void {
  const scrolledOnce = useRef(false);

  useEffect(() => {
    if (!rail || collapsed) {
      scrolledOnce.current = false;
      return;
    }
    const active = rail.querySelector<HTMLElement>(ACTIVE_THUMBNAIL_SELECTOR);
    if (!active) {
      return;
    }
    const animated =
      scrolledOnce.current &&
      !getOwnerWindow(rail).matchMedia("(prefers-reduced-motion: reduce)")
        .matches;
    scrollThumbnailIntoRail(rail, active, animated ? "smooth" : "auto");
    scrolledOnce.current = true;
  }, [collapsed, rail, slideIndex]);
}

function scrollThumbnailIntoRail(
  rail: HTMLElement,
  thumbnail: HTMLElement,
  behavior: ScrollBehavior,
): void {
  const railBox = rail.getBoundingClientRect();
  const thumbnailBox = thumbnail.getBoundingClientRect();
  const top = railScrollOffset(
    rail.scrollTop,
    thumbnailBox.top - railBox.top,
    thumbnailBox.height,
    railBox.height,
  );
  const left = railScrollOffset(
    rail.scrollLeft,
    thumbnailBox.left - railBox.left,
    thumbnailBox.width,
    railBox.width,
  );
  if (top === rail.scrollTop && left === rail.scrollLeft) {
    return;
  }
  rail.scrollTo({ behavior, left, top });
}

function railScrollOffset(
  scrollOffset: number,
  thumbnailOffset: number,
  thumbnailSize: number,
  railSize: number,
): number {
  if (thumbnailOffset < SCROLL_MARGIN_PX) {
    return scrollOffset + thumbnailOffset - SCROLL_MARGIN_PX;
  }
  const overflow =
    thumbnailOffset + thumbnailSize + SCROLL_MARGIN_PX - railSize;
  return overflow > 0 ? scrollOffset + overflow : scrollOffset;
}

function LazyThumbnail({
  definition,
  slideIndex,
  active,
  rootElement,
  selectLabel,
  onSelect,
}: {
  definition: SlideDefinition;
  slideIndex: number;
  active: boolean;
  rootElement: HTMLElement | null;
  selectLabel: string;
  onSelect: () => void;
}) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(active);

  useEffect(() => {
    const element = buttonRef.current;
    if (!element || !rootElement) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(Boolean(entry?.isIntersecting));
      },
      { root: rootElement, rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootElement]);

  return (
    <div
      ref={buttonRef}
      className="slide-kit-thumbnail"
      data-active={active ? "true" : undefined}
    >
      <span className="slide-kit-thumbnail-frame">
        {visible || active ? (
          <CanvasScaler fit="cover" surface="thumbnail">
            <SlideFrame
              definition={definition}
              slideIndex={slideIndex}
              revealedCount={Number.MAX_SAFE_INTEGER}
              surface="thumbnail"
            />
          </CanvasScaler>
        ) : null}
      </span>
      <SlideViewers
        className="slide-kit-thumbnail-viewers"
        size={18}
        slideNumber={slideIndex + 1}
      />
      <button
        type="button"
        className="slide-kit-thumbnail-action"
        aria-label={selectLabel}
        aria-current={active ? "page" : undefined}
        disabled={active}
        onClick={onSelect}
      />
    </div>
  );
}
