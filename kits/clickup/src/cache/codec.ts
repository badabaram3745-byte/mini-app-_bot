import type { Thing } from "../things";

/** A page on the wire: every ref nested in its things written once, referenced by `kind#id`. */
interface PageWire {
  refs: Record<string, object>;
  data: object[];
}

interface RefNode {
  $ref: string;
}

export function encodePage(things: Thing[]): string {
  const refs: Record<string, object> = {};
  const compact = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(compact);
    }
    if (!isObject(value)) {
      return value;
    }
    if (!isRef(value)) {
      return compactFields(value);
    }
    const key = `${value.kind}#${value.id}`;
    if (!(key in refs)) {
      refs[key] = compactFields(value);
    }
    return { $ref: key } satisfies RefNode;
  };
  const compactFields = (value: object): object =>
    Object.fromEntries(
      Object.entries(value).map(([field, nested]) => [field, compact(nested)]),
    );
  const wire: PageWire = { refs, data: things.map(compactFields) };
  return JSON.stringify(wire);
}

/** Throws when the text is not a page or a `$ref` names nothing. */
export function decodePage(text: string): Thing[] {
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed)) {
    throw new Error("Not a page");
  }
  const { refs, data } = parsed as PageWire;
  if (!isObject(refs) || !Array.isArray(data)) {
    throw new Error("Not a page");
  }
  const expand = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        value[index] = expand(value[index]);
      }
      return value;
    }
    if (!isObject(value)) {
      return value;
    }
    if (isRefNode(value)) {
      const ref = refs[value.$ref];
      if (!ref) {
        throw new Error(`Unresolvable $ref ${value.$ref}`);
      }
      return { ...ref };
    }
    for (const field of Object.keys(value)) {
      (value as Record<string, unknown>)[field] = expand(
        (value as Record<string, unknown>)[field],
      );
    }
    return value;
  };
  for (const key of Object.keys(refs)) {
    refs[key] = expand(refs[key]) as object;
  }
  return data.map((thing) => {
    const expanded = expand(thing);
    if (!isObject(expanded) || !isRef(expanded)) {
      throw new Error("Not a thing");
    }
    return expanded;
  });
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isRef(value: object): value is Thing {
  const { kind, id } = value as Partial<Thing>;
  return typeof kind === "string" && typeof id === "string";
}

function isRefNode(value: object): value is RefNode {
  return typeof (value as Partial<RefNode>).$ref === "string";
}
