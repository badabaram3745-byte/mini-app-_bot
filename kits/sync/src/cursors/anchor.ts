import type { Point, Space } from "./motion";
import type { CursorPoint, Units } from "./wire";
import { fraction, MAX_STEPS, TOKEN } from "./wire";

/** How far past a child's own box the pointer may be and still anchor to it, in px at least. */
const BESIDE_PX = 48;

/** The element under the pointer as an anchor, or undefined when nothing inside `area` is under it or its path is too deep to send. */
export function anchorAt(
  area: HTMLElement,
  overlay: HTMLElement,
  clientX: number,
  clientY: number,
): Pick<CursorPoint, "anchor" | "dx" | "dy"> | undefined {
  const hit = document
    .elementsFromPoint(clientX, clientY)
    .find((node) => area.contains(node) && !overlay.contains(node));
  if (!hit) {
    return undefined;
  }
  const element = leafNear(blockOf(hit, area), overlay, clientX, clientY);
  const box = element.getBoundingClientRect();
  const anchor = pathTo(area, element);
  if (box.width === 0 || box.height === 0 || anchor.length > MAX_STEPS) {
    return undefined;
  }
  return {
    anchor,
    dx: fraction((clientX - box.left) / box.width),
    dy: fraction((clientY - box.top) / box.height),
  };
}

/** The element `anchor` names inside `area`, when it is there. */
export function elementAt(
  area: HTMLElement,
  anchor: readonly string[],
): Element | undefined {
  const [root, ...steps] = anchor;
  let node: Element | null =
    root === "" ? area : area.querySelector(`[id="${root!.slice(1)}"]`);
  for (const step of steps) {
    const at = step.lastIndexOf(":");
    node =
      node?.querySelector(
        `:scope > ${step.slice(0, at)}:nth-of-type(${Number(step.slice(at + 1))})`,
      ) ?? null;
  }
  return node ?? undefined;
}

/** The page a `<Cursors>` overlay is drawn on: a wire point as px of the overlay as it lays out now, a missing or collapsed anchor left at its fractions. */
export class DomSpace implements Space {
  readonly units: Units = undefined;

  constructor(private readonly overlay: () => HTMLElement) {}

  resolve(point: CursorPoint): Point {
    const overlay = this.overlay().getBoundingClientRect();
    const box =
      point.anchor &&
      elementAt(areaOf(this.overlay()), point.anchor)?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) {
      return { x: point.x * overlay.width, y: point.y * overlay.height };
    }
    return {
      x: box.left + point.dx! * box.width - overlay.left,
      y: box.top + point.dy! * box.height - overlay.top,
    };
  }
}

/** The element the overlay covers: its positioned parent, or the page when there is none. */
export function areaOf(overlay: HTMLElement): HTMLElement {
  const positioned = overlay.offsetParent as HTMLElement | null;
  return !positioned || positioned === document.body
    ? document.documentElement
    : positioned;
}

/** Whether the element lays out as a box of its own. */
function isBlock(element: Element): boolean {
  const display = getComputedStyle(element).display;
  return display !== "inline" && display !== "contents";
}

/** `element`, or the nearest block ancestor inside `area`. */
function blockOf(element: Element, area: HTMLElement): Element {
  let node = element;
  while (node !== area && !isBlock(node) && node.parentElement) {
    node = node.parentElement;
  }
  return node;
}

/** The element to anchor to: `element` itself when it has no laid-out block children, else the nearest such child when the pointer is inside or just beside it. */
function leafNear(
  element: Element,
  overlay: HTMLElement,
  clientX: number,
  clientY: number,
): Element {
  for (;;) {
    let near: Element | undefined;
    let nearBox: DOMRect | undefined;
    let least = Infinity;
    for (const child of element.children) {
      if (child === overlay || !isBlock(child)) {
        continue;
      }
      const box = child.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) {
        continue;
      }
      const distance = Math.hypot(
        Math.max(box.left - clientX, 0, clientX - box.right),
        Math.max(box.top - clientY, 0, clientY - box.bottom),
      );
      if (distance < least) {
        least = distance;
        near = child;
        nearBox = box;
      }
    }
    if (
      !near ||
      least > Math.max(BESIDE_PX, Math.min(nearBox!.width, nearBox!.height))
    ) {
      return element;
    }
    if (least > 0) {
      return near;
    }
    element = near;
  }
}

function pathTo(area: HTMLElement, element: Element): string[] {
  const path: string[] = [];
  for (let node = element; node !== area; node = node.parentElement!) {
    if (TOKEN.test(node.id)) {
      path.unshift(`#${node.id}`);
      return path;
    }
    const siblings = node.parentElement!.querySelectorAll(
      `:scope > ${node.localName}`,
    );
    path.unshift(
      `${node.localName}:${Array.prototype.indexOf.call(siblings, node) + 1}`,
    );
  }
  path.unshift("");
  return path;
}
