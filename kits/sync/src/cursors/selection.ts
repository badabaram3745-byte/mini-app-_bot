import { COLORS } from "../colors";
import { LABEL } from "./tokens";
import type { TextSelection } from "./wire";
import { regionOf } from "./wire";

const HIGHLIGHT = "sync-selection";

/** The page's selection as it lies inside `area`, or undefined when there is none, it reaches outside, or a rich text editor already shares it. */
export function selectionIn(
  area: Element,
  region: string | undefined,
): TextSelection | undefined {
  const selection = document.getSelection();
  const range =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (
    !range ||
    range.collapsed ||
    !area.contains(range.commonAncestorContainer) ||
    inEditor(range.commonAncestorContainer)
  ) {
    return undefined;
  }
  return {
    from: pathTo(area, range.startContainer, range.startOffset),
    to: pathTo(area, range.endContainer, range.endOffset),
    hash: hash(range.toString()),
    ...regionOf(region),
  };
}

/** The range `selection` describes inside `area`, when the same text is there. */
export function rangeOf(
  area: Element,
  selection: TextSelection,
): Range | undefined {
  const from = pointAt(area, selection.from);
  const to = pointAt(area, selection.to);
  if (!from || !to) {
    return undefined;
  }
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return hash(range.toString()) === selection.hash ? range : undefined;
}

/** Paints `range` as a text highlight in `color`, a palette background, until the returned function is called; without CSS highlights it paints nothing. */
export function paint(range: Range, color: string): () => void {
  if (typeof Highlight !== "function") {
    return () => {};
  }
  const highlight = highlightIn(color);
  highlight.add(range);
  return () => {
    highlight.delete(range);
  };
}

function inEditor(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest(".ProseMirror"));
}

function pathTo(area: Node, node: Node, offset: number): number[] {
  const path = [offset];
  for (let step = node; step !== area; step = step.parentNode!) {
    path.unshift(
      Array.prototype.indexOf.call(step.parentNode!.childNodes, step),
    );
  }
  return path;
}

function pointAt(
  area: Node,
  path: readonly number[],
): { node: Node; offset: number } | undefined {
  let node = area;
  for (const index of path.slice(0, -1)) {
    const child = node.childNodes[index];
    if (!child) {
      return undefined;
    }
    node = child;
  }
  const offset = path[path.length - 1]!;
  const length =
    node.nodeType === Node.TEXT_NODE
      ? (node as Text).length
      : node.childNodes.length;
  return offset <= length ? { node, offset } : undefined;
}

/** FNV-1a over the text's code units, as eight hex digits. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

let styled = false;

/** The one highlight per palette colour; the first one styles them all. */
function highlightIn(color: string): Highlight {
  const name = `${HIGHLIGHT}-${color.slice(1)}`;
  let highlight = CSS.highlights.get(name);
  if (!highlight) {
    highlight = new Highlight();
    CSS.highlights.set(name, highlight);
  }
  if (!styled) {
    styled = true;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      COLORS.map(
        ({ backgroundColor }) =>
          `::highlight(${HIGHLIGHT}-${backgroundColor.slice(1)}) { background-color: ${backgroundColor}${LABEL.alpha}; }`,
      ).join("\n"),
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  return highlight;
}
