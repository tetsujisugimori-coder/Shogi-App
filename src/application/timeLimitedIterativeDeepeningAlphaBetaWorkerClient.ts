import { createSearchWorker, createSearchWorkerRequestId, runSearchWorkerJob, TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerError, type SearchWorkerLike } from './searchWorkerJob';
import { DEFAULT_SEARCH_EVALUATION_PRESET_ID, resolveSearchEvaluationPreset, type SearchEvaluationPresetId } from '../domain/shogi/searchEvaluationPresets';
import type { PresetTimeLimitedSearchResult } from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerProtocol';
import type { BoardState } from '../types/shogi';
import type {
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest,
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse,
} from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerProtocol';

export interface TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerLike
  extends SearchWorkerLike<TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest> {}

export type TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerFactory =
  () => TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerLike;

export { TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerError,
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerAbortError } from './searchWorkerJob';
export interface TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient {
  run(
    state: BoardState,
    maxDepth: number,
    timeLimitMilliseconds: number,
    signal?: AbortSignal,
    evaluationPresetId?: SearchEvaluationPresetId
  ): Promise<PresetTimeLimitedSearchResult>;
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
  const workerFactory = dependencies.workerFactory ?? createSearchWorker<TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest>;
  const requestIdFactory = dependencies.requestIdFactory ?? createSearchWorkerRequestId;

  return {
    run(state, maxDepth, timeLimitMilliseconds, signal, evaluationPresetId = DEFAULT_SEARCH_EVALUATION_PRESET_ID) {
      return runSearchWorkerJob(workerFactory, () => {
        resolveSearchEvaluationPreset(evaluationPresetId);
        return {
          type: 'run-time-limited-iterative-deepening-alpha-beta-search' as const,
          requestId: requestIdFactory(), state, maxDepth, timeLimitMilliseconds, evaluationPresetId,
        };
      }, (data) => {
        const response = data as TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse;
        if (response.type === 'time-limited-iterative-deepening-alpha-beta-search-succeeded') {
          if (response.result?.evaluationPresetId !== evaluationPresetId) {
            throw new TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerError(
              'Worker response preset did not match the submitted request.', 'WorkerProtocolError');
          }
          return response.result;
        }
        throw new TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerError(
          response.type === 'time-limited-iterative-deepening-alpha-beta-search-failed'
            ? response.errorMessage : 'Worker returned an unknown response type.',
          response.type === 'time-limited-iterative-deepening-alpha-beta-search-failed'
            ? response.errorName : 'WorkerProtocolError');
      }, signal);
    },
  };
}

/** Runs one search in a dedicated Vite module Worker. */
export function runTimeLimitedIterativeDeepeningAlphaBetaSearchInWorker(
  state: BoardState,
  maxDepth: number,
  timeLimitMilliseconds: number,
  signal?: AbortSignal,
  evaluationPresetId?: SearchEvaluationPresetId
): Promise<PresetTimeLimitedSearchResult> {
  return createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient()
    .run(state, maxDepth, timeLimitMilliseconds, signal, evaluationPresetId);
}
