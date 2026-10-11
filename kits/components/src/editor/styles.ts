import { LABEL } from "@kits/sync/internal";

const muted = "var(--muted, hsl(240 4.8% 95.9%))";
const mutedForeground = "var(--muted-foreground, hsl(240 3.8% 46.1%))";
const border = "var(--border, hsl(240 5.9% 90%))";
const ring = "var(--ring, hsl(240 5% 64.9%))";
const primary = "var(--primary, hsl(240 5.9% 10%))";
const popover = "var(--popover, hsl(0 0% 100%))";
const popoverForeground = "var(--popover-foreground, hsl(240 10% 3.9%))";
const accent = "var(--accent, hsl(240 4.8% 95.9%))";
const accentForeground = "var(--accent-foreground, hsl(240 5.9% 10%))";

export const EDITOR_CSS = `
.ck-editor { position: relative; }
.ck-editor[data-toolbar="fixed"] { border: 1px solid ${border}; border-radius: 0.5rem; }
.ck-editor[data-toolbar="fixed"]:focus-within { box-shadow: 0 0 0 2px ${ring}; }
.ck-editor[data-toolbar="fixed"] .ck-content { padding: 0.5rem 0.75rem; }
.ProseMirror { outline: none; min-height: 1.5em; white-space: pre-wrap; word-wrap: break-word; }
.ProseMirror > * + * { margin-top: 0.5em; }
.ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: ${mutedForeground}; float: left; height: 0; pointer-events: none; }
.ProseMirror a { color: ${primary}; text-decoration: underline; }
.ProseMirror code { background: ${muted}; border-radius: 0.25rem; padding: 0.1em 0.3em; font-size: 0.9em; }
.ProseMirror pre { background: ${muted}; border-radius: 0.375rem; padding: 0.75rem 1rem; overflow-x: auto; }
.ProseMirror pre code { background: none; padding: 0; font-size: inherit; }
.ProseMirror blockquote { border-left: 3px solid ${border}; padding-left: 1rem; color: ${mutedForeground}; }
.ProseMirror hr { border: 0; border-top: 1px solid ${border}; margin: 1rem 0; }
.ProseMirror ul, .ProseMirror ol { padding-left: 1.5rem; }
.ProseMirror ul { list-style: disc; }
.ProseMirror ol { list-style: decimal; }
.ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0; }
.ProseMirror ul[data-type="taskList"] li { display: flex; gap: 0.5rem; align-items: flex-start; }
.ProseMirror ul[data-type="taskList"] li > label { display: flex; flex: 0 0 auto; align-items: center; height: 1.5em; height: 1lh; }
.ProseMirror ul[data-type="taskList"] li > label input { width: 1em; height: 1em; margin: 0; accent-color: ${primary}; }
.ProseMirror ul[data-type="taskList"] li > div { flex: 1 1 auto; min-width: 0; }
.ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div { color: ${mutedForeground}; text-decoration: line-through; }
.ProseMirror table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.ProseMirror td, .ProseMirror th { border: 1px solid ${border}; padding: 0.25rem 0.5rem; vertical-align: top; }
.ProseMirror th { background: ${muted}; font-weight: 600; text-align: left; }
.ProseMirror img { max-width: 100%; height: auto; }
.ProseMirror .mention { color: ${primary}; background: color-mix(in srgb, ${primary} 12%, transparent); border-radius: 0.25rem; padding: 0 0.2em; }
.ProseMirror-yjs-cursor { position: relative; margin-left: -1px; margin-right: -1px; border-left: 1px solid; border-right: 1px solid; word-break: normal; pointer-events: none; }
.ProseMirror-yjs-cursor > div { position: absolute; bottom: 100%; left: -1px; font-size: ${LABEL.fontSize}; line-height: 1; padding: ${LABEL.padding}; border-radius: ${LABEL.radius} ${LABEL.radius} ${LABEL.radius} ${LABEL.tail}; white-space: nowrap; user-select: none; font-style: normal; font-weight: 500; }
.ck-toolbar { display: flex; flex-wrap: wrap; gap: 0.125rem; align-items: center; }
.ck-toolbar[data-placement="fixed"] { padding: 0.25rem 0.5rem; border-bottom: 1px solid ${border}; }
.ck-toolbar[data-placement="bubble"] { padding: 0.25rem; border: 1px solid ${border}; border-radius: 0.5rem; background: ${popover}; color: ${popoverForeground}; box-shadow: 0 4px 12px rgb(0 0 0 / 0.12); }
.ck-toolbar button { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; border: 0; border-radius: 0.375rem; background: none; color: inherit; cursor: pointer; }
.ck-toolbar button:hover { background: ${accent}; color: ${accentForeground}; }
.ck-toolbar button[aria-pressed="true"] { background: ${accent}; color: ${primary}; }
.ck-toolbar button:focus-visible { outline: 2px solid ${ring}; outline-offset: 1px; }
.ck-toolbar button svg { width: 1rem; height: 1rem; }
.ck-toolbar input { height: 1.75rem; min-width: 14rem; padding: 0 0.5rem; border: 1px solid ${border}; border-radius: 0.375rem; background: transparent; color: inherit; font: inherit; }
.ck-toolbar input:focus-visible { outline: 2px solid ${ring}; outline-offset: 1px; }
.ck-popup { position: fixed; top: 0; left: 0; z-index: 60; width: max-content; line-height: 1.3; transform-origin: 0 0; }
.ck-popup[data-placement^="top"] { transform-origin: 0 100%; }
.ck-popup:not([data-state]) { visibility: hidden; }
.ck-popup[data-state="open"] { animation: ck-menu-grow 150ms ease-out, ck-menu-fade 150ms ease-out; }
.ck-popup[data-state="closed"] { animation: ck-menu-shrink 120ms ease-in forwards; pointer-events: none; }
@keyframes ck-menu-grow { from { transform: scale(0.96); } to { transform: scale(1); } }
@keyframes ck-menu-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ck-menu-shrink { to { opacity: 0; transform: scale(0.97); } }
.ck-menu { box-sizing: border-box; min-width: 12rem; max-width: 22rem; max-height: min(22rem, var(--ck-menu-max, 22rem)); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 0.375rem; border: 1px solid color-mix(in srgb, ${popoverForeground} 10%, transparent); border-radius: 0.75rem; background: ${popover}; color: ${popoverForeground}; box-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 4px 12px rgb(0 0 0 / 0.08), 0 16px 40px -8px rgb(0 0 0 / 0.2); }
.ck-popup[data-kind="slash"] .ck-menu { width: 19rem; }
.ck-menu [role="group"] + [role="group"] { margin-top: 0.25rem; padding-top: 0.25rem; border-top: 1px solid color-mix(in srgb, ${popoverForeground} 8%, transparent); }
.ck-menu-group { padding: 0.375rem 0.5rem 0.25rem; font-size: 0.78em; font-weight: 500; letter-spacing: 0.01em; color: ${mutedForeground}; }
.ck-menu button[role="option"] { display: flex; align-items: center; gap: 0.625rem; width: 100%; padding: 0.375rem 0.5rem; border: 0; border-radius: 0.5rem; background: none; color: inherit; font: inherit; line-height: inherit; text-align: left; cursor: pointer; transition: background-color 80ms ease-out; -webkit-tap-highlight-color: transparent; }
.ck-menu button[aria-selected="true"] { background: ${accent}; color: ${accentForeground}; }
.ck-menu-icon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 1.875rem; height: 1.875rem; border: 1px solid color-mix(in srgb, ${popoverForeground} 10%, transparent); border-radius: 0.5rem; background: ${popover}; color: ${popoverForeground}; box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); }
.ck-menu-icon svg { width: 1.0625rem; height: 1.0625rem; }
.ck-menu-text { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; gap: 0.0625rem; }
.ck-menu-title { overflow: hidden; font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.ck-menu-description { overflow: hidden; font-size: 0.86em; color: ${mutedForeground}; white-space: nowrap; text-overflow: ellipsis; }
.ck-menu-hint { flex: none; min-width: 1.25rem; height: 1.25rem; padding: 0 0.3rem; border-radius: 0.3rem; background: ${muted}; color: ${mutedForeground}; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.75em; line-height: 1.25rem; text-align: center; }
.ck-menu button[aria-selected="true"] .ck-menu-hint { background: color-mix(in srgb, currentColor 10%, transparent); }
.ck-menu-empty { padding: 0.875rem 0.5rem; color: ${mutedForeground}; font-size: 0.93em; text-align: center; }
@media (prefers-reduced-motion: reduce) {
  .ck-popup[data-state] { animation: none; }
  .ck-menu button[role="option"] { transition: none; }
}
`;

let adopted = false;

export function adoptEditorStyles(): void {
  if (adopted || typeof document === "undefined") {
    return;
  }
  adopted = true;
  if (
    "adoptedStyleSheets" in document &&
    "replaceSync" in CSSStyleSheet.prototype
  ) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(EDITOR_CSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return;
  }
  const style = document.createElement("style");
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}
