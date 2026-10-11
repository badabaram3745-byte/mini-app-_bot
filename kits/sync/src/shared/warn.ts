const warned = new Set<string>();

export function warnOnce(key: string, message: string): void {
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[sync] ${message}`);
  }
}
