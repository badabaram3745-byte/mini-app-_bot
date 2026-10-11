import { AvatarGroup } from "@kits/clickup";
import { useViewersOfSlide } from "../core/slidePresence";

/** The people on a slide as a facepile; nothing when the viewer is alone there. */
export function SlideViewers({
  className,
  size,
  slideNumber,
}: {
  className: string;
  size: number;
  slideNumber: number;
}) {
  const viewers = useViewersOfSlide(slideNumber);
  return <AvatarGroup className={className} of={viewers} size={size} />;
}
