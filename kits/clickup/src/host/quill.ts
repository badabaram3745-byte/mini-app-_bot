import * as z from "zod/v4-mini";
import type { Delta } from "../core";
import { fromHost } from "../validate";
import type { LiveBridge } from "./bridge";

/** `text` as a Delta of one paragraph. */
export function paragraph(text: string): Delta {
  return { ops: [{ insert: `${text}\n` }] };
}

const HtmlSchema = z.object({ html: z.string() });

/** `delta` as the HTML ClickUp shows for it, rendered by the host. */
export async function toHtml(host: LiveBridge, delta: Delta): Promise<string> {
  const result = await host.query("quillHtml", { content: delta });
  return fromHost(HtmlSchema, result, "html").html;
}

const UNIFIED_EMOJI = /^[0-9a-f]{2,6}(-[0-9a-f]{2,6})*$/i;

/** Hosts report a standard emoji as its unified code (`1F44D`, `1F44D-1F3FB`); a custom emoji keeps its name. */
export function toEmoji(code: string): string {
  return UNIFIED_EMOJI.test(code)
    ? String.fromCodePoint(
        ...code.split("-").map((part) => Number.parseInt(part, 16)),
      )
    : code;
}
