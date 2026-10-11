import { type ReactNode, useEffect, useMemo, useState } from "react";
import { SlidePositionProvider, useDeckContext } from "../core/deckContext";
import {
  handleKeyboardNavigation,
  shouldIgnoreKeyboardEvent,
} from "../core/keyboardNavigation";
import { useLocalization } from "../core/localization";
import type { SlideDefinition } from "../core/Slide";
import { StepRegistry } from "../core/Step";
import { CanvasScaler } from "../render/CanvasScaler";
import { ControlButton } from "../render/ControlButton";
import { ControlIcon } from "../render/ControlIcon";
import { PresentationInteractionSurface } from "../render/PresentationInteractionLayer";
import type { PresentationInteractionController } from "../render/presentationInteraction";
import { SlideFrame } from "../render/SlideFrame";

export function PresenterMode({
  controller,
  presenterWindow,
  slides,
  startedAt,
}: {
  controller: PresentationInteractionController;
  presenterWindow: Window;
  slides: SlideDefinition[];
  startedAt: number;
}) {
  const deck = useDeckContext();
  const messages = useLocalization();
  const [slideGridOpen, setSlideGridOpen] = useState(false);

  usePresenterKeyboard({
    enabled: !slideGridOpen,
    first: () => deck.goToSlide(1),
    last: () => deck.goToSlide(deck.slideCount),
    next: deck.next,
    presenterWindow,
    previous: deck.previous,
  });

  const slideIndex = Math.min(Math.max(0, deck.slideIndex), slides.length - 1);
  const current = slides[slideIndex]!;

  const revealed = deck.revealedBySlide[slideIndex] ?? 0;
  const stepCount = deck.stepCounts[slideIndex] ?? 0;
  const hasNextStep = revealed < stepCount;
  const nextSlideIndex = hasNextStep ? slideIndex : slideIndex + 1;
  const next = slides[nextSlideIndex] ?? null;
  const nextRevealed = hasNextStep ? revealed + 1 : 0;
  const hasPreviousStep = revealed > 0;
  const previousSlideIndex = hasPreviousStep ? slideIndex : slideIndex - 1;
  const previous = slides[previousSlideIndex] ?? null;
  const previousRevealed = hasPreviousStep
    ? revealed - 1
    : (deck.stepCounts[previousSlideIndex] ?? Number.MAX_SAFE_INTEGER);
  const previousDisabled = slideIndex === 0 && revealed === 0;
  const nextDisabled =
    slideIndex === deck.slideCount - 1 && revealed >= stepCount;

  return (
    <main className="slide-kit-presenter">
      <PresenterHeader />
      <div className="slide-kit-presenter-workspace">
        <section className="slide-kit-presenter-current-panel">
          <PresentationInteractionSurface
            className="slide-kit-presenter-current"
            role="region"
            aria-label={messages.currentSlide}
            controller={controller}
            expandedImageLabel={messages.expandedImage}
            slideIndex={slideIndex}
          >
            <CanvasScaler fit="cover" surface="presenter-current">
              <SlideFrame
                definition={current}
                slideIndex={slideIndex}
                revealedCount={revealed}
                surface="presenter"
              />
            </CanvasScaler>
          </PresentationInteractionSurface>
          <div className="slide-kit-presenter-preview-strip">
            <PresenterPreview
              definition={previous}
              direction="previous"
              disabled={previousDisabled}
              revealedCount={previousRevealed}
              slideIndex={previousSlideIndex}
              label={messages.previous}
              onSelect={deck.previous}
            />
            <PresenterPreview
              definition={next}
              direction="next"
              disabled={nextDisabled}
              revealedCount={nextRevealed}
              slideIndex={nextSlideIndex}
              label={messages.upNext}
              onSelect={deck.next}
            />
          </div>
          <div className="slide-kit-presenter-utility">
            <ElapsedTime
              presenterWindow={presenterWindow}
              startedAt={startedAt}
            />
            <ControlButton
              className="slide-kit-presenter-count"
              aria-label={messages.slides}
              onClick={() => setSlideGridOpen(true)}
            >
              <ControlIcon name="grid" />
              <span>
                {deck.slideIndex + 1} / {deck.slideCount}
              </span>
            </ControlButton>
          </div>
        </section>
        <SpeakerNotes slideIndex={slideIndex}>{current.notes}</SpeakerNotes>
      </div>
      {slideGridOpen ? (
        <PresenterSlideGrid
          activeSlideIndex={slideIndex}
          presenterWindow={presenterWindow}
          slides={slides}
          onClose={() => setSlideGridOpen(false)}
          onSelect={(slideNumber) => {
            deck.goToSlide(slideNumber);
            setSlideGridOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}

function usePresenterKeyboard({
  enabled,
  first,
  last,
  next,
  presenterWindow,
  previous,
}: {
  enabled: boolean;
  first: () => void;
  last: () => void;
  next: () => void;
  presenterWindow: Window;
  previous: () => void;
}) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardEvent(event)) {
        return;
      }
      handleKeyboardNavigation(event, {
        first,
        last,
        next,
        previous,
      });
    };
    presenterWindow.addEventListener("keydown", onKeyDown);
    return () => presenterWindow.removeEventListener("keydown", onKeyDown);
  }, [enabled, first, last, next, presenterWindow, previous]);
}

function PresenterPreview({
  definition,
  direction,
  disabled,
  label,
  revealedCount,
  slideIndex,
  onSelect,
}: {
  definition: SlideDefinition | null;
  direction: "next" | "previous";
  disabled: boolean;
  label: string;
  revealedCount: number;
  slideIndex: number;
  onSelect: () => void;
}) {
  return (
    <section
      className="slide-kit-presenter-preview"
      aria-label={label}
      data-available={definition ? "true" : "false"}
    >
      <div className="slide-kit-presenter-preview-frame">
        {definition ? (
          <CanvasScaler fit="cover" surface="presenter-preview">
            <SlideFrame
              definition={definition}
              slideIndex={slideIndex}
              revealedCount={revealedCount}
              surface="preview"
            />
          </CanvasScaler>
        ) : (
          <span
            className="slide-kit-presenter-preview-empty"
            aria-hidden="true"
          >
            <span
              className={`slide-kit-triangle slide-kit-triangle-${direction}`}
            />
          </span>
        )}
      </div>
      <span className="slide-kit-presenter-preview-label" aria-hidden="true">
        <span>{label}</span>
      </span>
      <button
        type="button"
        aria-label={label}
        disabled={disabled || !definition}
        onClick={onSelect}
      />
    </section>
  );
}

function PresenterSlideGrid({
  activeSlideIndex,
  presenterWindow,
  slides,
  onClose,
  onSelect,
}: {
  activeSlideIndex: number;
  presenterWindow: Window;
  slides: SlideDefinition[];
  onClose: () => void;
  onSelect: (slideNumber: number) => void;
}) {
  const messages = useLocalization();

  useEffect(() => {
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    presenterWindow.addEventListener("keydown", closeFromKeyboard);
    return () =>
      presenterWindow.removeEventListener("keydown", closeFromKeyboard);
  }, [onClose, presenterWindow]);

  return (
    <div
      className="slide-kit-presenter-grid-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="slide-kit-presenter-grid-panel"
        role="dialog"
        aria-modal="true"
        aria-label={messages.slides}
      >
        <header>
          <strong>{messages.slides}</strong>
          <ControlButton iconOnly aria-label={messages.close} onClick={onClose}>
            <ControlIcon name="close" />
          </ControlButton>
        </header>
        <div className="slide-kit-presenter-grid">
          {slides.map((slide, index) => (
            <div
              key={slide.id}
              className="slide-kit-presenter-grid-item"
              data-active={index === activeSlideIndex ? "true" : undefined}
            >
              <span>
                <CanvasScaler fit="cover" surface="presenter-grid">
                  <SlideFrame
                    definition={slide}
                    slideIndex={index}
                    revealedCount={Number.MAX_SAFE_INTEGER}
                    surface="thumbnail"
                  />
                </CanvasScaler>
              </span>
              <button
                type="button"
                aria-label={messages.goToSlideNumber(index + 1)}
                aria-current={index === activeSlideIndex ? "page" : undefined}
                onClick={() => onSelect(index + 1)}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PresenterHeader() {
  const messages = useLocalization();
  return (
    <header className="slide-kit-presenter-header">
      <strong>{messages.presenterView}</strong>
      <span className="slide-kit-presenter-status">
        <span aria-hidden="true" />
        {messages.connected}
      </span>
    </header>
  );
}

function ElapsedTime({
  presenterWindow,
  startedAt,
}: {
  presenterWindow: Window;
  startedAt: number;
}) {
  const messages = useLocalization();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = presenterWindow.setInterval(
      () => setNow(Date.now()),
      1_000,
    );
    return () => presenterWindow.clearInterval(interval);
  }, [presenterWindow]);

  const formatted = useMemo(() => {
    const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, [now, startedAt]);

  return (
    <time
      className="slide-kit-presenter-time"
      aria-label={messages.elapsedTime}
    >
      {formatted}
    </time>
  );
}

function SpeakerNotes({
  children,
  slideIndex,
}: {
  children: ReactNode;
  slideIndex: number;
}) {
  const messages = useLocalization();
  return (
    <SlidePositionProvider slideIndex={slideIndex}>
      <aside
        className="slide-kit-presenter-notes-column"
        role="region"
        aria-label={messages.speakerNotes}
      >
        <div className="slide-kit-presenter-notes">
          <StepRegistry mode="static" revealedCount={Number.MAX_SAFE_INTEGER}>
            <div>{children ?? <span>{messages.noNotes}</span>}</div>
          </StepRegistry>
        </div>
      </aside>
    </SlidePositionProvider>
  );
}
