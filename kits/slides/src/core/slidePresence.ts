import { useEffect } from "react";
import { shared, useCollaborators, type Collaborator } from "@kits/sync";

/** Tells everyone else which slide this viewer is on, by its number, for as long as the deck is open. */
export function useAnnounceSlide(slideNumber: number): void {
  useEffect(() => {
    shared.me.setPresence((current) => ({ ...current, slide: slideNumber }));
    return () => {
      shared.me.setPresence(({ slide: _, ...rest }) => rest);
    };
  }, [slideNumber]);
}

/** Everyone else on a slide, as their users; stable while nobody arrives or leaves. */
export function useViewersOfSlide(
  slideNumber: number,
): Array<Collaborator["user"]> {
  return useCollaborators((all) =>
    all
      .filter((collaborator) => collaborator.presence.slide === slideNumber)
      .map((collaborator) => collaborator.user),
  );
}
