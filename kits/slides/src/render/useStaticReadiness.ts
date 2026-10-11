import { type RefObject, useEffect } from "react";
import {
  publishStaticReadiness,
  type StaticReadyDetail,
  waitForStaticReadiness,
} from "./staticReadiness";

export function useStaticReadiness(
  rootRef: RefObject<HTMLElement | null>,
  assets: readonly string[],
  timeoutMs?: number,
  onReadiness?: (root: HTMLElement, detail: StaticReadyDetail) => void,
): void {
  useEffect(() => {
    const root = rootRef.current;
    /* istanbul ignore if -- React assigns the static root before effects run. */
    if (!root) {
      return;
    }
    root.dataset.slideKitReadiness = "pending";
    const controller = new AbortController();
    waitForStaticReadiness(root, {
      assets,
      signal: controller.signal,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }).then(
      () => {
        if (!controller.signal.aborted) {
          const detail: StaticReadyDetail = { status: "ready" };
          publishStaticReadiness(root, detail);
          onReadiness?.(root, detail);
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          const detail: StaticReadyDetail = {
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          };
          publishStaticReadiness(root, detail);
          onReadiness?.(root, detail);
        }
      },
    );
    return () => controller.abort();
  }, [assets, onReadiness, rootRef, timeoutMs]);
}
