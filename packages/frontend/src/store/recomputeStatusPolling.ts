const RECOMPUTE_POLL_BASE_INTERVAL_MS = 400;
const RECOMPUTE_POLL_MAX_INTERVAL_MS = 5_000;

interface RecomputeStatusPollControllerOptions<TStatus> {
  fetchStatus: (graphId: string) => Promise<TStatus>;
  onStatus: (graphId: string, status: TStatus) => void;
  shouldContinue: (graphId: string) => boolean;
}

export function createRecomputeStatusPollController<TStatus>({
  fetchStatus,
  onStatus,
  shouldContinue,
}: RecomputeStatusPollControllerOptions<TStatus>) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failureCount = 0;

  const stop = () => {
    if (typeof window === 'undefined') {
      return;
    }

    generation += 1;
    failureCount = 0;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const poll = async (graphId: string, activeGeneration: number) => {
    let nextPollDelayMs = RECOMPUTE_POLL_BASE_INTERVAL_MS;

    try {
      const status = await fetchStatus(graphId);
      if (activeGeneration !== generation) {
        return;
      }

      failureCount = 0;
      if (!shouldContinue(graphId)) {
        return;
      }

      onStatus(graphId, status);
    } catch {
      failureCount = Math.min(failureCount + 1, 8);
      nextPollDelayMs = Math.min(
        RECOMPUTE_POLL_BASE_INTERVAL_MS * (2 ** (failureCount - 1)),
        RECOMPUTE_POLL_MAX_INTERVAL_MS
      );
    } finally {
      if (
        activeGeneration === generation &&
        shouldContinue(graphId)
      ) {
        timer = setTimeout(() => {
          void poll(graphId, activeGeneration);
        }, nextPollDelayMs);
      }
    }
  };

  const start = (graphId: string) => {
    if (typeof window === 'undefined') {
      return;
    }

    stop();
    const activeGeneration = generation;
    void poll(graphId, activeGeneration);
  };

  return { start, stop };
}
