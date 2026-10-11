import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../render/CanvasScaler";
import { resolveDownloadFilename } from "./downloadFilename";
import { downloadBlob } from "./fileDownload";
import { buildImagePptx } from "./pptxArchive";

interface PptxDownloadOptions {
  filename?: string;
}

const CAPTURE_STYLE_ID = "slide-kit-pptx-capture-style";
const FROZEN_PROPERTIES = [
  "opacity",
  "transform",
  "filter",
  "clip-path",
] as const;

export async function downloadPptx(
  staticRoot: HTMLElement,
  { filename }: PptxDownloadOptions = {},
): Promise<void> {
  const pages = Array.from(
    staticRoot.querySelectorAll<HTMLElement>("[data-slide-static-page]"),
  );
  if (pages.length === 0) {
    throw new Error("A PowerPoint download requires at least one slide.");
  }

  const captureStyle = document.createElement("style");
  captureStyle.id = CAPTURE_STYLE_ID;
  captureStyle.textContent = `
[data-slide-download-snapshot] *, [data-slide-download-snapshot] *::before, [data-slide-download-snapshot] *::after {
  animation-delay: -1s !important;
  animation-duration: 1ms !important;
  animation-iteration-count: 1 !important;
  animation-fill-mode: forwards !important;
  transition: none !important;
}`;
  document.head.appendChild(captureStyle);

  try {
    const { toBlob } = await import("html-to-image");
    const images: Uint8Array[] = [];
    for (const [index, page] of pages.entries()) {
      freezeForCapture(page);
      const blob = await toBlob(page, {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
      });
      if (!blob) {
        throw new Error(`Failed to capture slide ${index + 1}.`);
      }
      images.push(new Uint8Array(await blob.arrayBuffer()));
    }

    const archive = buildImagePptx(images);
    downloadBlob(
      new Blob([archive as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
      resolveDownloadFilename(filename, "pptx"),
    );
  } finally {
    captureStyle.remove();
  }
}

function freezeForCapture(root: HTMLElement): void {
  const elements = [
    root,
    ...Array.from(root.querySelectorAll<HTMLElement>("*")),
  ];
  for (const element of elements) {
    const computedStyle = getComputedStyle(element);
    for (const property of FROZEN_PROPERTIES) {
      element.style.setProperty(
        property,
        computedStyle.getPropertyValue(property),
        "important",
      );
    }
    element.style.setProperty("animation", "none", "important");
    element.style.setProperty("transition", "none", "important");
  }
}
