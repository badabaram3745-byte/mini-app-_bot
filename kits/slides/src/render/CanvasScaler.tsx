import {
  type CSSProperties,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { LayoutGroup } from "motion/react";
import { getOwnerWindow } from "../core/domEnvironment";

export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

interface CanvasScalerProps {
  children: ReactNode;
  className?: string;
  fit?: "contain" | "cover";
  frameClassName?: string;
  staticCanvas?: boolean;
  surface: string;
}

export function CanvasScaler({
  children,
  className,
  fit = "contain",
  frameClassName,
  staticCanvas = false,
  surface,
}: CanvasScalerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef<number | null>(staticCanvas ? 1 : null);
  const layoutScopeId = useId().replace(/:/g, "");

  useLayoutEffect(() => {
    const element = containerRef.current;
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!element || !frame || !canvas) {
      return;
    }

    const applyScale = () => {
      const scale = scaleRef.current;
      frame.style.width = `${CANVAS_WIDTH * (scale ?? 1)}px`;
      frame.style.height = `${CANVAS_HEIGHT * (scale ?? 1)}px`;
      frame.style.visibility = scale === null ? "hidden" : "visible";
      canvas.style.transform = `scale(${scale ?? 1})`;
    };

    if (staticCanvas) {
      applyScale();
      return;
    }

    const measure = () => {
      const { clientHeight: height, clientWidth: width } = element;
      if (width > 0 && height > 0) {
        scaleRef.current =
          fit === "cover"
            ? Math.max(width / CANVAS_WIDTH, height / CANVAS_HEIGHT)
            : Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT);
        applyScale();
      }
    };

    measure();
    const ownerWindow = getOwnerWindow(element);
    const observer = new ownerWindow.ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit, staticCanvas]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const mirrorsSlideBackground = surface === "presentation";
    if (!mirrorsSlideBackground) {
      container.style.removeProperty("background-color");
      return;
    }
    const slide = container.querySelector<HTMLElement>(".slide-kit-slide");
    if (!slide) {
      return;
    }
    container.style.backgroundColor =
      getOwnerWindow(slide).getComputedStyle(slide).backgroundColor;
  });

  // applyScale owns frame size, visibility and canvas scale; nothing scale-dependent belongs in these styles.
  const frameStyle: CSSProperties = staticCanvas
    ? {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
      }
    : {
        position: "absolute",
        inset: 0,
        margin: "auto",
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        visibility: "hidden",
        zIndex: 1,
      };

  return (
    <div
      ref={containerRef}
      className={className}
      data-slide-canvas-container
      data-slide-surface={surface}
    >
      <div
        ref={frameRef}
        className={`slide-kit-canvas-geometry ${frameClassName ?? ""}`.trim()}
        style={frameStyle}
      >
        <div
          ref={canvasRef}
          data-slide-canvas
          style={{
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            transformOrigin: "top left",
            position: "relative",
            zIndex: 1,
          }}
        >
          <LayoutGroup id={`${surface}-${layoutScopeId}`}>
            {children}
          </LayoutGroup>
        </div>
      </div>
    </div>
  );
}
