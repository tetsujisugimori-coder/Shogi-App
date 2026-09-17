/** Shared one-request/one-Worker lifecycle; no synchronous fallback. */
export interface SearchWorkerLike<TRequest> {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: TRequest): void;
  terminate(): void;
}
export class TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerError extends Error {
  constructor(message: string, name = 'TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerError') {
    super(message);
    this.name = name;
  }
}

/** Identifies a search cancelled by the caller's AbortSignal. */
export class TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerAbortError extends Error {
  constructor() {
    super('Time-limited iterative deepening alpha-beta Worker search was aborted.');
    this.name = 'AbortError';
  }
}

export function createSearchWorker<TRequest>(): SearchWorkerLike<TRequest> {
  if (typeof Worker === 'undefined') {
    throw new TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerError(
      'Web Worker is not available in this environment.'
    );
  }

  return new Worker(
    new URL('../workers/timeLimitedIterativeDeepeningAlphaBeta.worker.ts', import.meta.url),
    { type: 'module' }
  );
}

export function createSearchWorkerRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `time-limited-iterative-alpha-beta-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function runSearchWorkerJob<TRequest extends { requestId: string }, TResult>(
  workerFactory: () => SearchWorkerLike<TRequest>,
  createRequest: () => TRequest,
  acceptResponse: (response: object) => TResult,
  signal?: AbortSignal,
): Promise<TResult> {
  if (signal?.aborted) {
    return Promise.reject(new TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerAbortError());
  }

  return new Promise<TResult>((resolve, reject) => {
    let worker: SearchWorkerLike<TRequest>;
    try {
      worker = workerFactory();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Web Worker could not be created.';
      reject(new TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerError(message));
      return;
    }

    let settled = false;
    let abortListenerAttached = false;
    const abort = (): void => {
      finish(() => reject(new TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerAbortError()));
    };
    const removeAbortListener = (): void => {
      if (!signal || !abortListenerAttached) return;
      signal.removeEventListener('abort', abort);
      abortListenerAttached = false;
    };
    const finish = (completion: () => void): void => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      worker.terminate();
      completion();
    };
    const fail = (message: string, name?: string): void => {
      finish(() => reject(new TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerError(message, name)));
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    let request: TRequest;
    try {
      request = createRequest();
      worker.addEventListener('message', (event) => {
        if (settled) return;
        try {
          const response = event.data;
          if (typeof response !== 'object' || response === null ||
            !('requestId' in response) || response.requestId !== request.requestId) {
            throw new TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerError(
              'Worker response requestId did not match the submitted request.', 'WorkerProtocolError');
          }
          const result = acceptResponse(response);
          finish(() => resolve(result));
        } catch (error) {
          fail(error instanceof Error ? error.message : 'Malformed Worker response.',
            error instanceof Error ? error.name : 'WorkerProtocolError');
        }
      });
      worker.addEventListener('error', (event) => {
        fail(event.message || 'Web Worker reported an error.');
      });
      worker.addEventListener('messageerror', () => {
        fail('Web Worker could not deserialize a message.', 'WorkerMessageError');
      });

      if (settled) return;

      if (signal) {
        abortListenerAttached = true;
        signal.addEventListener('abort', abort, { once: true });
        if (settled) return;
        if (signal.aborted) {
          abort();
          return;
        }
      }

      if (signal?.aborted) {
        abort();
        return;
      }
      worker.postMessage(request);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Web Worker request could not be posted.');
    }
  });
}
