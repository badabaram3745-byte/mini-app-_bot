import {
  createElement,
  Fragment,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { Notes, type NotesProps } from "./Notes";
import {
  Slide,
  type SlideDefinition,
  type SlideProps,
  type SlideTransition,
} from "./Slide";

interface PendingSlide {
  content: ReactNode[];
  notes: ReactNode[];
  className?: string;
  style?: CSSProperties;
  staticAssets: string[];
  transition?: SlideTransition;
}

export function normalizeDeck(children: ReactNode): SlideDefinition[] {
  const slides: PendingSlide[] = [];
  let looseContent: ReactNode[] = [];

  const flushLooseContent = () => {
    if (looseContent.length > 0) {
      slides.push(toPendingSlide(looseContent));
      looseContent = [];
    }
  };

  for (const child of flattenFragments(children)) {
    if (isSlideElement(child)) {
      flushLooseContent();
      slides.push(toPendingSlide(child.props.children, child.props));
    } else {
      looseContent.push(child);
    }
  }
  flushLooseContent();

  if (slides.length === 0) {
    slides.push(toPendingSlide([]));
  }

  return slides.map((slide, index) => ({
    id: `slide-${index + 1}`,
    content: wrapNodes(slide.content, "content"),
    notes: slide.notes.length > 0 ? wrapNodes(slide.notes, "notes") : null,
    className: slide.className,
    style: slide.style,
    staticAssets: slide.staticAssets,
    transition: slide.transition,
  }));
}

function toPendingSlide(children: ReactNode, props?: SlideProps): PendingSlide {
  const content: ReactNode[] = [];
  const notes: ReactNode[] = [];
  const style = props?.style;
  const staticAssets = props?.staticAssets;

  for (const child of flattenFragments(children)) {
    if (isNotesElement(child)) {
      notes.push(...flattenFragments(child.props.children));
    } else {
      content.push(child);
    }
  }

  return {
    content,
    notes,
    className:
      typeof props?.className === "string" ? props.className : undefined,
    style: isStyle(style) ? style : undefined,
    staticAssets: Array.isArray(staticAssets)
      ? staticAssets.filter(
          (asset): asset is string => typeof asset === "string",
        )
      : [],
    transition: normalizeSlideTransition(props?.transition),
  };
}

function normalizeSlideTransition(value: unknown): SlideTransition | undefined {
  return value === "fade" || value === "slide" || value === "none"
    ? value
    : undefined;
}

function flattenFragments(children: ReactNode): ReactNode[] {
  const flattened: ReactNode[] = [];
  visit(children, flattened);
  return flattened;
}

function visit(node: ReactNode, flattened: ReactNode[]): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      visit(child, flattened);
    }
    return;
  }
  if (
    isValidElement<{ children?: ReactNode }>(node) &&
    node.type === Fragment
  ) {
    visit(node.props.children, flattened);
    return;
  }
  if (
    typeof node === "string" ||
    typeof node === "number" ||
    isValidElement(node)
  ) {
    flattened.push(node);
  }
}

function isSlideElement(node: ReactNode): node is ReactElement<SlideProps> {
  return isValidElement<SlideProps>(node) && node.type === Slide;
}

function isNotesElement(node: ReactNode): node is ReactElement<NotesProps> {
  return isValidElement<NotesProps>(node) && node.type === Notes;
}

function isStyle(value: unknown): value is CSSProperties {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wrapNodes(nodes: ReactNode[], prefix: string): ReactNode[] {
  return nodes.map((node, index) =>
    createElement(Fragment, { key: `${prefix}-${index + 1}` }, node),
  );
}
