import type {} from "react";

export interface ViewTransitionStyle {
  viewTransitionName?: string;
}

declare module "react" {
  interface CSSProperties extends ViewTransitionStyle {}
}

export type { DeckCursors, DeckProps } from "./core/Deck";
export { Deck } from "./core/Deck";
export type { SlideNavigation } from "./core/deckContext";
export {
  useSlideCount,
  useSlideNavigation,
  useSlideNumber,
} from "./core/deckContext";
export type { NotesProps } from "./core/Notes";
export { Notes } from "./core/Notes";
export type { SupportedLocale } from "./core/locale";
export type { SlideTransition, SlideProps } from "./core/Slide";
export { Slide } from "./core/Slide";
export type { SlideStepsState, StepProps, StepState } from "./core/Step";
export { Step, useSlideSteps, useStep } from "./core/Step";
export type {
  DeckDownloadFormat,
  DeckDownloadOptions,
  DeckDownloads,
} from "./download/deckDownloads";
export { useDeckDownloads } from "./download/deckDownloads";
export { CANVAS_HEIGHT, CANVAS_WIDTH } from "./render/CanvasScaler";
export type { StaticReadyDetail } from "./render/staticReadiness";
export { STATIC_READY_EVENT } from "./render/staticReadiness";
