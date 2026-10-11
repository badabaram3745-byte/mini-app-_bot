import {
  type Dispatch,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import {
  type NavigationAction,
  type NavigationState,
  navigationReducer,
} from "./navigationReducer";
import type { SlideDefinition } from "./Slide";
import {
  animateSlideTransition,
  resolveSlideTransition,
  STAGE_VIEW_TRANSITION_NAME,
  type ResolvedSlideTransition,
  type SlideTransitionDirection,
} from "../render/slideTransitions";

export type NavigationIntent =
  | { type: "next" }
  | { type: "previous" }
  | { type: "goTo"; slideIndex: number };

interface SlideTransitionCoordinatorOptions {
  dispatch: Dispatch<NavigationAction>;
  getStepCounts: () => number[];
  rootRef: RefObject<HTMLDivElement | null>;
  slides: SlideDefinition[];
  state: NavigationState;
}

const TRANSITION_ACTIVE_ATTRIBUTE = "slideKitTransition";
const SUPPRESS_HEROES_ATTRIBUTE = "slideTransitionSuppressHeroes";
const DURATION_PROPERTY = "--slide-kit-transition-duration";
const EASING_PROPERTY = "--slide-kit-transition-easing";

export function useSlideTransitionCoordinator({
  dispatch,
  getStepCounts,
  rootRef,
  slides,
  state,
}: SlideTransitionCoordinatorOptions): Dispatch<NavigationIntent> {
  const activeTransitionRef = useRef<ViewTransition | null>(null);
  const mountedRef = useRef(true);
  const pendingIntentsRef = useRef<NavigationIntent[]>([]);
  const processNextRef = useRef<(() => void) | null>(null);
  const skipRequestedRef = useRef<ViewTransition | null>(null);
  const slidesRef = useRef(slides);
  const stateRef = useRef(state);
  slidesRef.current = slides;
  stateRef.current = state;

  const requestActiveTransitionSkip = useCallback(() => {
    const transition = activeTransitionRef.current;
    if (!transition || skipRequestedRef.current === transition) {
      return;
    }
    skipRequestedRef.current = transition;
    const skip = () => {
      if (activeTransitionRef.current === transition) {
        transition.skipTransition();
      }
    };
    void transition.updateCallbackDone.then(skip, skip);
  }, []);

  const scheduleNext = useCallback(() => {
    requestAnimationFrame(() => processNextRef.current?.());
  }, []);

  processNextRef.current = () => {
    if (!mountedRef.current || activeTransitionRef.current) {
      return;
    }
    const intent = pendingIntentsRef.current.shift()!;

    const currentState = stateRef.current;
    const action = toNavigationAction(intent, getStepCounts());
    const nextState = navigationReducer(currentState, action);
    if (nextState.slideIndex === currentState.slideIndex) {
      stateRef.current = nextState;
      dispatch(action);
      if (pendingIntentsRef.current.length > 0) {
        scheduleNext();
      }
      return;
    }

    const root = rootRef.current;
    const stage = root?.querySelector(
      '[data-slide-surface="stage"], [data-slide-surface="presentation"]',
    );
    const startViewTransition =
      typeof document.startViewTransition === "function"
        ? document.startViewTransition.bind(document)
        : undefined;
    if (!root || !stage || !startViewTransition) {
      stateRef.current = nextState;
      dispatch(action);
      if (pendingIntentsRef.current.length > 0) {
        scheduleNext();
      }
      return;
    }

    const jump = nextState.direction === "jump";
    const direction: SlideTransitionDirection =
      nextState.direction === "backward" ? "backward" : "forward";
    const boundarySlide =
      direction === "backward"
        ? slidesRef.current[currentState.slideIndex]
        : slidesRef.current[nextState.slideIndex];
    const resolvedTransition = resolveSlideTransition(
      jump ? "fade" : boundarySlide?.transition,
      direction,
    );

    setDocumentTransitionState(resolvedTransition);
    setHeroSuppression(root, jump || hasConflictingHeroNames(root));

    const transition = startViewTransition(() => {
      stateRef.current = nextState;
      flushSync(() => dispatch(action));
      if (hasConflictingHeroNames(root)) {
        setHeroSuppression(root, true);
      }
    });

    activeTransitionRef.current = transition;
    void transition.ready.then(
      () => {
        if (activeTransitionRef.current !== transition) {
          return;
        }
        setHeroSuppression(root, false);
        animateSlideTransition(resolvedTransition);
      },
      () => setHeroSuppression(root, false),
    );
    const finish = () => {
      if (activeTransitionRef.current !== transition) {
        return;
      }
      activeTransitionRef.current = null;
      skipRequestedRef.current = null;
      clearDocumentTransitionState();
      setHeroSuppression(root, false);
      if (pendingIntentsRef.current.length > 0) {
        scheduleNext();
      }
    };
    void transition.finished.then(finish, finish);

    if (pendingIntentsRef.current.length > 0) {
      requestActiveTransitionSkip();
    }
  };

  const dispatchIntent = useCallback(
    (intent: NavigationIntent) => {
      pendingIntentsRef.current.push(intent);
      if (activeTransitionRef.current) {
        requestActiveTransitionSkip();
      } else {
        processNextRef.current?.();
      }
    },
    [requestActiveTransitionSkip],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingIntentsRef.current = [];
      activeTransitionRef.current?.skipTransition();
      activeTransitionRef.current = null;
      clearDocumentTransitionState();
      const root = rootRef.current;
      if (root) {
        setHeroSuppression(root, false);
      }
    };
  }, [rootRef]);

  return dispatchIntent;
}

function toNavigationAction(
  intent: NavigationIntent,
  stepCounts: number[],
): NavigationAction {
  switch (intent.type) {
    case "next":
    case "previous":
      return { type: intent.type, stepCounts };
    case "goTo":
      return intent;
  }
}

function setDocumentTransitionState(transition: ResolvedSlideTransition): void {
  const root = document.documentElement;
  root.dataset[TRANSITION_ACTIVE_ATTRIBUTE] = "";
  root.style.setProperty(DURATION_PROPERTY, `${transition.durationMs}ms`);
  root.style.setProperty(EASING_PROPERTY, transition.easing);
}

function clearDocumentTransitionState(): void {
  const root = document.documentElement;
  delete root.dataset[TRANSITION_ACTIVE_ATTRIBUTE];
  root.style.removeProperty(DURATION_PROPERTY);
  root.style.removeProperty(EASING_PROPERTY);
}

function setHeroSuppression(root: HTMLElement, suppressed: boolean): void {
  if (suppressed) {
    root.dataset[SUPPRESS_HEROES_ATTRIBUTE] = "";
  } else {
    delete root.dataset[SUPPRESS_HEROES_ATTRIBUTE];
  }
}

function hasConflictingHeroNames(root: HTMLElement): boolean {
  const names = new Set([STAGE_VIEW_TRANSITION_NAME]);
  const elements = root.querySelectorAll(
    '[data-slide-surface="stage"] .slide-kit-slide, ' +
      '[data-slide-surface="stage"] .slide-kit-slide *, ' +
      '[data-slide-surface="presentation"] .slide-kit-slide, ' +
      '[data-slide-surface="presentation"] .slide-kit-slide *',
  );
  for (const element of Array.from(elements)) {
    const name = getComputedStyle(element).getPropertyValue(
      "view-transition-name",
    );
    if (!name || name === "none") {
      continue;
    }
    if (names.has(name)) {
      return true;
    }
    names.add(name);
  }
  return false;
}
