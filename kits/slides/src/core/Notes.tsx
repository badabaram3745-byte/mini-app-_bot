import type { ReactNode } from "react";

export interface NotesProps {
  children: ReactNode;
}

/** The speaker notes of the surrounding `Slide`; the presenter sees them, the audience never does. */
export function Notes(_props: NotesProps) {
  return null;
}
