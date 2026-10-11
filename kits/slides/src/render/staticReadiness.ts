export const STATIC_READY_EVENT = "slide-kit:static-ready";

interface StaticReadinessOptions {
  assets?: readonly string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface StaticReadyDetail {
  status: "ready" | "error";
  error?: string;
}

export async function waitForStaticReadiness(
  root: HTMLElement,
  {
    assets = [],
    signal: externalSignal,
    timeoutMs = 10_000,
  }: StaticReadinessOptions = {},
): Promise<void> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    forwardAbort();
  } else {
    externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  }
  const timeout = window.setTimeout(
    () =>
      controller.abort(
        new Error(
          "Static slide rendering did not become ready before the timeout.",
        ),
      ),
    timeoutMs,
  );
  try {
    await settleStaticSurface(root, assets, controller.signal);
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
}

export function publishStaticReadiness(
  root: HTMLElement,
  detail: StaticReadyDetail,
): void {
  root.dataset.slideKitReadiness = detail.status;
  root.dispatchEvent(
    new CustomEvent<StaticReadyDetail>(STATIC_READY_EVENT, {
      bubbles: true,
      detail,
    }),
  );
}

async function settleStaticSurface(
  root: HTMLElement,
  assets: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  /* istanbul ignore else -- Supported artifact browsers expose FontFaceSet. */
  if (document.fonts) {
    await waitForPromise(document.fonts.ready, signal);
  }

  await Promise.all([
    ...Array.from(root.querySelectorAll<HTMLImageElement>("img")).map((image) =>
      waitForImage(image, signal),
    ),
    ...Array.from(root.querySelectorAll<HTMLMediaElement>("video, audio")).map(
      (media) => waitForMedia(media, signal),
    ),
    ...[...new Set(assets)].map((asset) => waitForImageSource(asset, signal)),
  ]);

  throwIfAborted(signal);
  for (const animation of getAnimations(root)) {
    /* istanbul ignore next -- Browser animations normally retain their effect. */
    const timing = animation.effect?.getComputedTiming();
    if (timing?.endTime === Infinity) {
      animation.pause();
      animation.currentTime = 0;
    } else {
      animation.finish();
    }
  }

  await nextAnimationFrame(signal);
  await nextAnimationFrame(signal);
}

async function waitForImage(
  image: HTMLImageElement,
  signal: AbortSignal,
): Promise<void> {
  if (image.loading === "lazy") {
    image.loading = "eager";
  }
  if (!image.complete) {
    await waitForEvent(image, "load", "error", signal);
  }
  /* istanbul ignore else -- Supported artifact browsers implement image decoding. */
  if (image.decode) {
    await waitForPromise(image.decode(), signal);
  }
}

async function waitForImageSource(
  source: string,
  signal: AbortSignal,
): Promise<void> {
  const image = new Image();
  image.src = source;
  await waitForImage(image, signal);
}

async function waitForMedia(
  media: HTMLMediaElement,
  signal: AbortSignal,
): Promise<void> {
  if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }
  const ready = waitForEvent(media, "loadeddata", "error", signal);
  media.load();
  await ready;
}

function waitForEvent(
  target: EventTarget,
  successEvent: string,
  errorEvent: string,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(successEvent, onSuccess);
      target.removeEventListener(errorEvent, onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed while waiting for ${successEvent}.`));
    };
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    target.addEventListener(successEvent, onSuccess, { once: true });
    target.addEventListener(errorEvent, onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function getAnimations(root: HTMLElement): Animation[] {
  /* istanbul ignore else -- Supported artifact browsers expose subtree animations. */
  if (root.getAnimations) {
    return root.getAnimations({ subtree: true });
  }
  return [];
}

function nextAnimationFrame(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame: number | undefined;
    const onAbort = () => {
      if (frame !== undefined && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(frame);
      }
      reject(abortReason(signal));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    frame = requestAnimationFrame(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForPromise<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortReason(signal);
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Static slide rendering was cancelled.");
}
