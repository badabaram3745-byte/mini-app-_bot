export function getOwnerWindow(element: Element): Window & typeof globalThis {
  const ownerWindow = element.ownerDocument.defaultView;
  if (!ownerWindow) {
    throw new Error("Rendered slide content must belong to a browser window.");
  }
  return ownerWindow as Window & typeof globalThis;
}
