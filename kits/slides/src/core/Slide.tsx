import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export type SlideTransition = "none" | "fade" | "slide";

export interface SlideProps extends Pick<
  HTMLAttributes<HTMLDivElement>,
  "className" | "style"
> {
  children?: ReactNode;
  staticAssets?: readonly string[];
  transition?: SlideTransition;
}

/** One slide of a `Deck`. Its children are what the audience sees; put `Step`s inside for the clicks and `Notes` for what the presenter says. */
export function Slide({ children }: SlideProps) {
  return <>{children}</>;
}

export interface SlideDefinition {
  id: string;
  content: ReactNode;
  notes: ReactNode | null;
  className?: string;
  style?: CSSProperties;
  staticAssets: readonly string[];
  transition?: SlideTransition;
}
