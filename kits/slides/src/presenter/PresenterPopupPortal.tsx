import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface PresenterPopupTarget {
  popupWindow: Window;
  root: HTMLDivElement;
  sourceWindow: Window;
}

const PRESENTER_WINDOW_NAME = "slide-kit-presenter";
const PRESENTER_WINDOW_FEATURES = "popup,width=1280,height=800";

export function openPresenterPopup(
  sourceRoot: HTMLDivElement,
  title: string,
): PresenterPopupTarget | null {
  const sourceWindow = sourceRoot.ownerDocument.defaultView;
  if (!sourceWindow) {
    return null;
  }
  const popupWindow = sourceWindow.open(
    "about:blank",
    PRESENTER_WINDOW_NAME,
    PRESENTER_WINDOW_FEATURES,
  );
  if (!popupWindow) {
    return null;
  }

  try {
    const popupDocument = popupWindow.document;
    popupDocument.title = title;
    popupDocument.documentElement.lang =
      sourceRoot.lang || sourceRoot.ownerDocument.documentElement.lang;
    copyViewportMetadata(sourceRoot.ownerDocument, popupDocument);
    copyStyles(sourceRoot.ownerDocument, popupDocument);
    const root = popupDocument.importNode(sourceRoot, false);
    popupDocument.body.replaceChildren(root);
    return { popupWindow, root, sourceWindow };
  } catch {
    popupWindow.close();
    return null;
  }
}

export function PresenterPopupPortal({
  children,
  onClose,
  target,
}: {
  children: ReactNode;
  onClose: (target: PresenterPopupTarget) => void;
  target: PresenterPopupTarget;
}) {
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      target.sourceWindow.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    const handlePopupClose = () => onClose(target);
    const handleSourceClose = () => target.popupWindow.close();
    const closedCheck = target.sourceWindow.setInterval(() => {
      if (target.popupWindow.closed) {
        handlePopupClose();
      }
    }, 250);

    target.popupWindow.addEventListener("pagehide", handlePopupClose);
    target.sourceWindow.addEventListener("pagehide", handleSourceClose);
    return () => {
      target.popupWindow.removeEventListener("pagehide", handlePopupClose);
      target.sourceWindow.removeEventListener("pagehide", handleSourceClose);
      target.sourceWindow.clearInterval(closedCheck);
      closeTimerRef.current = target.sourceWindow.setTimeout(() => {
        if (!target.popupWindow.closed) {
          target.popupWindow.close();
        }
      }, 0);
    };
  }, [onClose, target]);

  return createPortal(children, target.root);
}

function copyViewportMetadata(
  sourceDocument: Document,
  popupDocument: Document,
): void {
  const viewport = sourceDocument.querySelector<HTMLMetaElement>(
    'meta[name="viewport"]',
  );
  if (viewport) {
    popupDocument.head.append(popupDocument.importNode(viewport, true));
  }
}

function copyStyles(sourceDocument: Document, popupDocument: Document): void {
  const styles = sourceDocument.querySelectorAll<
    HTMLStyleElement | HTMLLinkElement
  >('style, link[rel~="stylesheet"]');
  for (const style of styles) {
    const copy = popupDocument.importNode(style, true);
    if (style instanceof HTMLLinkElement) {
      copy.setAttribute("href", style.href);
    }
    popupDocument.head.append(copy);
  }
}
