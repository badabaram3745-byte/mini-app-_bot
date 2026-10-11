import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { type HTMLMotionProps } from "motion/react";
import { type CSSProperties, type ReactNode, type RefObject } from "react";

export interface ViewTransitionStyle {
    viewTransitionName?: string;
}
declare module "react" {
    interface CSSProperties extends ViewTransitionStyle {
    }
}

/** Which of `enabled`, `chat` and `selection` to turn off; all three are on by default. */
export interface DeckCursors {
    /** Everyone else's pointer over the slide they share and the space around it. */
    enabled?: boolean;
    /** `/` types a message everyone sees at your cursor. */
    chat?: boolean;
    /** Text you select on a slide is highlighted for everyone else on it. */
    selection?: boolean;
}
export interface DeckProps {
    children: ReactNode;
    className?: string;
    /** In a live artifact, the cursors of the people on the same slide. */
    cursors?: DeckCursors;
    locale?: string;
    style?: CSSProperties;
}
export declare function Deck({ children, className, cursors, locale, style, }: DeckProps): import("react/jsx-runtime").JSX.Element;

export type SlideTransition = "none" | "fade" | "slide";
export interface SlideProps extends Pick<HTMLAttributes<HTMLDivElement>, "className" | "style"> {
    children?: ReactNode;
    staticAssets?: readonly string[];
    transition?: SlideTransition;
}
/** One slide of a `Deck`. Its children are what the audience sees; put `Step`s inside for the clicks and `Notes` for what the presenter says. */
export declare function Slide({ children }: SlideProps): import("react/jsx-runtime").JSX.Element;
interface SlideDefinition {
    id: string;
    content: ReactNode;
    notes: ReactNode | null;
    className?: string;
    style?: CSSProperties;
    staticAssets: readonly string[];
    transition?: SlideTransition;
}

export interface SlideNavigation {
    next: () => void;
    previous: () => void;
    goToSlide: (slideNumber: number) => void;
}
interface DeckContextValue extends SlideNavigation {
    slideIndex: number;
    slideCount: number;
    revealedCount: number;
    revealedBySlide: number[];
    stepCounts: number[];
    setStepCount: (slideIndex: number, stepCount: number) => void;
    /** Steps reveal one beat at a time while presenting; elsewhere all of them show at once. */
    presenting: boolean;
    setPresenting: (presenting: boolean) => void;
}
declare function useDeckController(slides: SlideDefinition[], rootRef: RefObject<HTMLDivElement | null>): DeckContextValue;
declare function DeckProvider({ value, children, }: {
    value: DeckContextValue;
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
declare function SlidePositionProvider({ slideIndex, children, }: {
    slideIndex: number;
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
declare function useDeckContext(): DeckContextValue;
export declare function useSlideNumber(): number;
export declare function useSlideCount(): number;
export declare function useSlideNavigation(): SlideNavigation;

export interface NotesProps {
    children: ReactNode;
}
/** The speaker notes of the surrounding `Slide`; the presenter sees them, the audience never does. */
export declare function Notes(_props: NotesProps): null;

export type SupportedLocale = "de" | "en" | "es" | "fr" | "ja" | "ko" | "pt" | "zh-CN" | "zh-TW";
declare function resolveLocale(requestedLocale?: string): SupportedLocale;

type StepMode = "controlled" | "interactive" | "static";
interface StepRegistryProps {
    children: ReactNode;
    mode: StepMode;
    revealedCount: number;
    onStepCountChange?: (stepCount: number) => void;
}
declare function StepRegistry({ children, mode, revealedCount, onStepCountChange, }: StepRegistryProps): import("react/jsx-runtime").JSX.Element;
export interface SlideStepsState {
    /** How many of the slide's steps are revealed so far. */
    revealed: number;
    total: number;
    /** True on the audience stage and the presenter's current slide, where animations play; other surfaces render the final pose at once. */
    interactive: boolean;
}
/** The slide's reveal state, for content outside a `Step` that reacts to reveals; on static surfaces every step counts as revealed. */
export declare function useSlideSteps(): SlideStepsState;
export interface StepState {
    visible: boolean;
    /** The surrounding `Step`'s position among the slide's steps, in reveal order. */
    index: number;
}
/** The state of the nearest surrounding Step. */
export declare function useStep(): StepState;
export interface StepProps extends Omit<HTMLMotionProps<"div">, "animate" | "initial" | "variants"> {
    /** What appears when the presenter clicks; leave empty for a click that only advances `useSlideSteps()`. */
    children?: ReactNode;
}
export declare function Step({ children, transition, ...props }: StepProps): import("react/jsx-runtime").JSX.Element;

export type DeckDownloadFormat = "pdf" | "pptx";
export interface DeckDownloadOptions {
    filename?: string;
    readinessTimeoutMs?: number;
}
export interface DeckDownloads {
    downloadDeck: (format: DeckDownloadFormat, options?: DeckDownloadOptions) => Promise<void>;
    downloadPdf: (options?: DeckDownloadOptions) => Promise<void>;
    downloadPptx: (options?: DeckDownloadOptions) => Promise<void>;
}
declare function DeckDownloadProvider({ children, slides, }: {
    children: ReactNode;
    slides: SlideDefinition[];
}): import("react/jsx-runtime").JSX.Element;
export declare function useDeckDownloads(): DeckDownloads;

export declare const CANVAS_WIDTH = 1920;
export declare const CANVAS_HEIGHT = 1080;
interface CanvasScalerProps {
    children: ReactNode;
    className?: string;
    fit?: "contain" | "cover";
    frameClassName?: string;
    staticCanvas?: boolean;
    surface: string;
}
declare function CanvasScaler({ children, className, fit, frameClassName, staticCanvas, surface, }: CanvasScalerProps): import("react/jsx-runtime").JSX.Element;

export declare const STATIC_READY_EVENT = "slide-kit:static-ready";
interface StaticReadinessOptions {
    assets?: readonly string[];
    signal?: AbortSignal;
    timeoutMs?: number;
}
export interface StaticReadyDetail {
    status: "ready" | "error";
    error?: string;
}
declare function waitForStaticReadiness(root: HTMLElement, { assets, signal: externalSignal, timeoutMs, }?: StaticReadinessOptions): Promise<void>;
declare function publishStaticReadiness(root: HTMLElement, detail: StaticReadyDetail): void;
