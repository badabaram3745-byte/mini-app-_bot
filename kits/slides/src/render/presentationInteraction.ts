import { getOwnerWindow } from "../core/domEnvironment";

export const PRESENTATION_CURSOR_IDLE_MS = 2_000;

export interface NormalizedPoint {
  x: number;
  y: number;
}

export type PresentationCursorKind = "magnifier" | "pointer";

export type PresentationInteractionAction =
  | {
      type: "move";
      slideIndex: number;
      point: NormalizedPoint;
      cursor: PresentationCursorKind;
    }
  | { type: "leave" }
  | { type: "openImage"; slideIndex: number; imageIndex: number }
  | { type: "closeImage" }
  | { type: "reset" };

export interface PresentationInteractionSnapshot {
  cursor: {
    kind: PresentationCursorKind;
    point: NormalizedPoint;
    slideIndex: number;
  } | null;
  focusedImage: { slideIndex: number; imageIndex: number } | null;
}

export interface PresentationInteractionController {
  destroy: () => void;
  dispatch: (action: PresentationInteractionAction) => void;
  getSnapshot: () => PresentationInteractionSnapshot;
  subscribe: (listener: () => void) => () => void;
}

const EMPTY_SNAPSHOT: PresentationInteractionSnapshot = {
  cursor: null,
  focusedImage: null,
};

export function createPresentationInteractionController(): PresentationInteractionController {
  let snapshot = EMPTY_SNAPSHOT;
  let pendingMove: Extract<
    PresentationInteractionAction,
    { type: "move" }
  > | null = null;
  let animationFrame: number | null = null;
  let idleTimeout: number | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: PresentationInteractionSnapshot) => {
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const clearAnimationFrame = () => {
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    pendingMove = null;
  };

  const clearIdleTimeout = () => {
    if (idleTimeout !== null) {
      window.clearTimeout(idleTimeout);
      idleTimeout = null;
    }
  };

  const hideCursor = () => {
    clearAnimationFrame();
    clearIdleTimeout();
    if (snapshot.cursor) {
      publish({ ...snapshot, cursor: null });
    }
  };

  const scheduleIdle = () => {
    clearIdleTimeout();
    idleTimeout = window.setTimeout(hideCursor, PRESENTATION_CURSOR_IDLE_MS);
  };

  const dispatch = (action: PresentationInteractionAction) => {
    switch (action.type) {
      case "move": {
        pendingMove = {
          ...action,
          point: normalizePoint(action.point),
          cursor: snapshot.focusedImage ? "pointer" : action.cursor,
        };
        scheduleIdle();
        if (animationFrame === null) {
          animationFrame = window.requestAnimationFrame(() => {
            animationFrame = null;
            const move = pendingMove;
            pendingMove = null;
            if (move) {
              publish({
                ...snapshot,
                cursor: {
                  kind: move.cursor,
                  point: move.point,
                  slideIndex: move.slideIndex,
                },
              });
            }
          });
        }
        break;
      }
      case "leave":
        hideCursor();
        break;
      case "openImage":
        if (action.slideIndex >= 0 && action.imageIndex >= 0) {
          const pendingCursor = pendingMove
            ? {
                kind: "pointer" as const,
                point: pendingMove.point,
                slideIndex: pendingMove.slideIndex,
              }
            : null;
          clearAnimationFrame();
          publish({
            ...snapshot,
            cursor:
              pendingCursor ??
              (snapshot.cursor
                ? { ...snapshot.cursor, kind: "pointer" }
                : null),
            focusedImage: {
              slideIndex: action.slideIndex,
              imageIndex: action.imageIndex,
            },
          });
        }
        break;
      case "closeImage":
        if (snapshot.focusedImage) {
          publish({ ...snapshot, focusedImage: null });
        }
        break;
      case "reset":
        clearAnimationFrame();
        clearIdleTimeout();
        if (snapshot !== EMPTY_SNAPSHOT) {
          publish(EMPTY_SNAPSHOT);
        }
        break;
    }
  };

  return {
    destroy: () => {
      clearAnimationFrame();
      clearIdleTimeout();
      listeners.clear();
    },
    dispatch,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface InspectedPresentationPoint {
  imageIndex: number | null;
  move: Extract<PresentationInteractionAction, { type: "move" }>;
}

export function inspectPresentationPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
  slideIndex: number,
): InspectedPresentationPoint | null {
  const canvas = root.querySelector<HTMLElement>("[data-slide-canvas]");
  /* istanbul ignore if -- Interaction surfaces always render a CanvasScaler. */
  if (!canvas) {
    return null;
  }
  const canvasRect = canvas.getBoundingClientRect();
  if (
    canvasRect.width <= 0 ||
    canvasRect.height <= 0 ||
    clientX < canvasRect.left ||
    clientX > canvasRect.right ||
    clientY < canvasRect.top ||
    clientY > canvasRect.bottom
  ) {
    return null;
  }

  const images = getZoomableImages(root);
  let imageIndex: number | null = null;
  for (let index = images.length - 1; index >= 0; index -= 1) {
    const image = images[index]!;
    const rect = image.getBoundingClientRect();
    const style = getOwnerWindow(image).getComputedStyle(image);
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      imageIndex = index;
      break;
    }
  }

  return {
    imageIndex,
    move: {
      type: "move",
      slideIndex,
      point: {
        x: (clientX - canvasRect.left) / canvasRect.width,
        y: (clientY - canvasRect.top) / canvasRect.height,
      },
      cursor: imageIndex === null ? "pointer" : "magnifier",
    },
  };
}

export function getZoomableImage(
  root: HTMLElement,
  imageIndex: number,
): HTMLImageElement | null {
  return getZoomableImages(root)[imageIndex] ?? null;
}

function getZoomableImages(root: HTMLElement): HTMLImageElement[] {
  const activeSlide = root.querySelector<HTMLElement>(".slide-kit-slide");
  /* istanbul ignore if -- A rendered interaction canvas always contains its slide. */
  if (!activeSlide) {
    return [];
  }
  return Array.from(
    activeSlide.querySelectorAll<HTMLImageElement>(
      'img:not([data-slide-image-zoom="false"])',
    ),
  );
}

function normalizePoint(point: NormalizedPoint): NormalizedPoint {
  return {
    x: Math.min(1, Math.max(0, point.x)),
    y: Math.min(1, Math.max(0, point.y)),
  };
}
