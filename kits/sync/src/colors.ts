/** The ClickUp avatar colours with a readable text colour each, in the same order. */
export const COLORS: ReadonlyArray<{ backgroundColor: string; color: string }> =
  [
    { backgroundColor: "#6647f0", color: "#ffffff" },
    { backgroundColor: "#3e63dd", color: "#ffffff" },
    { backgroundColor: "#0083e6", color: "#ffffff" },
    { backgroundColor: "#109585", color: "#ffffff" },
    { backgroundColor: "#248f7d", color: "#ffffff" },
    { backgroundColor: "#ffc53d", color: "#111827" },
    { backgroundColor: "#de5e07", color: "#ffffff" },
    { backgroundColor: "#e5484d", color: "#ffffff" },
    { backgroundColor: "#e93d82", color: "#ffffff" },
    { backgroundColor: "#ab4aba", color: "#ffffff" },
    { backgroundColor: "#a18072", color: "#ffffff" },
  ];

/** Background and text colour for a user id, the pair `Cursors` and ClickUp avatars use. */
export function colorOf(id: string): {
  backgroundColor: string;
  color: string;
} {
  let hash = 5381;
  for (const char of id) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }
  return COLORS[Math.abs(hash) % COLORS.length]!;
}
