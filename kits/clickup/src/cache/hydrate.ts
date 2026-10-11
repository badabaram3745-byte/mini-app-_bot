import type { Store } from "../store";
import { decodePage } from "./codec";
import type { PageStorage } from "./storage";

/**
 * Seeds the store from every page on disk, in key order, one page per task.
 * A page that does not decode is removed and skipped; the rest still land.
 */
export async function hydrate(
  storage: PageStorage,
  store: Store,
): Promise<void> {
  const broken: string[] = [];
  await storage.readAll((key, text) => {
    try {
      store.seedPage(key, decodePage(text));
    } catch {
      broken.push(key);
    }
  });
  for (const key of broken) {
    await storage.remove(key);
  }
}
