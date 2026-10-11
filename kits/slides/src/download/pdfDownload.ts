import { resolveDownloadFilename } from "./downloadFilename";

interface PdfDownloadOptions {
  filename?: string;
}

const PRINT_ROOT_ID = "slide-kit-print-root";
const PRINT_STYLE_ID = "slide-kit-print-style";

export async function downloadPdf(
  staticRoot: HTMLElement,
  { filename }: PdfDownloadOptions = {},
): Promise<void> {
  const existingRoot = document.getElementById(PRINT_ROOT_ID);
  if (existingRoot) {
    throw new Error("A slide PDF download is already in progress.");
  }

  const sourceDeckRoot = staticRoot.closest<HTMLElement>(".slide-kit-root");
  const printRoot = document.createElement("div");
  printRoot.id = PRINT_ROOT_ID;
  printRoot.className = sourceDeckRoot?.className ?? "slide-kit-root";
  printRoot.dataset.theme = sourceDeckRoot?.dataset.theme ?? "light";
  if (sourceDeckRoot?.hasAttribute("style")) {
    printRoot.setAttribute("style", sourceDeckRoot.getAttribute("style")!);
  }
  printRoot.appendChild(staticRoot.cloneNode(true));

  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent = `
@page { size: 1920px 1080px; margin: 0; }
@media screen {
  #${PRINT_ROOT_ID} { position: fixed !important; left: -100000px !important; top: 0 !important; pointer-events: none !important; }
}
@media print {
  html, body { width: 1920px !important; height: auto !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { display: block !important; width: 1920px !important; height: auto !important; min-height: 0 !important; margin: 0 !important; background: #fff !important; }
  #${PRINT_ROOT_ID} .slide-kit-static-page { width: 1920px !important; height: 1080px !important; overflow: hidden !important; break-after: page !important; page-break-after: always !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  #${PRINT_ROOT_ID} .slide-kit-static-page:last-child { break-after: auto !important; page-break-after: auto !important; }
}`;

  const previousTitle = document.title;
  document.title = resolveDownloadFilename(filename, "pdf").replace(
    /\.pdf$/i,
    "",
  );
  document.head.appendChild(style);
  document.body.appendChild(printRoot);

  try {
    const printed = waitForAfterPrint();
    window.print();
    await printed;
  } finally {
    document.title = previousTitle;
    printRoot.remove();
    style.remove();
  }
}

function waitForAfterPrint(timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.removeEventListener("afterprint", finish);
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    window.addEventListener("afterprint", finish, { once: true });
  });
}
