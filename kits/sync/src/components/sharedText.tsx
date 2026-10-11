import type {
  ChangeEvent,
  ChangeEventHandler,
  CompositionEvent,
  CompositionEventHandler,
  InputHTMLAttributes,
  ReactElement,
  TextareaHTMLAttributes,
} from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { documentPath, validateName } from "../shared/paths";
import { getStore, STATUS_KEY } from "../shared/store";
import { useStoreValue } from "../shared/useStoreValue";
import { warnOnce } from "../shared/warn";

export interface SharedTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** The document path, like `cards/${card.id}`. */
  doc: string;
  field: string;
}

/**
 * A textarea for a `sharedText()` field; read-only for any other field.
 * Edits apply to the shared text at once (IME input at composition end),
 * `onChange` fires afterwards with the resulting value, the caret survives
 * remote edits, and `value` and `defaultValue` are ignored.
 */
export function SharedTextarea({
  doc,
  field,
  ...attributes
}: SharedTextareaProps): ReactElement {
  const control = useTextControl<HTMLTextAreaElement>(doc, field, attributes);
  return <textarea {...attributes} {...control} />;
}

export interface SharedInputProps extends InputHTMLAttributes<HTMLInputElement> {
  doc: string;
  field: string;
}

/** A one-line input for a `sharedText()` field; read-only for any other field. `value`, `defaultValue` and `type` are ignored: it is always `type="text"`, the one input type whose caret the binding can follow. */
export function SharedInput({
  doc,
  field,
  ...attributes
}: SharedInputProps): ReactElement {
  const control = useTextControl<HTMLInputElement>(doc, field, attributes);
  return <input {...attributes} {...control} type="text" />;
}

type TextElement = HTMLTextAreaElement | HTMLInputElement;

/** The element props the control wraps rather than passes through. */
interface Wrapped<E extends TextElement> {
  readOnly?: boolean;
  onChange?: ChangeEventHandler<E>;
  onCompositionStart?: CompositionEventHandler<E>;
  onCompositionEnd?: CompositionEventHandler<E>;
}

/** The props that bind an element to the text; spread them after its own attributes, whose `value` and `defaultValue` they replace. */
function useTextControl<E extends TextElement>(
  doc: string,
  field: string,
  { readOnly, onChange, onCompositionStart, onCompositionEnd }: Wrapped<E>,
) {
  const store = getStore();
  const path = documentPath(doc);
  validateName(field, "A field name");
  store.suspendUntilSynced();
  const text = useMemo(() => store.text(path, field), [store, path, field]);
  const value = useStoreValue(path, text.value);
  const editable = useStoreValue(path, text.editable);
  const canEdit =
    useStoreValue(STATUS_KEY, () => store.status.canEdit) && editable;
  const [composing, setComposing] = useState<string | null>(null);
  const element = useRef<E>(null);
  const selection = useRef<{ start: unknown; end: unknown } | null>(null);

  useEffect(() => {
    if (!editable && store.data(path)) {
      const held = store.opaqueAt(path, field);
      warnOnce(
        `text:${path}:${field}`,
        held
          ? `"${field}" on "${path}" is a ${held.of} field, not a shared text; edit it with the @kits/components component that created it.`
          : `"${field}" on "${path}" is not a shared text; create it with sharedText().`,
      );
    }
  }, [editable, store, path, field]);

  const remember = useCallback(() => {
    const control = element.current;
    if (control && document.activeElement === control) {
      selection.current = {
        start: text.anchor(control.selectionStart ?? 0),
        end: text.anchor(control.selectionEnd ?? 0),
      };
    }
  }, [text]);

  useEffect(() => {
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, [remember]);

  useLayoutEffect(() => {
    const control = element.current;
    const remembered = selection.current;
    if (!control || !remembered || document.activeElement !== control) {
      return;
    }
    const start = text.indexOf(remembered.start);
    const end = text.indexOf(remembered.end);
    if (start !== undefined && end !== undefined) {
      const length = control.value.length;
      control.setSelectionRange(
        Math.min(start, length),
        Math.min(Math.max(start, end), length),
      );
    }
  }, [text, value]);

  const apply = (control: E) => {
    text.edit(control.value, control.selectionEnd ?? control.value.length);
    remember();
  };

  const handleChange = (event: ChangeEvent<E>) => {
    if ((event.nativeEvent as InputEvent).isComposing || composing !== null) {
      setComposing(event.target.value);
      return;
    }
    apply(event.target);
    onChange?.(event);
  };

  const handleCompositionStart = (event: CompositionEvent<E>) => {
    setComposing(event.currentTarget.value);
    onCompositionStart?.(event);
  };

  const handleCompositionEnd = (event: CompositionEvent<E>) => {
    setComposing(null);
    apply(event.currentTarget);
    onChange?.(event as unknown as ChangeEvent<E>);
    onCompositionEnd?.(event);
  };

  return {
    ref: element,
    value: composing ?? value,
    defaultValue: undefined,
    readOnly: readOnly || !canEdit,
    onChange: handleChange,
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
    onSelect: remember,
  };
}
