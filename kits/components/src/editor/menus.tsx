import type { Editor as TiptapEditor } from "@tiptap/core";
import type { BubbleMenuPluginProps } from "@tiptap/extension-bubble-menu";
import { BubbleMenuPlugin } from "@tiptap/extension-bubble-menu";
import type { FloatingMenuPluginProps } from "@tiptap/extension-floating-menu";
import { FloatingMenuPlugin } from "@tiptap/extension-floating-menu";
import { PluginKey, type Plugin } from "@tiptap/pm/state";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

type MenuOptions<Props> = Omit<Props, "editor" | "element" | "pluginKey">;

export interface BubbleMenuProps extends MenuOptions<BubbleMenuPluginProps> {
  editor: TiptapEditor;
  className?: string;
  children: ReactNode;
}

export interface FloatingMenuProps extends MenuOptions<FloatingMenuPluginProps> {
  editor: TiptapEditor;
  className?: string;
  children: ReactNode;
}

/** Your own menu over the selection. */
export function BubbleMenu(props: BubbleMenuProps): ReactElement | null {
  const { editor, className, children, ...options } = props;
  const element = useMenuElement(editor, className, (menu) =>
    BubbleMenuPlugin({
      ...options,
      shouldShow: options.shouldShow ?? null,
      editor,
      element: menu,
      pluginKey: new PluginKey("bubbleMenu"),
    }),
  );
  return element ? createPortal(children, element) : null;
}

/** Your own menu beside an empty line. */
export function FloatingMenu(props: FloatingMenuProps): ReactElement | null {
  const { editor, className, children, ...options } = props;
  const element = useMenuElement(editor, className, (menu) =>
    FloatingMenuPlugin({
      ...options,
      shouldShow: options.shouldShow ?? null,
      editor,
      element: menu,
      pluginKey: new PluginKey("floatingMenu"),
    }),
  );
  return element ? createPortal(children, element) : null;
}

/** A detached element the plugin positions, registered with the editor while mounted. */
function useMenuElement(
  editor: TiptapEditor,
  className: string | undefined,
  plugin: (element: HTMLElement) => Plugin,
): HTMLElement | undefined {
  const [element, setElement] = useState<HTMLElement>();
  useLayoutEffect(() => {
    const menu = document.createElement("div");
    menu.style.visibility = "hidden";
    menu.style.position = "absolute";
    setElement(menu);
    return () => setElement(undefined);
  }, []);
  useLayoutEffect(() => {
    if (element) {
      element.className = className ?? "";
    }
  }, [element, className]);
  useEffect(() => {
    if (!element || editor.isDestroyed) {
      return;
    }
    const registered = plugin(element);
    editor.registerPlugin(registered);
    return () => {
      if (!editor.isDestroyed) {
        editor.unregisterPlugin(registered.spec.key!);
      }
      element.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the plugin takes its options once, when registered.
  }, [editor, element]);
  return element;
}
