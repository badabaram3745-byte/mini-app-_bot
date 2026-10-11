import { type RefObject, useEffect } from "react";
import { useDeckContext } from "../core/deckContext";
import { getOwnerWindow } from "../core/domEnvironment";

const WHEEL_THRESHOLD = 20;
const WHEEL_IDLE_RESET_MS = 250;
const WHEEL_NEW_GESTURE_GAP_MS = 150;
const WHEEL_REVERSAL_MIN = 4;
const WHEEL_DECAY_RUN = 3;
const WHEEL_RISE_FACTOR = 2;
const WHEEL_RISE_MIN = 12;
const SWIPE_DISTANCE = 50;
const SWIPE_DOMINANCE = 1.2;
const SWIPE_MAX_DURATION_MS = 600;

interface TouchStart {
  x: number;
  y: number;
  startedAt: number;
}

export function useSlideGestureNavigation({
  enabled,
  rootRef,
}: {
  enabled: boolean;
  rootRef: RefObject<HTMLElement | null>;
}) {
  const { next, previous } = useDeckContext();

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) {
      return;
    }
    const ownerWindow = getOwnerWindow(root);
    let accumulated = 0;
    let cooldown = false;
    let gestureSign = 0;
    let gestureAxis: "x" | "y" = "y";
    let lastMagnitude = 0;
    let lastEventAt = Number.NEGATIVE_INFINITY;
    let decayRun = 0;
    let tailEstablished = false;
    let wheelIdleTimer: number | null = null;
    let touchStart: TouchStart | null = null;

    const navigate = (forward: boolean) => {
      if (forward) {
        next();
      } else {
        previous();
      }
    };
    const resetWheelGesture = () => {
      accumulated = 0;
      cooldown = false;
      gestureSign = 0;
      lastMagnitude = 0;
      decayRun = 0;
      tailEstablished = false;
      wheelIdleTimer = null;
    };
    const onWheel = (event: WheelEvent) => {
      // Pinch-to-zoom arrives as ctrl+wheel.
      if (event.ctrlKey) {
        return;
      }
      event.preventDefault();
      if (wheelIdleTimer !== null) {
        ownerWindow.clearTimeout(wheelIdleTimer);
      }
      wheelIdleTimer = ownerWindow.setTimeout(
        resetWheelGesture,
        WHEEL_IDLE_RESET_MS,
      );
      if (!cooldown && accumulated === 0) {
        gestureAxis =
          Math.abs(event.deltaX) > Math.abs(event.deltaY) ? "x" : "y";
      }
      const delta = gestureAxis === "x" ? event.deltaX : event.deltaY;
      if (delta === 0) {
        return;
      }
      const magnitude = Math.abs(delta);
      const gap = event.timeStamp - lastEventAt;
      lastEventAt = event.timeStamp;
      if (cooldown) {
        const reversed =
          Math.sign(delta) !== gestureSign && magnitude >= WHEEL_REVERSAL_MIN;
        const separated =
          gap >= WHEEL_NEW_GESTURE_GAP_MS && magnitude >= lastMagnitude;
        const risen =
          tailEstablished &&
          magnitude >=
            Math.max(lastMagnitude * WHEEL_RISE_FACTOR, WHEEL_RISE_MIN);
        if (!reversed && !separated && !risen) {
          if (magnitude <= lastMagnitude) {
            decayRun += 1;
            tailEstablished = tailEstablished || decayRun >= WHEEL_DECAY_RUN;
          } else {
            decayRun = 0;
          }
          lastMagnitude = magnitude;
          return;
        }
        cooldown = false;
        accumulated = 0;
      }
      lastMagnitude = magnitude;
      accumulated += delta;
      if (Math.abs(accumulated) >= WHEEL_THRESHOLD) {
        gestureSign = Math.sign(accumulated);
        cooldown = true;
        accumulated = 0;
        decayRun = 0;
        tailEstablished = false;
        navigate(gestureSign > 0);
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touchStart = null;
        return;
      }
      const touch = event.touches[0]!;
      touchStart = {
        x: touch.clientX,
        y: touch.clientY,
        startedAt: Date.now(),
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchStart && event.touches.length === 1) {
        event.preventDefault();
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      const start = touchStart;
      touchStart = null;
      const touch = event.changedTouches[0];
      if (!start || !touch) {
        return;
      }
      const deltaX = start.x - touch.clientX;
      const deltaY = start.y - touch.clientY;
      if (
        Date.now() - start.startedAt <= SWIPE_MAX_DURATION_MS &&
        Math.abs(deltaY) >= SWIPE_DISTANCE &&
        Math.abs(deltaY) > Math.abs(deltaX) * SWIPE_DOMINANCE
      ) {
        event.preventDefault();
        navigate(deltaY > 0);
      }
    };
    const onTouchCancel = () => {
      touchStart = null;
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd, { passive: false });
    root.addEventListener("touchcancel", onTouchCancel);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchCancel);
      if (wheelIdleTimer !== null) {
        ownerWindow.clearTimeout(wheelIdleTimer);
      }
    };
  }, [enabled, next, previous, rootRef]);
}
