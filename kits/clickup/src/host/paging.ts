/** Walks a cursor-paged source to its last page; `break` out of the loop to stop early. */
export async function* pages<P extends { nextCursor?: string }>(
  fetchPage: (cursor: string | undefined) => Promise<P>,
): AsyncGenerator<P> {
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    yield page;
    cursor = page.nextCursor;
  } while (cursor);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
