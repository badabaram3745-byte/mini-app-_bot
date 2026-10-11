import type * as Y from "yjs";

type XmlNode = Y.XmlElement | Y.XmlText | Y.XmlHook;

/** One line per block, formatting dropped; an empty inline element is a soft break. */
export function plainTextOf(fragment: Y.XmlFragment): string {
  return fragment.toArray().map(blockTextOf).join("\n");
}

function blockTextOf(node: XmlNode): string {
  if (isText(node)) {
    return inlineTextOf(node);
  }
  if (!isElement(node)) {
    return "";
  }
  const children = node.toArray() as XmlNode[];
  if (!children.some(isText)) {
    return children.map(blockTextOf).join("\n");
  }
  return children
    .map((child) => {
      if (isText(child)) {
        return inlineTextOf(child);
      }
      if (!isElement(child)) {
        return "";
      }
      const empty =
        child.length === 0 && Object.keys(child.getAttributes()).length === 0;
      return empty ? "\n" : blockTextOf(child);
    })
    .join("");
}

function inlineTextOf(text: Y.XmlText): string {
  return (text.toDelta() as Array<{ insert: unknown }>)
    .map((op) => (typeof op.insert === "string" ? op.insert : ""))
    .join("");
}

function isText(node: XmlNode): node is Y.XmlText {
  return "toDelta" in node;
}

function isElement(node: XmlNode): node is Y.XmlElement {
  return "nodeName" in node;
}
