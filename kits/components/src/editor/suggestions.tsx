import { shift, size } from "@floating-ui/dom";
import type { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import { exitSuggestion } from "@tiptap/suggestion";
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface MenuItem {
  id: string;
  label: string;
  description?: string;
  /** The Markdown shortcut, drawn as a key at the right edge. */
  hint?: string;
  /** Consecutive items with the same group share a heading. */
  group?: string;
  icon?: LucideIcon;
}

interface MenuHandle {
  onKeyDown(props: SuggestionKeyDownProps): boolean;
}

export const popupOptions: Pick<SuggestionOptions, "offset" | "floatingUi"> = {
  offset: { mainAxis: 6 },
  floatingUi: {
    strategy: "fixed",
    middleware: [
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply: ({ availableHeight, elements }) =>
          elements.floating.style.setProperty(
            "--ck-menu-max",
            `${Math.max(availableHeight, 96)}px`,
          ),
      }),
    ],
  },
};

/** The renderer the `/` and `@` menus share; `kind` names the popup for styling. */
export function menuRenderer<Item extends MenuItem>(
  pluginKey: PluginKey,
  kind: "slash" | "mention",
): NonNullable<SuggestionOptions<Item>["render"]> {
  return () => {
    let popup: Popup<Item> | undefined;
    return {
      onStart: (props) => {
        popup?.close();
        popup = openPopup(props, pluginKey, kind);
      },
      onUpdate: (props) => popup?.update(props),
      onKeyDown: (props) => popup?.keyDown(props) ?? false,
      onExit: () => {
        popup?.close();
        popup = undefined;
      },
    };
  };
}

interface Popup<Item extends MenuItem> {
  update(props: SuggestionProps<Item>): void;
  keyDown(props: SuggestionKeyDownProps): boolean;
  close(): void;
}

/** One open menu, mounted on `document.body` and torn down after its exit animation. */
function openPopup<Item extends MenuItem>(
  props: SuggestionProps<Item>,
  pluginKey: PluginKey,
  kind: string,
): Popup<Item> {
  const { editor } = props;
  const surface = editor.view.dom;
  const renderer = new ReactRenderer<MenuHandle, MenuProps>(Menu, {
    editor,
    props: menuProps(props),
    className: "ck-popup",
  });
  const { element } = renderer;
  element.dataset.kind = kind;
  adoptTypography(element, surface);
  document.body.appendChild(element);
  const unmount = props.mount(element, {
    autoUpdate: { animationFrame: true },
    onPosition: ({ x, y, placement }) => {
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.dataset.placement = placement;
      element.dataset.state ||= "open";
    },
  });
  const dismiss = () => exitSuggestion(editor.view, pluginKey);
  surface.addEventListener("blur", dismiss);

  let closed = false;
  return {
    update(next) {
      renderer.updateProps(menuProps(next));
    },
    keyDown(keyProps) {
      return renderer.ref?.onKeyDown(keyProps) ?? false;
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      unmount();
      surface.removeEventListener("blur", dismiss);
      const remove = () => {
        if (element.isConnected) {
          renderer.destroy();
        }
      };
      if (
        matchMedia("(prefers-reduced-motion: reduce)").matches ||
        !element.dataset.state
      ) {
        remove();
        return;
      }
      element.dataset.state = "closed";
      element.addEventListener("animationend", remove);
      setTimeout(remove, 200);
    },
  };
}

function menuProps<Item extends MenuItem>(
  props: SuggestionProps<Item>,
): MenuProps {
  return {
    items: props.items,
    command: props.command as (item: MenuItem) => void,
    loading: props.loading,
  };
}

function adoptTypography(element: HTMLElement, surface: HTMLElement): void {
  const { fontFamily, fontSize } = getComputedStyle(surface);
  element.style.fontFamily = fontFamily;
  element.style.fontSize = `${Math.min(Math.max(parseFloat(fontSize) || 14, 13), 15)}px`;
}

interface MenuProps {
  items: MenuItem[];
  command: (item: MenuItem) => void;
  loading: boolean;
}

interface Run {
  group: string | undefined;
  entries: Array<[MenuItem, number]>;
}

const Menu = forwardRef<MenuHandle, MenuProps>(function Menu(
  { items, command, loading },
  ref,
): ReactElement {
  const [state, setState] = useState({ items, selected: 0 });
  if (state.items !== items) {
    setState({ items, selected: 0 });
  }
  const selected = Math.min(state.selected, Math.max(items.length - 1, 0));
  const select = (index: number) => setState({ items, selected: index });
  const list = useRef<HTMLDivElement>(null);
  const scrollTo = useRef(false);
  useLayoutEffect(() => {
    if (scrollTo.current) {
      scrollTo.current = false;
      list.current
        ?.querySelector(`[data-index="${selected}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);
  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) {
          return false;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          const step = event.key === "ArrowUp" ? -1 : 1;
          scrollTo.current = true;
          select((selected + step + items.length) % items.length);
          return true;
        }
        if (
          (event.key === "Enter" || event.key === "Tab") &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          command(items[selected]!);
          return true;
        }
        return false;
      },
    }),
    [items, selected, command],
  );
  const runs: Run[] = [];
  items.forEach((item, index) => {
    const last = runs[runs.length - 1];
    if (last && last.group === item.group) {
      last.entries.push([item, index]);
    } else {
      runs.push({ group: item.group, entries: [[item, index]] });
    }
  });
  return (
    <div
      className="ck-menu"
      onMouseDown={(event) => event.preventDefault()}
      ref={list}
      role="listbox"
    >
      {items.length === 0 && (
        <div className="ck-menu-empty">
          {loading ? "Searching…" : "No results"}
        </div>
      )}
      {runs.map(({ group, entries }) => (
        <div aria-label={group} key={`${group}:${entries[0]![1]}`} role="group">
          {group && <div className="ck-menu-group">{group}</div>}
          {entries.map(([item, index]) => {
            const Icon = item.icon;
            return (
              <button
                aria-selected={index === selected}
                data-index={index}
                key={item.id}
                onClick={() => command(item)}
                onMouseMove={() => index !== selected && select(index)}
                role="option"
                type="button"
              >
                {Icon && (
                  <span className="ck-menu-icon">
                    <Icon aria-hidden="true" strokeWidth={1.75} />
                  </span>
                )}
                <span className="ck-menu-text">
                  <span className="ck-menu-title">{item.label}</span>
                  {item.description && (
                    <span className="ck-menu-description">
                      {item.description}
                    </span>
                  )}
                </span>
                {item.hint && <kbd className="ck-menu-hint">{item.hint}</kbd>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
});
