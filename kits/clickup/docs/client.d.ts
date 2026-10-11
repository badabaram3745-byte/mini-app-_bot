import type { LiveClient } from "./core";

/**
 * Reads and writes outside React: the same reads as the hooks, as promises,
 * plus all writes. Use it in event handlers and plain modules.
 */
export declare const clickup: LiveClient;
