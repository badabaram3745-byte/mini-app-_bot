import type { Point, Space } from "./motion";
import type { CursorPoint, Units } from "./wire";

/**
 * How a `<Cursors>` over a surface each viewer looks at through their own
 * camera (an `<svg viewBox>`, a `<canvas>`, a panned and zoomed layer) maps
 * the viewport to the units positions are shared in, and back; both are pure
 * and read as the camera stands at the moment of the call.
 */
export interface CursorSpace {
  /** A point of my viewport as the units I publish: the chart, page or world coordinate under it. */
  toContent(clientX: number, clientY: number): Point;
  /** A published point as client px, where my camera shows it now. */
  toClient(x: number, y: number): Point;
}

/** A surface seen through a camera: a wire point falls where the host's camera shows its units now, in px of the overlay. */
export class CameraSpace implements Space {
  readonly units: Units = "page";
  readonly camera = true;

  constructor(
    private readonly overlay: () => HTMLElement,
    private readonly space: () => CursorSpace,
  ) {}

  resolve(point: CursorPoint): Point {
    const rect = this.overlay().getBoundingClientRect();
    const at = this.space().toClient(point.x, point.y);
    return { x: at.x - rect.left, y: at.y - rect.top };
  }
}

export function finite(at: Point): Point | undefined {
  return Number.isFinite(at.x) && Number.isFinite(at.y) ? at : undefined;
}
