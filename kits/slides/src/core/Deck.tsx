import {
  type CSSProperties,
  type RefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Cursors } from "@kits/sync";
import {
  DeckDownloadProvider,
  type DeckDownloadFormat,
  useDeckDownloads,
} from "../download/deckDownloads";
import { PresenterMode } from "../presenter/PresenterMode";
import {
  openPresenterPopup,
  PresenterPopupPortal,
  type PresenterPopupTarget,
} from "../presenter/PresenterPopupPortal";
import { AudiencePresentation } from "../render/AudiencePresentation";
import { CompactPreview } from "../render/CompactPreview";
import { ControlButton } from "../render/ControlButton";
import { ControlIcon } from "../render/ControlIcon";
import { FloatingDeckControls } from "../render/FloatingDeckControls";
import { usePresentationInteractionController } from "../render/PresentationInteractionLayer";
import { GridDeck } from "../render/GridDeck";
import { SlideProgressRail } from "../render/SlideProgressRail";
import { SlideStage } from "../render/SlideStage";
import { SlidePreview } from "../render/SlidePreview";
import { StaticDeck } from "../render/StaticDeck";
import { ThumbnailRail } from "../render/ThumbnailRail";
import { useSlideGestureNavigation } from "../render/useSlideGestureNavigation";
import { DeckProvider, useDeckController, useDeckContext } from "./deckContext";
import {
  handleKeyboardNavigation,
  shouldIgnoreKeyboardEvent,
} from "./keyboardNavigation";
import { LocalizationProvider, useLocalization } from "./localization";
import { resolveLocale } from "./locale";
import { normalizeDeck } from "./normalizeDeck";
import type { SlideDefinition } from "./Slide";
import { useAnnounceSlide } from "./slidePresence";

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

export function Deck({
  children,
  className,
  cursors,
  locale,
  style,
}: DeckProps) {
  const resolvedLocale = resolveLocale(locale);
  const slides = useMemo(() => normalizeDeck(children), [children]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const controller = useDeckController(slides, rootRef);
  const mode = useRequestedMode();

  return (
    <LocalizationProvider locale={resolvedLocale}>
      <DeckProvider value={controller}>
        <div
          ref={rootRef}
          className={`slide-kit-root ${className ?? ""}`.trim()}
          data-theme="light"
          lang={resolvedLocale}
          style={style}
        >
          <DeckDownloadProvider slides={slides}>
            {mode.type === "static" ? (
              <StaticDeck slides={slides} />
            ) : mode.type === "preview" ? (
              <SlidePreview
                slides={slides}
                requestedPage={mode.requestedPage}
              />
            ) : mode.type === "grid" ? (
              <GridDeck slides={slides} />
            ) : (
              <AudienceMode
                cursors={cursors}
                slides={slides}
                rootRef={rootRef}
              />
            )}
          </DeckDownloadProvider>
        </div>
      </DeckProvider>
    </LocalizationProvider>
  );
}

function AudienceMode({
  cursors: { enabled = true, chat = true, selection = true } = {},
  slides,
  rootRef,
}: {
  cursors?: DeckCursors;
  slides: SlideDefinition[];
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const messages = useLocalization();
  const { goToSlide, setPresenting, slideIndex } = useDeckContext();
  useAnnounceSlide(slideIndex + 1);
  const compactPreview = useCompactPreview();
  const [fullscreen, setFullscreen] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [presenterTarget, setPresenterTarget] =
    useState<PresenterPopupTarget | null>(null);
  const [presenterError, setPresenterError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadFormat, setDownloadFormat] =
    useState<DeckDownloadFormat | null>(null);
  const [thumbnailsCollapsed, setThumbnailsCollapsed] =
    useThumbnailsCollapsedPreference();
  const [thumbnailsMotionReady, setThumbnailsMotionReady] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const startedAtRef = useRef(Date.now());
  const presentationInteraction = usePresentationInteractionController();
  const { downloadDeck } = useDeckDownloads();

  const startPresentation = useCallback(
    (openFullscreen: boolean) => {
      goToSlide(slideIndex + 1);
      presentationInteraction.dispatch({ type: "reset" });
      startedAtRef.current = Date.now();
      setPresentationOpen(true);
      if (openFullscreen) {
        rootRef.current?.requestFullscreen?.().catch(ignoreFullscreenError);
      }
    },
    [goToSlide, presentationInteraction, rootRef, slideIndex],
  );

  const closePresentation = useCallback(() => {
    presentationInteraction.dispatch({ type: "reset" });
    setPresentationOpen(false);
    const presentationDocument = rootRef.current?.ownerDocument;
    if (presentationDocument?.fullscreenElement) {
      presentationDocument.exitFullscreen?.().catch(ignoreFullscreenError);
    }
  }, [presentationInteraction, rootRef]);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    const presentationDocument = root?.ownerDocument;
    /* istanbul ignore if -- Audience controls require a mounted deck root. */
    if (!root || !presentationDocument) {
      return;
    }
    if (presentationDocument.fullscreenElement) {
      presentationDocument.exitFullscreen?.().catch(ignoreFullscreenError);
    } else {
      root.requestFullscreen?.().catch(ignoreFullscreenError);
    }
  }, [rootRef]);

  const openPresenter = useCallback(() => {
    const root = rootRef.current;
    /* istanbul ignore if -- Audience controls require a mounted deck root. */
    if (!root) {
      return;
    }
    if (presenterTarget && !presenterTarget.popupWindow.closed) {
      presenterTarget.popupWindow.focus();
      startedAtRef.current = Date.now();
      presentationInteraction.dispatch({ type: "reset" });
      setPresenterError(null);
      setPresentationOpen(true);
      return;
    }
    const target = openPresenterPopup(root, messages.presenterView);
    if (!target) {
      setPresenterError(messages.popupBlocked);
      return;
    }
    startedAtRef.current = Date.now();
    presentationInteraction.dispatch({ type: "reset" });
    setPresenterError(null);
    setPresentationOpen(true);
    setPresenterTarget(target);
  }, [
    messages.popupBlocked,
    messages.presenterView,
    presentationInteraction,
    presenterTarget,
    rootRef,
  ]);

  const closePresenter = useCallback((target: PresenterPopupTarget) => {
    setPresenterTarget((current) => (current === target ? null : current));
  }, []);

  const startDownload = useCallback(
    async (format: DeckDownloadFormat) => {
      if (downloadFormat) {
        return;
      }
      setDownloadFormat(format);
      setDownloadError(null);
      try {
        await downloadDeck(format);
      } catch (error: unknown) {
        setDownloadError(
          error instanceof Error
            ? `${messages.downloadFailed} ${error.message}`
            : messages.downloadFailed,
        );
      } finally {
        setDownloadFormat(null);
      }
    },
    [downloadDeck, downloadFormat, messages.downloadFailed],
  );

  useLayoutEffect(() => {
    setPresenting(presentationOpen || presenterTarget !== null);
  }, [presentationOpen, presenterTarget, setPresenting]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      setThumbnailsMotionReady(true),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const presentationDocument = rootRef.current?.ownerDocument;
    /* istanbul ignore if -- The effect only runs for a mounted deck root. */
    if (!presentationDocument) {
      return;
    }
    const onFullscreenChange = () =>
      setFullscreen(Boolean(presentationDocument.fullscreenElement));
    onFullscreenChange();
    presentationDocument.addEventListener(
      "fullscreenchange",
      onFullscreenChange,
    );
    return () =>
      presentationDocument.removeEventListener(
        "fullscreenchange",
        onFullscreenChange,
      );
  }, [rootRef]);

  useDeckKeyboard({
    enabled: !compactPreview,
    onPresent: presentationOpen
      ? toggleFullscreen
      : () => startPresentation(true),
    onPresenter: openPresenter,
    onClose: closePresentation,
    presentationOpen,
  });
  useSlideGestureNavigation({
    enabled: !compactPreview && !presentationOpen,
    rootRef: mainRef,
  });

  if (compactPreview) {
    return <CompactPreview slide={slides[0]!} />;
  }

  return (
    <>
      {presenterTarget ? (
        <PresenterPopupPortal target={presenterTarget} onClose={closePresenter}>
          <PresenterMode
            controller={presentationInteraction}
            presenterWindow={presenterTarget.popupWindow}
            slides={slides}
            startedAt={startedAtRef.current}
          />
        </PresenterPopupPortal>
      ) : null}
      {presentationOpen ? (
        <AudiencePresentation
          controller={presentationInteraction}
          fullscreen={fullscreen}
          slides={slides}
          onClose={closePresentation}
          onToggleFullscreen={toggleFullscreen}
        />
      ) : (
        <section
          className="slide-kit-viewer"
          data-thumbnails-collapsed={thumbnailsCollapsed ? "true" : undefined}
          data-thumbnails-motion-ready={
            thumbnailsMotionReady ? "true" : undefined
          }
        >
          <ThumbnailRail collapsed={thumbnailsCollapsed} slides={slides} />
          <main ref={mainRef} className="slide-kit-main">
            <SlideStage slides={slides} />
            {enabled && (
              <Cursors
                chat={chat}
                frame=".slide-kit-canvas-geometry"
                region={`slide-${slideIndex + 1}`}
                selection={selection}
              />
            )}
          </main>
          <ControlButton
            iconOnly
            className="slide-kit-thumbnail-toggle"
            aria-expanded={!thumbnailsCollapsed}
            aria-label={
              thumbnailsCollapsed
                ? messages.showThumbnails
                : messages.hideThumbnails
            }
            title={
              thumbnailsCollapsed
                ? messages.showThumbnails
                : messages.hideThumbnails
            }
            onClick={() => setThumbnailsCollapsed(!thumbnailsCollapsed)}
          >
            <ControlIcon
              name={
                thumbnailsCollapsed ? "panel-left-open" : "panel-left-close"
              }
            />
          </ControlButton>
          <SlideProgressRail slides={slides} visible={thumbnailsCollapsed} />
          <FloatingDeckControls
            downloadFormat={downloadFormat}
            onDownload={(format) => void startDownload(format)}
            onPresent={() => startPresentation(true)}
            onPresenter={openPresenter}
          />
        </section>
      )}
      {presenterError || downloadError || downloadFormat ? (
        <div
          className="slide-kit-toast"
          role={presenterError || downloadError ? "alert" : "status"}
        >
          {presenterError ??
            downloadError ??
            `${messages.preparingDownload} ${downloadFormat?.toUpperCase()}`}
        </div>
      ) : null}
    </>
  );
}

function useDeckKeyboard({
  enabled,
  presentationOpen,
  onPresent,
  onPresenter,
  onClose,
}: {
  enabled: boolean;
  presentationOpen: boolean;
  onPresent: () => void;
  onPresenter: () => void;
  onClose: () => void;
}) {
  const controller = useDeckContext();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardEvent(event)) {
        return;
      }
      if (
        handleKeyboardNavigation(event, {
          first: () => controller.goToSlide(1),
          last: () => controller.goToSlide(controller.slideCount),
          next: controller.next,
          previous: controller.previous,
        })
      ) {
        return;
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        onPresent();
      } else if (event.key === "p" || event.key === "P") {
        event.preventDefault();
        onPresenter();
      } else if (event.key === "Escape" && presentationOpen) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controller, enabled, presentationOpen, onPresent, onPresenter, onClose]);
}

function ignoreFullscreenError() {
  return undefined;
}

const THUMBNAILS_COLLAPSED_STORAGE_KEY = "slide-kit:thumbnails-collapsed";

function useThumbnailsCollapsedPreference(): [
  boolean,
  (collapsed: boolean) => void,
] {
  const [collapsed, setCollapsedState] = useState(
    readThumbnailsCollapsedPreference,
  );
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    writeThumbnailsCollapsedPreference(next);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === THUMBNAILS_COLLAPSED_STORAGE_KEY ||
        event.key === null
      ) {
        setCollapsedState(event.newValue === "true");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return [collapsed, setCollapsed];
}

function readThumbnailsCollapsedPreference(): boolean {
  /* istanbul ignore if -- Server rendering has no local storage. */
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return (
      window.localStorage.getItem(THUMBNAILS_COLLAPSED_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

function writeThumbnailsCollapsedPreference(collapsed: boolean): void {
  try {
    window.localStorage.setItem(
      THUMBNAILS_COLLAPSED_STORAGE_KEY,
      String(collapsed),
    );
  } catch {
    // Storage can be unavailable in sandboxed artifact hosts.
  }
}

const PHONE_PORTRAIT_WIDTH = 320;
const PHONE_PORTRAIT_HEIGHT = 568;

function useCompactPreview(): boolean {
  const [compact, setCompact] = useState(readCompactPreview);
  useEffect(() => {
    const onResize = () => setCompact(readCompactPreview());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return compact;
}

function readCompactPreview(): boolean {
  /* istanbul ignore if -- Server rendering has no viewport. */
  if (typeof window === "undefined") {
    return false;
  }
  const { innerHeight, innerWidth } = window;
  return (
    (innerWidth < PHONE_PORTRAIT_WIDTH &&
      innerHeight < PHONE_PORTRAIT_HEIGHT) ||
    (innerWidth < PHONE_PORTRAIT_HEIGHT && innerHeight < PHONE_PORTRAIT_WIDTH)
  );
}

type RequestedMode =
  | { type: "audience" }
  | { type: "preview"; requestedPage: string }
  | { type: "static" }
  | { type: "grid" };

type ReviewSurface = "audience" | "grid" | "static" | `preview-page:${string}`;

const PREVIEW_PAGE_HASH_PATTERN = /^slide-preview-(\d+)$/;

function useRequestedMode(): RequestedMode {
  const reviewSurface = useSyncExternalStore(
    subscribeToHash,
    readReviewSurface,
    () => "audience" as const,
  );
  if (reviewSurface.startsWith("preview-page:")) {
    return {
      type: "preview",
      requestedPage: reviewSurface.slice("preview-page:".length),
    };
  }
  if (reviewSurface === "static") {
    return { type: "static" };
  }
  return reviewSurface === "grid" ? { type: "grid" } : { type: "audience" };
}

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readReviewSurface(): ReviewSurface {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "slide-preview-grid") {
    return "grid";
  }
  if (hash === "slide-static") {
    return "static";
  }
  const previewPage = hash.match(PREVIEW_PAGE_HASH_PATTERN)?.[1];
  if (previewPage) {
    return `preview-page:${previewPage}`;
  }
  return "audience";
}
