import { useLayoutEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import type { SlideDefinition } from "../core/Slide";
import { CANVAS_HEIGHT, CANVAS_WIDTH, CanvasScaler } from "./CanvasScaler";
import { SlideFrame } from "./SlideFrame";

const GRID_GAP = 16;
const GRID_PADDING = 20;
const CAPTION_HEIGHT = 24;

interface GridLayout {
  cellWidth: number;
  columns: number;
}

/** A numbered contact sheet of every slide, sized so the whole deck fits the viewport. */
export function GridDeck({ slides }: { slides: SlideDefinition[] }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<GridLayout | null>(null);

  useLayoutEffect(() => {
    const element = rootRef.current;
    /* istanbul ignore if -- React assigns the grid root before layout effects. */
    if (!element) {
      return;
    }
    const measure = () => {
      const { clientHeight, clientWidth } = element;
      if (clientWidth > 0 && clientHeight > 0) {
        setLayout(computeGridLayout(clientWidth, clientHeight, slides.length));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [slides.length]);

  return (
    <MotionConfig reducedMotion="always">
      <div ref={rootRef} className="slide-kit-grid" data-slide-grid-root>
        {layout ? (
          <div
            className="slide-kit-grid-sheet"
            style={{
              gridTemplateColumns: `repeat(${layout.columns}, ${layout.cellWidth}px)`,
            }}
          >
            {slides.map((slide, index) => (
              <figure
                key={slide.id}
                className="slide-kit-grid-cell"
                data-slide-grid-cell={index + 1}
              >
                <span
                  className="slide-kit-grid-frame"
                  style={{
                    width: layout.cellWidth,
                    height: (layout.cellWidth * CANVAS_HEIGHT) / CANVAS_WIDTH,
                  }}
                >
                  <CanvasScaler surface="grid">
                    <SlideFrame
                      definition={slide}
                      slideIndex={index}
                      revealedCount={Number.MAX_SAFE_INTEGER}
                      surface="preview"
                    />
                  </CanvasScaler>
                </span>
                <figcaption aria-hidden="true">{index + 1}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}
      </div>
    </MotionConfig>
  );
}

/** The column count that gives the largest cells whose rows still fit the container. */
function computeGridLayout(
  width: number,
  height: number,
  count: number,
): GridLayout {
  let best: GridLayout = { cellWidth: 1, columns: 1 };
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const widthBound =
      (width - 2 * GRID_PADDING - GRID_GAP * (columns - 1)) / columns;
    const rowHeight =
      (height - 2 * GRID_PADDING - GRID_GAP * (rows - 1)) / rows;
    const heightBound =
      ((rowHeight - CAPTION_HEIGHT) * CANVAS_WIDTH) / CANVAS_HEIGHT;
    const cellWidth = Math.min(widthBound, heightBound);
    if (cellWidth > best.cellWidth) {
      best = { cellWidth, columns };
    }
  }
  return best;
}
