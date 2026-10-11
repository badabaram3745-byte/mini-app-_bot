interface YieldingScheduler {
  yield?: () => Promise<void>;
}

/** Lets the main thread run pending input and paint before the next slice of cache work. */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: YieldingScheduler }).scheduler;
  if (scheduler?.yield) {
    return scheduler.yield();
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

interface IdleWindow {
  requestIdleCallback?: (
    callback: () => void,
    options: { timeout: number },
  ) => number;
}

/** Runs `task` when the page is idle, or after `timeout` at the latest. */
export function whenIdle(task: () => void, timeout: number): void {
  const idle = (globalThis as IdleWindow).requestIdleCallback;
  if (idle) {
    idle(task, { timeout });
  } else {
    setTimeout(task, timeout);
  }
}
