type DownloadExtension = "pdf" | "pptx";

export function resolveDownloadFilename(
  requestedName: string | undefined,
  extension: DownloadExtension,
): string {
  const documentTitle =
    typeof document === "undefined" ? "" : document.title.trim();
  const fallback = documentTitle || "slides";
  const withoutExtension = (requestedName?.trim() || fallback).replace(
    /\.(?:pdf|pptx)$/i,
    "",
  );
  const sanitized = withoutExtension
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-")
    .replace(/[.\s]+$/g, "")
    .trim();
  return `${sanitized || "slides"}.${extension}`;
}
