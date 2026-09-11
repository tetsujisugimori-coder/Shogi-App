import type { TimeLimitedIterativeDeepeningAlphaBetaSearchResult } from '../domain/shogi/twoPlyAlphaBetaAi';
import type { BoardState } from '../types/shogi';
import type {
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest,
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse,
} from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerProtocol';

export interface TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerLike {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest): void;
  terminate(): void;
}

export type TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerFactory =
  () => TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerLike;

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

function createDefaultWorker(): TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerLike {
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

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `time-limited-iterative-alpha-beta-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient {
  run(
    state: BoardState,
    maxDepth: number,
    timeLimitMilliseconds: number,
    signal?: AbortSignal
  ): Promise<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>;
}

export interface TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClientDependencies {
  workerFactory?: TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerFactory;
  requestIdFactory?: () => string;
}

/**
 * Creates an application-layer client. Dependencies are only exposed here so
 * Worker lifecycle behavior can be tested without replacing browser globals.
 */
export function createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient(
  dependencies: TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClientDependencies = {}
): TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient {
  const workerFactory = dependencies.workerFactory ?? createDefaultWorker;
  const requestIdFactory = dependencies.requestIdFactory ?? createRequestId;

  return {
    run(state, maxDepth, timeLimitMilliseconds, signal) {
      if (signal?.aborted) {
        return Promise.reject(new TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerAbortError());
      }

      return new Promise((resolve, reject) => {
        let worker: TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerLike;
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

        const request: TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest = {
          type: 'run-time-limited-iterative-deepening-alpha-beta-search',
          requestId: requestIdFactory(),
          state,
          maxDepth,
          timeLimitMilliseconds,
        };

        worker.addEventListener('message', (event) => {
          if (typeof event.data !== 'object' || event.data === null ||
            !('requestId' in event.data) || !('type' in event.data)) {
            fail('Worker returned a malformed response.', 'WorkerProtocolError');
            return;
          }
          const response = event.data as TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse;
          if (response.requestId !== request.requestId) {
            fail('Worker response requestId did not match the submitted request.', 'WorkerProtocolError');
            return;
          }
          if (response.type === 'time-limited-iterative-deepening-alpha-beta-search-succeeded') {
            finish(() => resolve(response.result));
            return;
          }
          if (response.type === 'time-limited-iterative-deepening-alpha-beta-search-failed') {
            fail(response.errorMessage, response.errorName);
            return;
          }
          fail('Worker returned an unknown response type.', 'WorkerProtocolError');
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

        try {
          if (signal?.aborted) {
            abort();
            return;
          }
          worker.postMessage(request);
        } catch (error) {
          fail(error instanceof Error ? error.message : 'Web Worker request could not be posted.');
        }
      });
    },
  };
}

/** Runs one search in a dedicated Vite module Worker. */
export function runTimeLimitedIterativeDeepeningAlphaBetaSearchInWorker(
  state: BoardState,
  maxDepth: number,
  timeLimitMilliseconds: number,
  signal?: AbortSignal
): Promise<TimeLimitedIterativeDeepeningAlphaBetaSearchResult> {
  return createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient()
    .run(state, maxDepth, timeLimitMilliseconds, signal);
}
