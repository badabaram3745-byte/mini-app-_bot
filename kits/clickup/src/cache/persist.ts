import type { Store } from "../store";
import { BUDGET_BYTES } from "../things";
import { encodePage } from "./codec";
import { whenIdle, yieldToMain } from "./schedule";
import type { PageStorage } from "./storage";

const IDLE_TIMEOUT_MS = 2_000;

/** Dispatched on `document` after every flush, so a test can await one. */
const FLUSH_EVENT = "live-kit:flush";

/**
 * Writes the dirty pages in idle time after the store changes, and at once
 * when the page is hidden. One flush runs at a time and changes during it
 * coalesce into one more; a failure reports through `onError`, after which
 * nothing more is written.
 * @returns Detaches from the store and the page.
 */
export function persist(
  storage: PageStorage,
  store: Store,
  onError: (error: unknown) => void,
): () => void {
  let dirty = false;
  let scheduled = false;
  let flushing = false;
  let detached = false;

  const write = async () => {
    store.evict(BUDGET_BYTES);
    const puts: Array<[string, string]> = [];
    const deletes: string[] = [];
    for (const [page, things] of store.things.takeDirtyPages()) {
      if (things.length === 0) {
        deletes.push(page);
        continue;
      }
      puts.push([page, encodePage(things)]);
      await yieldToMain();
    }
    if (puts.length > 0 || deletes.length > 0) {
      await storage.write(puts, deletes);
    }
    document.dispatchEvent(
      new CustomEvent(FLUSH_EVENT, {
        detail: { puts: puts.map(([key]) => key), deletes },
      }),
    );
  };

  const flush = () => {
    if (flushing || detached) {
      return;
    }
    dirty = false;
    flushing = true;
    write().then(
      () => {
        flushing = false;
        if (dirty) {
          schedule();
        }
      },
      (error: unknown) => {
        flushing = false;
        detach();
        onError(error);
      },
    );
  };

  const schedule = () => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    whenIdle(() => {
      scheduled = false;
      if (dirty) {
        flush();
      }
    }, IDLE_TIMEOUT_MS);
  };

  const onHidden = () => {
    if (document.visibilityState === "hidden" && dirty) {
      flush();
    }
  };

  const unsubscribe = store.onChange(() => {
    dirty = true;
    schedule();
  });
  document.addEventListener("visibilitychange", onHidden);
  dirty = true;
  schedule();

  const detach = () => {
    detached = true;
    unsubscribe();
    document.removeEventListener("visibilitychange", onHidden);
  };
  return detach;
}
