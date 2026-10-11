import { KIT_BUILD } from "../build";
import type { LiveBridge } from "../host/bridge";
import type { Store } from "../store";
import { hydrate } from "./hydrate";
import { persist } from "./persist";
import { idbStorage, removeSiblings } from "./storage";

const KILL_SWITCH_KEY = "live-kit:cache";
const KILL_SWITCH_PARAM = "live-kit-cache";
const OFF = "off";
const PREFIX = "live-kit/";

/**
 * Paints the viewer's last visit while this session's data loads, and writes
 * this session's data back. Nothing here is on the network path: hydration
 * only fills what the store has not read yet, one tab at a time writes, and
 * any failure turns the cache off for the session without a trace.
 */
export function attachCache(store: Store, bridge: LiveBridge): void {
  if (killed()) {
    return;
  }
  const viewer = viewerOf(bridge);
  if (viewer === undefined) {
    return;
  }
  const name = `${PREFIX}${KIT_BUILD}/${viewer}`;
  const storage = idbStorage(name);
  hydrate(storage, store).then(() => {
    void removeSiblings(PREFIX, name);
    void asWriter(name, (release) => persist(storage, store, release));
  }, noop);
}

/** Runs `start` once this tab holds the database's lock, and holds it until the tab closes or the persister gives up. */
async function asWriter(
  name: string,
  start: (release: () => void) => () => void,
): Promise<void> {
  const locks = (navigator as { locks?: LockManager }).locks;
  const hold = () =>
    new Promise<void>((release) => {
      const detach = start(release);
      window.addEventListener("pagehide", () => {
        detach();
        release();
      });
    });
  if (locks) {
    await locks.request(name, hold);
  } else {
    await hold();
  }
}

function killed(): boolean {
  try {
    return (
      localStorage.getItem(KILL_SWITCH_KEY) === OFF ||
      new URLSearchParams(location.search).get(KILL_SWITCH_PARAM) === OFF
    );
  } catch {
    return true;
  }
}

/** The viewer's id; a host without `getViewer` gets no cache. */
function viewerOf(bridge: LiveBridge): string | undefined {
  try {
    return bridge.viewer().id;
  } catch {
    return undefined;
  }
}

function noop(): void {}
