type KeyboardNavigationCommand = "first" | "last" | "next" | "previous";

interface KeyboardNavigationHandlers {
  first: () => void;
  last: () => void;
  next: () => void;
  previous: () => void;
}

function getKeyboardNavigationCommand(
  key: string,
): KeyboardNavigationCommand | null {
  if (
    key === "ArrowRight" ||
    key === "ArrowDown" ||
    key === " " ||
    key === "PageDown"
  ) {
    return "next";
  }
  if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") {
    return "previous";
  }
  if (key === "Home") {
    return "first";
  }
  if (key === "End") {
    return "last";
  }
  return null;
}

export function handleKeyboardNavigation(
  event: KeyboardEvent,
  handlers: KeyboardNavigationHandlers,
): boolean {
  const command = getKeyboardNavigationCommand(event.key);
  if (!command) {
    return false;
  }
  event.preventDefault();
  handlers[command]();
  return true;
}

export function shouldIgnoreKeyboardEvent(event: KeyboardEvent): boolean {
  return hasCommandModifier(event) || isInteractiveTarget(event.target);
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  const element = target as
    | (EventTarget & { closest?: Element["closest"] })
    | null;
  return (
    typeof element?.closest === "function" &&
    element.closest(
      [
        "a[href]",
        "audio[controls]",
        "button",
        "iframe",
        "input",
        "select",
        "summary",
        "textarea",
        "video[controls]",
        "[contenteditable]:not([contenteditable='false'])",
        "[role='button']",
        "[role='combobox']",
        "[role='listbox']",
        "[role='menuitem']",
        "[role='slider']",
        "[role='spinbutton']",
        "[role='textbox']",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    ) !== null
  );
}

function hasCommandModifier(event: KeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey;
}
