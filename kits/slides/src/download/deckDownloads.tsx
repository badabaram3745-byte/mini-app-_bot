import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SlideDefinition } from "../core/Slide";
import { StaticDeck } from "../render/StaticDeck";
import type { StaticReadyDetail } from "../render/staticReadiness";
import { downloadPdf } from "./pdfDownload";
import { downloadPptx } from "./pptxDownload";

export type DeckDownloadFormat = "pdf" | "pptx";

export interface DeckDownloadOptions {
  filename?: string;
  readinessTimeoutMs?: number;
}

export interface DeckDownloads {
  downloadDeck: (
    format: DeckDownloadFormat,
    options?: DeckDownloadOptions,
  ) => Promise<void>;
  downloadPdf: (options?: DeckDownloadOptions) => Promise<void>;
  downloadPptx: (options?: DeckDownloadOptions) => Promise<void>;
}

interface SnapshotRequest {
  operation: (root: HTMLElement) => Promise<void>;
  readinessTimeoutMs?: number;
  resolve: () => void;
  reject: (error: unknown) => void;
  started: boolean;
}

const DeckDownloadsContext = createContext<DeckDownloads | null>(null);

export function DeckDownloadProvider({
  children,
  slides,
}: {
  children: ReactNode;
  slides: SlideDefinition[];
}) {
  const requestRef = useRef<SnapshotRequest | null>(null);
  const [request, setRequest] = useState<SnapshotRequest | null>(null);

  const finishRequest = useCallback(
    (finishedRequest: SnapshotRequest, error?: unknown) => {
      if (requestRef.current !== finishedRequest) {
        return;
      }
      requestRef.current = null;
      setRequest(null);
      if (error === undefined) {
        finishedRequest.resolve();
      } else {
        finishedRequest.reject(error);
      }
    },
    [],
  );

  const handleReadiness = useCallback(
    (root: HTMLElement, detail: StaticReadyDetail) => {
      const activeRequest = requestRef.current;
      if (!activeRequest || activeRequest.started) {
        return;
      }
      if (detail.status === "error") {
        finishRequest(
          activeRequest,
          new Error(
            detail.error ?? "Slides could not be prepared for download.",
          ),
        );
        return;
      }

      activeRequest.started = true;
      activeRequest.operation(root).then(
        () => finishRequest(activeRequest),
        (error: unknown) => finishRequest(activeRequest, error),
      );
    },
    [finishRequest],
  );

  const runWithStaticDeck = useCallback(
    (
      operation: (root: HTMLElement) => Promise<void>,
      readinessTimeoutMs?: number,
    ): Promise<void> => {
      if (typeof document === "undefined") {
        return Promise.reject(
          new Error("Slide downloads are only available in a browser."),
        );
      }
      if (requestRef.current) {
        return Promise.reject(
          new Error("A slide download is already in progress."),
        );
      }

      return new Promise((resolve, reject) => {
        const nextRequest: SnapshotRequest = {
          operation,
          readinessTimeoutMs,
          resolve,
          reject,
          started: false,
        };
        requestRef.current = nextRequest;
        setRequest(nextRequest);
      });
    },
    [],
  );

  useEffect(
    () => () => {
      const activeRequest = requestRef.current;
      requestRef.current = null;
      activeRequest?.reject(
        new Error("Slide download was cancelled because the deck unmounted."),
      );
    },
    [],
  );

  const value = useMemo<DeckDownloads>(() => {
    const downloadDeck = (
      format: DeckDownloadFormat,
      options: DeckDownloadOptions = {},
    ) =>
      runWithStaticDeck((root) => {
        if (format === "pdf") {
          return downloadPdf(root, options);
        }
        return downloadPptx(root, options);
      }, options.readinessTimeoutMs);

    return {
      downloadDeck,
      downloadPdf: (options) => downloadDeck("pdf", options),
      downloadPptx: (options) => downloadDeck("pptx", options),
    };
  }, [runWithStaticDeck]);

  return (
    <DeckDownloadsContext.Provider value={value}>
      {children}
      {request ? (
        <div
          aria-hidden="true"
          className="slide-kit-download-snapshot"
          data-slide-download-snapshot
        >
          <StaticDeck
            slides={slides}
            readinessTimeoutMs={request.readinessTimeoutMs}
            onReadiness={handleReadiness}
          />
        </div>
      ) : null}
    </DeckDownloadsContext.Provider>
  );
}

export function useDeckDownloads(): DeckDownloads {
  const value = useContext(DeckDownloadsContext);
  if (!value) {
    throw new Error("Slide kit hooks must be used inside Deck.");
  }
  return value;
}
