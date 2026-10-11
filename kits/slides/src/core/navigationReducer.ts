export type NavigationDirection = "forward" | "backward" | "jump";

export interface NavigationState {
  slideIndex: number;
  revealedBySlide: number[];
  direction: NavigationDirection;
}

export type NavigationAction =
  | { type: "next"; stepCounts: number[] }
  | { type: "previous"; stepCounts: number[] }
  | { type: "goTo"; slideIndex: number }
  | { type: "syncStepCount"; slideIndex: number; stepCount: number }
  | { type: "syncSlides"; slideCount: number; stepCounts: number[] };

export function createNavigationState(slideCount: number): NavigationState {
  return {
    slideIndex: 0,
    revealedBySlide: Array.from({ length: slideCount }, () => 0),
    direction: "jump",
  };
}

export function navigationReducer(
  state: NavigationState,
  action: NavigationAction,
): NavigationState {
  switch (action.type) {
    case "next":
      return advance(state, action.stepCounts);
    case "previous":
      return retreat(state, action.stepCounts);
    case "goTo":
      return goTo(state, action.slideIndex);
    case "syncStepCount":
      return syncStepCount(state, action.slideIndex, action.stepCount);
    case "syncSlides":
      return syncSlides(state, action.slideCount, action.stepCounts);
  }
}

function advance(
  state: NavigationState,
  stepCounts: number[],
): NavigationState {
  const stepCount = stepCounts[state.slideIndex] ?? 0;
  const revealed = state.revealedBySlide[state.slideIndex] ?? 0;
  if (revealed < stepCount) {
    return {
      ...state,
      revealedBySlide: replaceAt(
        state.revealedBySlide,
        state.slideIndex,
        revealed + 1,
      ),
      direction: "forward",
    };
  }

  if (state.slideIndex >= state.revealedBySlide.length - 1) {
    return state;
  }

  return {
    ...state,
    slideIndex: state.slideIndex + 1,
    revealedBySlide: replaceAt(state.revealedBySlide, state.slideIndex + 1, 0),
    direction: "forward",
  };
}

function retreat(
  state: NavigationState,
  stepCounts: number[],
): NavigationState {
  const revealed = state.revealedBySlide[state.slideIndex] ?? 0;
  if (revealed > 0) {
    return {
      ...state,
      revealedBySlide: replaceAt(
        state.revealedBySlide,
        state.slideIndex,
        revealed - 1,
      ),
      direction: "backward",
    };
  }

  if (state.slideIndex === 0) {
    return state;
  }

  const previousIndex = state.slideIndex - 1;
  return {
    ...state,
    slideIndex: previousIndex,
    revealedBySlide: replaceAt(
      state.revealedBySlide,
      previousIndex,
      stepCounts[previousIndex] ?? 0,
    ),
    direction: "backward",
  };
}

function goTo(state: NavigationState, slideIndex: number): NavigationState {
  const maxIndex = Math.max(0, state.revealedBySlide.length - 1);
  const target = Math.max(0, Math.min(maxIndex, Math.trunc(slideIndex)));

  return {
    ...state,
    slideIndex: target,
    revealedBySlide: replaceAt(state.revealedBySlide, target, 0),
    direction: "jump",
  };
}

function syncStepCount(
  state: NavigationState,
  slideIndex: number,
  stepCount: number,
): NavigationState {
  const revealed = state.revealedBySlide[slideIndex];
  if (revealed === undefined || revealed <= stepCount) {
    return state;
  }
  return {
    ...state,
    revealedBySlide: replaceAt(state.revealedBySlide, slideIndex, stepCount),
  };
}

function syncSlides(
  state: NavigationState,
  slideCount: number,
  stepCounts: number[],
): NavigationState {
  const revealedBySlide = Array.from({ length: slideCount }, (_, index) =>
    Math.min(state.revealedBySlide[index] ?? 0, stepCounts[index] ?? 0),
  );

  return {
    ...state,
    slideIndex: Math.min(state.slideIndex, slideCount - 1),
    revealedBySlide,
  };
}

function replaceAt(values: number[], index: number, value: number): number[] {
  const next = [...values];
  next[index] = value;
  return next;
}
