import { colorOf, LABEL } from "@kits/sync/internal";
import { Extension } from "@tiptap/core";
import { yCursorPlugin } from "@tiptap/y-tiptap";
import type { Awareness } from "y-protocols/awareness";

export interface SyncCaretOptions {
  awareness: Awareness | null;
}

interface WireUser {
  id?: unknown;
  name?: unknown;
}

interface WireState {
  user?: WireUser;
}

/** Everyone else's caret and selection in their avatar colour with their name; my other tabs are not drawn. */
export const SyncCaret = Extension.create<SyncCaretOptions>({
  name: "syncCaret",

  addOptions() {
    return { awareness: null };
  },

  addProseMirrorPlugins() {
    const { awareness } = this.options;
    if (!awareness) {
      return [];
    }
    const mine = () =>
      userIdOf(
        (awareness.getLocalState() as WireState | null)?.user,
        awareness.clientID,
      );
    return [
      yCursorPlugin(awareness, {
        awarenessStateFilter: (
          _current: number,
          clientId: number,
          state: WireState | null,
        ) =>
          clientId !== awareness.clientID &&
          userIdOf(state?.user, clientId) !== mine(),
        cursorBuilder: (user: WireUser, clientId: number) =>
          caretElement(userIdOf(user, clientId), user),
        selectionBuilder: (user: WireUser, clientId: number) => ({
          class: "ProseMirror-yjs-selection",
          style: `background-color: ${colorOf(userIdOf(user, clientId)).backgroundColor}${LABEL.alpha}`,
        }),
      }),
    ];
  },
});

function userIdOf(user: WireUser | undefined, clientId: number): string {
  const id = user?.id;
  return id == null || id === "" ? `client:${clientId}` : String(id);
}

function caretElement(id: string, user: WireUser): HTMLElement {
  const colors = colorOf(id);
  const caret = document.createElement("span");
  caret.className = "ProseMirror-yjs-cursor";
  caret.setAttribute("aria-hidden", "true");
  caret.dataset.syncCaret = id;
  caret.style.borderColor = colors.backgroundColor;
  const label = document.createElement("div");
  label.style.backgroundColor = colors.backgroundColor;
  label.style.color = colors.color;
  label.textContent = typeof user.name === "string" ? user.name : id;
  caret.append("\u2060", label, "\u2060");
  return caret;
}
