import { quiescenceComparisonProtocolError } from './quiescenceComparisonValidation';
import type { BoardState } from '../types/shogi';
import type { TimeLimitedQuiescenceComparisonResult } from '../domain/shogi/timeLimitedQuiescenceComparison';
import { createComparisonSnapshot } from '../domain/shogi/evaluationPresetComparison';
import type { TimeLimitedQuiescenceComparisonWorkerRequest, TimeLimitedQuiescenceComparisonWorkerResponse } from '../workers/timeLimitedQuiescenceComparisonWorkerProtocol';
import { createSearchWorker, createSearchWorkerRequestId, runSearchWorkerJob, type SearchWorkerLike } from './searchWorkerJob';
import { isSameComparisonPosition } from './evaluationPresetComparisonValidation';
import { validateTimeLimitedQuiescenceComparison } from './timeLimitedQuiescenceComparisonValidation';

export function createTimeLimitedQuiescenceComparisonWorkerClient(dependencies: {
  workerFactory?: () => SearchWorkerLike<TimeLimitedQuiescenceComparisonWorkerRequest>;
  requestIdFactory?: () => string;
} = {}) {
  return {
    run(state: BoardState, maxDepth: number, timeLimitMilliseconds: number, signal?: AbortSignal): Promise<readonly TimeLimitedQuiescenceComparisonResult[]> {
      const snapshot = createComparisonSnapshot(state);
      return runSearchWorkerJob(dependencies.workerFactory ?? createSearchWorker<TimeLimitedQuiescenceComparisonWorkerRequest>, () => ({ type: 'compare-time-limited-quiescence-settings' as const,
        requestId: dependencies.requestIdFactory?.() ?? createSearchWorkerRequestId(), state: snapshot, maxDepth, timeLimitMilliseconds,
      }), (data) => {
        const response = data as TimeLimitedQuiescenceComparisonWorkerResponse;
        if (response.type === 'time-limited-quiescence-comparison-failed') {
          if (typeof response.errorName !== 'string' || typeof response.errorMessage !== 'string')
            throw quiescenceComparisonProtocolError('Malformed comparison failure.');
          const error = new Error(response.errorMessage);
          error.name = response.errorName;
          throw error;
        }
        if (response.type !== 'time-limited-quiescence-comparison-succeeded' || response.maxDepth !== maxDepth || response.timeLimitMilliseconds !== timeLimitMilliseconds ||
          !isSameComparisonPosition(snapshot, response.state)) throw quiescenceComparisonProtocolError('比較の開始局面または深さが一致しません。');
        validateTimeLimitedQuiescenceComparison(snapshot, maxDepth, timeLimitMilliseconds, response.results);
        return response.results;
      }, signal);
    },
  };
}

export function runTimeLimitedQuiescenceComparisonInWorker(state: BoardState, maxDepth: number, timeLimitMilliseconds: number, signal?: AbortSignal) {
  return createTimeLimitedQuiescenceComparisonWorkerClient().run(state, maxDepth, timeLimitMilliseconds, signal);
}
