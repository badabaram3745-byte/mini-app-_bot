import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, type HTMLMotionProps, type Variants } from "motion/react";

export type StepMode = "controlled" | "interactive" | "static";

interface StepRegistryValue {
  mode: StepMode;
  revealedCount: number;
  indices: ReadonlyMap<string, number>;
  register: (id: string, element: HTMLElement) => () => void;
}

const StepRegistryContext = createContext<StepRegistryValue | null>(null);

const stepVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
    visibility: "hidden",
    transition: { duration: 0.18 },
  },
  visible: {
    opacity: 1,
    y: 0,
    visibility: "visible",
    transition: { duration: 0.22, ease: [0, 0, 0.2, 1] },
  },
};

interface StepRegistryProps {
  children: ReactNode;
  mode: StepMode;
  revealedCount: number;
  onStepCountChange?: (stepCount: number) => void;
}

export function StepRegistry({
  children,
  mode,
  revealedCount,
  onStepCountChange,
}: StepRegistryProps) {
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const onStepCountChangeRef = useRef(onStepCountChange);
  const mountedRef = useRef(false);
  const reportVersionRef = useRef(0);
  const [indices, setIndices] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  onStepCountChangeRef.current = onStepCountChange;

  const scheduleStepCountReport = useCallback(() => {
    const version = ++reportVersionRef.current;
    queueMicrotask(() => {
      if (mountedRef.current && version === reportVersionRef.current) {
        onStepCountChangeRef.current?.(elementsRef.current.size);
      }
    });
  }, []);

  const refresh = useCallback(() => {
    const entries = [...elementsRef.current.entries()].sort(
      ([, left], [, right]) => {
        return left.compareDocumentPosition(right) &
          Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1;
      },
    );
    setIndices(new Map(entries.map(([id], index) => [id, index])));
    scheduleStepCountReport();
  }, [scheduleStepCountReport]);

  const register = useCallback(
    (id: string, element: HTMLElement) => {
      elementsRef.current.set(id, element);
      refresh();
      return () => {
        elementsRef.current.delete(id);
        refresh();
      };
    },
    [refresh],
  );

  useLayoutEffect(() => {
    mountedRef.current = true;
    scheduleStepCountReport();
    return () => {
      mountedRef.current = false;
      reportVersionRef.current += 1;
    };
  }, [scheduleStepCountReport]);

  const value = useMemo(
    () => ({ mode, revealedCount, indices, register }),
    [mode, revealedCount, indices, register],
  );

  return (
    <StepRegistryContext.Provider value={value}>
      {children}
    </StepRegistryContext.Provider>
  );
}

export interface SlideStepsState {
  /** How many of the slide's steps are revealed so far. */
  revealed: number;
  total: number;
  /** True on the audience stage and the presenter's current slide, where animations play; other surfaces render the final pose at once. */
  interactive: boolean;
}

/** The slide's reveal state, for content outside a `Step` that reacts to reveals; on static surfaces every step counts as revealed. */
export function useSlideSteps(): SlideStepsState {
  const registry = useContext(StepRegistryContext);
  if (!registry) {
    throw new Error("useSlideSteps must be used inside a Slide.");
  }
  const total = registry.indices.size;
  return {
    revealed:
      registry.mode === "static"
        ? total
        : Math.min(registry.revealedCount, total),
    total,
    interactive: registry.mode === "interactive",
  };
}

export interface StepState {
  visible: boolean;
  /** The surrounding `Step`'s position among the slide's steps, in reveal order. */
  index: number;
}

const StepContext = createContext<StepState | null>(null);

/** The state of the nearest surrounding Step. */
export function useStep(): StepState {
  const value = useContext(StepContext);
  if (!value) {
    throw new Error("useStep must be used inside a Step.");
  }
  return value;
}

export interface StepProps extends Omit<
  HTMLMotionProps<"div">,
  "animate" | "initial" | "variants"
> {
  /** What appears when the presenter clicks; leave empty for a click that only advances `useSlideSteps()`. */
  children?: ReactNode;
}

export function Step({ children, transition, ...props }: StepProps) {
  const registry = useContext(StepRegistryContext);
  if (!registry) {
    throw new Error("Step must be rendered inside a Slide.");
  }

  const id = useId();
  const elementRef = useRef<HTMLDivElement | null>(null);
  const index = registry.indices.get(id);
  const visible =
    registry.mode === "static" ||
    (index !== undefined && index < registry.revealedCount);

  useLayoutEffect(() => {
    const element = elementRef.current;
    /* istanbul ignore if -- React assigns the host ref before layout effects. */
    if (!element) {
      return;
    }
    return registry.register(id, element);
  }, [id, registry.register]);

  useLayoutEffect(() => {
    /* istanbul ignore else -- React keeps the host ref throughout mounted updates. */
    if (elementRef.current) {
      elementRef.current.inert = !visible;
    }
  }, [visible]);

  const stepState = useMemo(
    () => ({ visible, index: index ?? -1 }),
    [visible, index],
  );

  return (
    <motion.div
      {...props}
      ref={elementRef}
      data-slide-step={visible ? "visible" : "hidden"}
      aria-hidden={!visible}
      initial={false}
      animate={visible ? "visible" : "hidden"}
      variants={stepVariants}
      transition={
        registry.mode === "interactive" ? transition : { duration: 0 }
      }
    >
      <StepContext.Provider value={stepState}>{children}</StepContext.Provider>
    </motion.div>
  );
}
