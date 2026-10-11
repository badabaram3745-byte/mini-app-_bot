/** Own the state with `value`/`onChange`, or share it with `doc`/`field` on a `@kits/sync` document. */
export interface LocalBinding<T> {
  value: T;
  onChange: (value: T) => void;
  doc?: never;
  field?: never;
}

export interface SharedBinding {
  /** The document path, like `cards/${card.id}`. */
  doc: string;
  field: string;
  value?: never;
  onChange?: never;
}
