import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createNavigationState, navigationReducer } from "./navigationReducer";
import type { SlideDefinition } from "./Slide";
import { useSlideTransitionCoordinator } from "./slideTransitionCoordinator";

export interface SlideNavigation {
  next: () => void;
  previous: () => void;
  goToSlide: (slideNumber: number) => void;
}

interface DeckContextValue extends SlideNavigation {
  slideIndex: number;
  slideCount: number;
  revealedCount: number;
  revealedBySlide: number[];
  stepCounts: number[];
  setStepCount: (slideIndex: number, stepCount: number) => void;
  /** Steps reveal one beat at a time while presenting; elsewhere all of them show at once. */
  presenting: boolean;
  setPresenting: (presenting: boolean) => void;
}

const DeckContext = createContext<DeckContextValue | null>(null);
const SlidePositionContext = createContext<number | null>(null);

const NO_STEP_BEATS: number[] = [];

export function useDeckController(
  slides: SlideDefinition[],
  rootRef: RefObject<HTMLDivElement | null>,
): DeckContextValue {
  const slideCount = slides.length;
  const [state, dispatch] = useReducer(
    navigationReducer,
    slideCount,
    createNavigationState,
  );
  const [stepCounts, setStepCounts] = useState<number[]>(() =>
    Array.from({ length: slideCount }, () => 0),
  );
  const stepCountsRef = useRef(stepCounts);
  stepCountsRef.current = stepCounts;
  const [presenting, setPresenting] = useState(false);
  const presentingRef = useRef(presenting);
  presentingRef.current = presenting;

  useEffect(() => {
    const next = Array.from(
      { length: slideCount },
      (_, index) => stepCountsRef.current[index] ?? 0,
    );
    stepCountsRef.current = next;
    setStepCounts(next);
  }, [slideCount]);

  useEffect(() => {
    dispatch({ type: "syncSlides", slideCount, stepCounts });
  }, [slideCount, stepCounts]);
  const getStepCounts = useCallback(
    () => (presentingRef.current ? stepCountsRef.current : NO_STEP_BEATS),
    [],
  );
  const dispatchNavigation = useSlideTransitionCoordinator({
    dispatch,
    getStepCounts,
    rootRef,
    slides,
    state,
  });

  const setStepCount = useCallback((slideIndex: number, stepCount: number) => {
    const current = stepCountsRef.current;
    if (current[slideIndex] !== stepCount) {
      const next = [...current];
      next[slideIndex] = stepCount;
      stepCountsRef.current = next;
      setStepCounts(next);
    }
    dispatch({ type: "syncStepCount", slideIndex, stepCount });
  }, []);

  const next = useCallback(() => {
    dispatchNavigation({ type: "next" });
  }, [dispatchNavigation]);

  const previous = useCallback(() => {
    dispatchNavigation({ type: "previous" });
  }, [dispatchNavigation]);

  const goToSlide = useCallback(
    (slideNumber: number) => {
      if (!Number.isFinite(slideNumber)) {
        return;
      }
      dispatchNavigation({
        type: "goTo",
        slideIndex: Math.trunc(slideNumber) - 1,
      });
    },
    [dispatchNavigation],
  );
  const slideIndex = Math.min(state.slideIndex, slideCount - 1);

  return useMemo(
    () => ({
      slideIndex,
      slideCount,
      revealedCount: state.revealedBySlide[slideIndex] ?? 0,
      revealedBySlide: state.revealedBySlide,
      stepCounts,
      setStepCount,
      presenting,
      setPresenting,
      next,
      previous,
      goToSlide,
    }),
    [
      slideIndex,
      state.revealedBySlide,
      slideCount,
      stepCounts,
      setStepCount,
      presenting,
      next,
      previous,
      goToSlide,
    ],
  );
}

export function DeckProvider({
  value,
  children,
}: {
  value: DeckContextValue;
  children: ReactNode;
}) {
  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

export function SlidePositionProvider({
  slideIndex,
  children,
}: {
  slideIndex: number;
  children: ReactNode;
}) {
  return (
    <SlidePositionContext.Provider value={slideIndex}>
      {children}
    </SlidePositionContext.Provider>
  );
}

export function useDeckContext(): DeckContextValue {
  const value = useContext(DeckContext);
  if (!value) {
    throw new Error("Slide kit hooks must be used inside Deck.");
  }
  return value;
}

export function useSlideNumber(): number {
  const deck = useDeckContext();
  const renderedSlideIndex = useContext(SlidePositionContext);
  return (renderedSlideIndex ?? deck.slideIndex) + 1;
}

export function useSlideCount(): number {
  return useDeckContext().slideCount;
}

export function useSlideNavigation(): SlideNavigation {
  const { next, previous, goToSlide } = useDeckContext();
  return useMemo(
    () => ({ next, previous, goToSlide }),
    [next, previous, goToSlide],
  );
}
