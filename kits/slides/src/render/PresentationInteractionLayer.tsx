import {
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CursorArrow } from "@kits/sync";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { getOwnerWindow } from "../core/domEnvironment";
import { CANVAS_WIDTH } from "./CanvasScaler";
import {
  createPresentationInteractionController,
  getZoomableImage,
  inspectPresentationPoint,
  type NormalizedPoint,
  type PresentationInteractionAction,
  type PresentationInteractionController,
  type PresentationInteractionSnapshot,
} from "./presentationInteraction";

const PRESENTATION_CURSOR_SCALE = 0.92;

interface PresentationInteractionSurfaceProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  | "children"
  | "onClickCapture"
  | "onDragStartCapture"
  | "onPointerDownCapture"
  | "onPointerLeave"
  | "onPointerMove"
> {
  children: ReactNode;
  className: string;
  controller: PresentationInteractionController;
  expandedImageLabel: string;
  modalImageFocus?: boolean;
  slideIndex: number;
}

export function PresentationInteractionSurface({
  children,
  className,
  controller,
  expandedImageLabel,
  modalImageFocus = false,
  slideIndex,
  ...props
}: PresentationInteractionSurfaceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const focusBeforeImageRef = useRef<HTMLElement | null>(null);
  const imageWasFocusedRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const focusedImage =
    snapshot.focusedImage?.slideIndex === slideIndex
      ? snapshot.focusedImage
      : null;

  const apply = useCallback(
    (action: PresentationInteractionAction) => {
      controller.dispatch(action);
    },
    [controller],
  );

  const leave = useCallback(() => {
    if (!pointerInsideRef.current) {
      return;
    }
    pointerInsideRef.current = false;
    apply({ type: "leave" });
  }, [apply]);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      /* istanbul ignore if -- React assigns the interaction root before pointer events. */
      if (!root) {
        return;
      }
      if (
        event.target instanceof getOwnerWindow(root).Element &&
        event.target.closest("[data-presentation-regular-cursor]")
      ) {
        leave();
        return;
      }
      /* istanbul ignore if -- Touch behavior runs in the dedicated touch browser project. */
      if (event.pointerType === "touch") {
        return;
      }
      const inspected = inspectPresentationPoint(
        root,
        event.clientX,
        event.clientY,
        slideIndex,
      );
      if (!inspected) {
        leave();
        return;
      }
      pointerInsideRef.current = true;
      apply(
        focusedImage
          ? { ...inspected.move, cursor: "pointer" }
          : inspected.move,
      );
    },
    [apply, focusedImage, leave, slideIndex],
  );

  const onClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || focusedImage) {
        return;
      }
      const root = rootRef.current;
      /* istanbul ignore if -- React assigns the interaction root before click events. */
      if (!root) {
        return;
      }
      const inspected = inspectPresentationPoint(
        root,
        event.clientX,
        event.clientY,
        slideIndex,
      );
      if (
        inspected?.imageIndex !== null &&
        inspected?.imageIndex !== undefined
      ) {
        event.preventDefault();
        event.stopPropagation();
        apply({
          type: "openImage",
          slideIndex,
          imageIndex: inspected.imageIndex,
        });
      }
    },
    [apply, focusedImage, slideIndex],
  );

  const onPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || focusedImage) {
        return;
      }
      const root = rootRef.current;
      /* istanbul ignore if -- React assigns the interaction root before pointer events. */
      if (!root) {
        return;
      }
      const inspected = inspectPresentationPoint(
        root,
        event.clientX,
        event.clientY,
        slideIndex,
      );
      if (
        inspected?.imageIndex !== null &&
        inspected?.imageIndex !== undefined
      ) {
        focusBeforeImageRef.current = root.ownerDocument
          .activeElement as HTMLElement | null;
      }
    },
    [focusedImage, slideIndex],
  );

  const closeImage = useCallback(() => {
    apply({ type: "closeImage" });
  }, [apply]);

  useEffect(() => {
    const action: PresentationInteractionAction = { type: "reset" };
    controller.dispatch(action);
    pointerInsideRef.current = false;
  }, [controller, slideIndex]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || !modalImageFocus) {
      return;
    }
    content.inert = Boolean(focusedImage);
    return () => {
      content.inert = false;
    };
  }, [focusedImage, modalImageFocus]);

  useEffect(() => {
    if (focusedImage) {
      imageWasFocusedRef.current = true;
      return;
    }
    if (!imageWasFocusedRef.current || !modalImageFocus) {
      return;
    }
    imageWasFocusedRef.current = false;
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const ownerWindow = getOwnerWindow(root);
    const animationFrame = ownerWindow.requestAnimationFrame(() =>
      focusBeforeImageRef.current?.focus(),
    );
    return () => ownerWindow.cancelAnimationFrame(animationFrame);
  }, [focusedImage, modalImageFocus]);

  useEffect(() => {
    if (!focusedImage) {
      return;
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      closeImage();
    };
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const ownerWindow = getOwnerWindow(root);
    ownerWindow.addEventListener("keydown", closeFromKeyboard, true);
    return () =>
      ownerWindow.removeEventListener("keydown", closeFromKeyboard, true);
  }, [closeImage, focusedImage]);

  return (
    <div
      {...props}
      ref={rootRef}
      className={`slide-kit-presentation-interaction ${className}`}
      data-image-focused={focusedImage ? "true" : "false"}
      onClickCapture={onClickCapture}
      onDragStartCapture={(event) => {
        if (
          event.target instanceof getOwnerWindow(event.currentTarget).Element &&
          event.target.closest("[data-slide-canvas]")
        ) {
          event.preventDefault();
        }
      }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerLeave={leave}
      onPointerMove={onPointerMove}
    >
      <div
        ref={contentRef}
        className="slide-kit-presentation-interaction-content"
        aria-hidden={modalImageFocus && focusedImage ? "true" : undefined}
      >
        {children}
      </div>
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {focusedImage ? (
            <FocusedImageOverlay
              key={`${focusedImage.slideIndex}-${focusedImage.imageIndex}`}
              expandedImageLabel={expandedImageLabel}
              imageIndex={focusedImage.imageIndex}
              modal={modalImageFocus}
              onClose={closeImage}
              rootRef={rootRef}
            />
          ) : null}
        </AnimatePresence>
      </MotionConfig>
      <PresentationCursor
        rootRef={rootRef}
        slideIndex={slideIndex}
        snapshot={snapshot}
      />
    </div>
  );
}

export function usePresentationInteractionController(): PresentationInteractionController {
  const [controller] = useState(createPresentationInteractionController);
  useEffect(() => () => controller.destroy(), [controller]);
  return controller;
}

function PresentationCursor({
  rootRef,
  slideIndex,
  snapshot,
}: {
  rootRef: RefObject<HTMLElement | null>;
  slideIndex: number;
  snapshot: PresentationInteractionSnapshot;
}) {
  const cursor =
    snapshot.cursor?.slideIndex === slideIndex ? snapshot.cursor : null;
  const lastCursorRef = useRef(cursor);
  if (cursor) {
    lastCursorRef.current = cursor;
  }
  const renderedCursor = cursor ?? lastCursorRef.current;
  const position = useCanvasPosition(rootRef, renderedCursor?.point ?? null);
  const magnifier = renderedCursor?.kind === "magnifier";
  // The arrow's tip is its top-left corner; the magnifier is centred on the point.
  const centre = magnifier ? -34 : 0;

  return (
    <span
      className="slide-kit-presentation-cursor"
      data-cursor-kind={renderedCursor?.kind}
      data-visible={cursor && position ? "true" : "false"}
      style={
        position
          ? {
              transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${position.scale * PRESENTATION_CURSOR_SCALE}) translate(${centre}px, ${centre}px)`,
            }
          : undefined
      }
      aria-hidden="true"
    >
      {magnifier ? (
        <svg viewBox="0 0 84 84" focusable="false">
          <path className="slide-kit-cursor-handle" d="m51 51 23 23" />
          <circle cx="34" cy="34" r="24" />
          <path className="slide-kit-cursor-plus" d="M34 21v26M21 34h26" />
        </svg>
      ) : (
        <CursorArrow />
      )}
    </span>
  );
}

interface ImageGeometry {
  alt: string;
  authorHeight: number;
  authorWidth: number;
  sourceImage: HTMLImageElement;
  sourceScale: number;
  sourceX: number;
  sourceY: number;
  targetScale: number;
  targetX: number;
  targetY: number;
}

function FocusedImageOverlay({
  expandedImageLabel,
  imageIndex,
  modal,
  onClose,
  rootRef,
}: {
  expandedImageLabel: string;
  imageIndex: number;
  modal: boolean;
  onClose: () => void;
  rootRef: RefObject<HTMLElement | null>;
}) {
  const cloneHostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [geometry, setGeometry] = useState<ImageGeometry | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    /* istanbul ignore if -- React assigns the overlay root before layout effects. */
    if (!root) {
      return;
    }
    const measure = () => {
      const image = getZoomableImage(root, imageIndex);
      /* istanbul ignore if -- Authored slide structure remains stable while presented. */
      if (!image) {
        onClose();
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const canvas = root.querySelector<HTMLElement>("[data-slide-canvas]");
      /* istanbul ignore if -- Interaction surfaces always render a CanvasScaler. */
      if (!canvas) {
        onClose();
        return;
      }
      const canvasRect = canvas.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      /* istanbul ignore if -- Focus can only open from a rendered image hit target. */
      if (imageRect.width <= 0 || imageRect.height <= 0) {
        onClose();
        return;
      }
      const sourceScale = canvasRect.width / CANVAS_WIDTH;
      const authorWidth = image.offsetWidth;
      const authorHeight = image.offsetHeight;
      /* istanbul ignore if -- A rendered image has nonzero author dimensions. */
      if (authorWidth <= 0 || authorHeight <= 0) {
        onClose();
        return;
      }
      const targetScale = Math.min(
        (rootRect.width * 0.86) / authorWidth,
        (rootRect.height * 0.84) / authorHeight,
      );
      const targetWidth = authorWidth * targetScale;
      const targetHeight = authorHeight * targetScale;
      setGeometry({
        alt: image.alt,
        authorHeight,
        authorWidth,
        sourceImage: image,
        sourceScale,
        sourceX: imageRect.left - rootRect.left,
        sourceY: imageRect.top - rootRect.top,
        targetScale,
        targetX: (rootRect.width - targetWidth) / 2,
        targetY: (rootRect.height - targetHeight) / 2,
      });
    };
    measure();
    const ownerWindow = getOwnerWindow(root);
    const observer = new ownerWindow.ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [imageIndex, onClose, rootRef]);

  useLayoutEffect(() => {
    const host = cloneHostRef.current;
    if (!host || !geometry) {
      return;
    }
    const clone = createVisualImageClone(
      geometry.sourceImage,
      geometry.authorWidth,
      geometry.authorHeight,
    );
    host.replaceChildren(clone);
    return () => clone.remove();
  }, [geometry]);

  useEffect(() => {
    if (!modal || !geometry) {
      return;
    }
    overlayRef.current?.focus();
  }, [geometry, modal]);

  if (!geometry) {
    return null;
  }

  return (
    <motion.div
      ref={overlayRef}
      className="slide-kit-focused-image-overlay"
      data-focused-image
      role={modal ? "dialog" : undefined}
      aria-hidden={modal ? undefined : "true"}
      aria-label={modal ? geometry.alt || expandedImageLabel : undefined}
      aria-modal={modal ? "true" : undefined}
      tabIndex={modal ? -1 : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <motion.div
        className="slide-kit-focused-image"
        data-expanded-image-container
        initial={{
          x: geometry.sourceX,
          y: geometry.sourceY,
          scale: geometry.sourceScale,
        }}
        animate={{
          x: geometry.targetX,
          y: geometry.targetY,
          scale: geometry.targetScale,
        }}
        exit={{
          x: geometry.sourceX,
          y: geometry.sourceY,
          scale: geometry.sourceScale,
        }}
        transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: geometry.authorWidth,
          height: geometry.authorHeight,
        }}
      >
        <div ref={cloneHostRef} className="slide-kit-focused-image-host" />
      </motion.div>
    </motion.div>
  );
}

function createVisualImageClone(
  image: HTMLImageElement,
  width: number,
  height: number,
): HTMLImageElement {
  const clone = image.cloneNode(false) as HTMLImageElement;
  const computedStyle = getOwnerWindow(image).getComputedStyle(image);
  clone.removeAttribute("class");
  clone.removeAttribute("id");
  clone.removeAttribute("sizes");
  clone.removeAttribute("srcset");
  clone.src = image.currentSrc || image.src;
  clone.alt = "";
  clone.ariaHidden = "true";
  clone.draggable = false;
  clone.setAttribute("data-expanded-image", "");

  for (let index = 0; index < computedStyle.length; index += 1) {
    const property = computedStyle.item(index);
    clone.style.setProperty(
      property,
      computedStyle.getPropertyValue(property),
      "important",
    );
  }
  const layoutOverrides: Record<string, string> = {
    display: "block",
    height: `${height}px`,
    inset: "auto",
    margin: "0",
    "max-height": "none",
    "max-width": "none",
    "min-height": "0",
    "min-width": "0",
    "pointer-events": "none",
    position: "static",
    transform: "none",
    width: `${width}px`,
  };
  for (const [property, value] of Object.entries(layoutOverrides)) {
    clone.style.setProperty(property, value, "important");
  }
  return clone;
}

function useCanvasPosition(
  rootRef: RefObject<HTMLElement | null>,
  point: NormalizedPoint | null,
): { scale: number; x: number; y: number } | null {
  const [position, setPosition] = useState<{
    scale: number;
    x: number;
    y: number;
  } | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !point) {
      return;
    }
    const canvas = root.querySelector<HTMLElement>("[data-slide-canvas]");
    /* istanbul ignore if -- Interaction surfaces always render a CanvasScaler. */
    if (!canvas) {
      return;
    }
    const measure = () => {
      const rootRect = root.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      setPosition({
        scale: canvasRect.width / CANVAS_WIDTH,
        x: canvasRect.left - rootRect.left + canvasRect.width * point.x,
        y: canvasRect.top - rootRect.top + canvasRect.height * point.y,
      });
    };
    measure();
    const ownerWindow = getOwnerWindow(root);
    const observer = new ownerWindow.ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [point, rootRef]);

  return position;
}
