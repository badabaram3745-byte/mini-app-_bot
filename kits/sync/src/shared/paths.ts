const RESERVED = /[./#]/;

/** What a missing value stringifies to when a name or path is built from it. */
const MISSING = /^(?:undefined|null|NaN|\[object Object\])$/;
const MISSING_SEGMENT =
  /(?:^|\/)(?:undefined|null|NaN|\[object Object\])(?:\/|$)/;

export function validateName(name: unknown, what: string): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`${what} must be a non-empty string.`);
  }
  if (RESERVED.test(name)) {
    throw new Error(`${what} "${name}" may not contain ".", "/" or "#".`);
  }
  if (MISSING.test(name)) {
    throw new Error(
      `${what} is "${name}", a missing value; check the variable it was built from.`,
    );
  }
  return name;
}

/** The path's segments, each validated; leading and trailing slashes are ignored. */
function segmentsOf(path: string, what: string): string[] {
  if (typeof path !== "string") {
    throw new Error(`${what} must be a string like "cards/k3f9".`);
  }
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new Error(`${what} must not be empty.`);
  }
  for (const segment of segments) {
    if (RESERVED.test(segment)) {
      throw new Error(
        `${what} "${path}" has a segment containing "." or "#"; segments may only be separated by "/".`,
      );
    }
  }
  return segments;
}

function withoutMissing(path: string, what: string): string {
  if (MISSING_SEGMENT.test(path)) {
    throw new Error(
      `${what} "${path}" has a missing value in it; pass null as the path until the id is known.`,
    );
  }
  return path;
}

/** Already-normalized paths with an even, or an odd, number of segments; anything else takes the slow path, for its error. */
const DOCUMENT = /^[^./#]+\/[^./#]+(?:\/[^./#]+\/[^./#]+)*$/;
const COLLECTION = /^[^./#]+(?:\/[^./#]+\/[^./#]+)*$/;

/** A normalized document path: an even number of segments. */
export function documentPath(path: string): string {
  const what = "A document path";
  if (DOCUMENT.test(path)) {
    return withoutMissing(path, what);
  }
  const segments = segmentsOf(path, what);
  if (segments.length % 2 !== 0) {
    throw new Error(
      `"${path}" is a collection path (${segments.length} segments); a document path has an even number of segments, like "cards/k3f9" or "game/state".`,
    );
  }
  return withoutMissing(segments.join("/"), what);
}

/** A normalized collection path: an odd number of segments. */
export function collectionPath(path: string): string {
  const what = "A collection path";
  if (COLLECTION.test(path)) {
    return withoutMissing(path, what);
  }
  const segments = segmentsOf(path, what);
  if (segments.length % 2 !== 1) {
    throw new Error(
      `"${path}" is a document path (${segments.length} segments); a collection path has an odd number of segments, like "cards" or "cards/k3f9/steps".`,
    );
  }
  return withoutMissing(segments.join("/"), what);
}

/** A normalized `useMyState` key: a path of any length that does not start with `#`; `what` names the call that gets the error. */
export function storageKey(key: string, what: string): string {
  if (typeof key === "string" && key.startsWith("#")) {
    throw new Error(
      `${what}: keys starting with "#" are kit internals. Pick a name like "draft" or "cards/42".`,
    );
  }
  return segmentsOf(key, `${what} key`).join("/");
}

export function childDocumentPath(collection: string, id: string): string {
  return `${collection}/${validateName(id, "An id")}`;
}

export function idOfDocument(docPath: string): string {
  return docPath.slice(docPath.lastIndexOf("/") + 1);
}

export function parentCollectionOf(docPath: string): string {
  return docPath.slice(0, docPath.lastIndexOf("/"));
}
