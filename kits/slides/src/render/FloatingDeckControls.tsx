import { useEffect, useRef, useState } from "react";
import type { DeckDownloadFormat } from "../download/deckDownloads";
import { useLocalization } from "../core/localization";
import { ControlButton } from "./ControlButton";
import { ControlIcon } from "./ControlIcon";

interface FloatingDeckControlsProps {
  downloadFormat: DeckDownloadFormat | null;
  onDownload: (format: DeckDownloadFormat) => void;
  onPresent: () => void;
  onPresenter: () => void;
}

export function FloatingDeckControls({
  downloadFormat,
  onDownload,
  onPresent,
  onPresenter,
}: FloatingDeckControlsProps) {
  const messages = useLocalization();
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const closeFromOutside = (event: PointerEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeFromOutside);
    window.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      window.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [menuOpen]);

  const runMenuAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <div ref={controlsRef} className="slide-kit-viewer-controls">
      <div className="slide-kit-control-cluster">
        {menuOpen ? (
          <div
            className="slide-kit-overflow-menu"
            role="menu"
            aria-label={messages.download}
          >
            <ControlButton
              variant="menu"
              role="menuitem"
              disabled={downloadFormat !== null}
              onClick={() => runMenuAction(() => onDownload("pdf"))}
            >
              <span className="slide-kit-format-icon" data-format="pdf">
                <ControlIcon name="file-pdf" />
              </span>
              <span className="slide-kit-format-copy">
                <strong>
                  {downloadFormat === "pdf"
                    ? messages.preparingDownload
                    : messages.pdfDocument}
                </strong>
                <small>.pdf</small>
              </span>
            </ControlButton>
            <ControlButton
              variant="menu"
              role="menuitem"
              disabled={downloadFormat !== null}
              onClick={() => runMenuAction(() => onDownload("pptx"))}
            >
              <span className="slide-kit-format-icon" data-format="pptx">
                <ControlIcon name="file-pptx" />
              </span>
              <span className="slide-kit-format-copy">
                <strong>
                  {downloadFormat === "pptx"
                    ? messages.preparingDownload
                    : messages.powerPoint}
                </strong>
                <small>.pptx</small>
              </span>
            </ControlButton>
          </div>
        ) : null}

        <nav
          className="slide-kit-control-pill"
          aria-label={messages.presentationControls}
        >
          <ControlButton
            iconOnly
            aria-label={messages.download}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <ControlIcon name="download" />
          </ControlButton>
          <span className="slide-kit-control-divider" aria-hidden="true" />
          <ControlButton
            className="slide-kit-presenter-action"
            aria-label={messages.presenterView}
            title={messages.presenterView}
            onClick={onPresenter}
          >
            <ControlIcon name="presenter" />
            <span className="slide-kit-presenter-action-label">
              {messages.presenter}
            </span>
          </ControlButton>
        </nav>
      </div>

      <ControlButton
        variant="primary"
        className="slide-kit-present-fab"
        aria-label={messages.startPresentation}
        title={messages.startPresentation}
        onClick={onPresent}
      >
        <ControlIcon name="play" />
        <span className="slide-kit-present-label">
          {messages.startPresentation}
        </span>
      </ControlButton>
    </div>
  );
}
