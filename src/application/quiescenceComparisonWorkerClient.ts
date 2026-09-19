import type { BoardState } from '../types/shogi';
import type { QuiescenceComparisonResult } from '../domain/shogi/quiescenceComparison';
import { createComparisonSnapshot } from '../domain/shogi/evaluationPresetComparison';
import type { QuiescenceComparisonWorkerRequest, QuiescenceComparisonWorkerResponse } from '../workers/quiescenceComparisonWorkerProtocol';
import { createSearchWorker, createSearchWorkerRequestId, runSearchWorkerJob, type SearchWorkerLike } from './searchWorkerJob';
import { isSameComparisonPosition } from './evaluationPresetComparisonValidation';
import { quiescenceComparisonProtocolError, validateQuiescenceComparison } from './quiescenceComparisonValidation';

export function createQuiescenceComparisonWorkerClient(dependencies: {
  workerFactory?: () => SearchWorkerLike<QuiescenceComparisonWorkerRequest>;
  requestIdFactory?: () => string;
} = {}) {
  return {
    run(state: BoardState, depth: number, signal?: AbortSignal): Promise<readonly QuiescenceComparisonResult[]> {
      const snapshot = createComparisonSnapshot(state);
      return runSearchWorkerJob(dependencies.workerFactory ?? createSearchWorker<QuiescenceComparisonWorkerRequest>, () => ({ type: 'compare-quiescence-settings' as const,
        requestId: dependencies.requestIdFactory?.() ?? createSearchWorkerRequestId(), state: snapshot, depth,
      }), (data) => {
        const response = data as QuiescenceComparisonWorkerResponse;
        if (response.type === 'quiescence-comparison-failed') {
          if (typeof response.errorName !== 'string' || typeof response.errorMessage !== 'string')
            throw quiescenceComparisonProtocolError('Malformed comparison failure.');
          const error = new Error(response.errorMessage);
          error.name = response.errorName;
          throw error;
        }
        if (response.type !== 'quiescence-comparison-succeeded' || response.depth !== depth ||
          !isSameComparisonPosition(snapshot, response.state)) throw quiescenceComparisonProtocolError('比較の開始局面または深さが一致しません。');
        validateQuiescenceComparison(snapshot, depth, response.results);
        return response.results;
      }, signal);
    },
  };
}

export function runQuiescenceComparisonInWorker(state: BoardState, depth: number, signal?: AbortSignal) {
  return createQuiescenceComparisonWorkerClient().run(state, depth, signal);
}
