import type { BoardState } from '../types/shogi';
import { createComparisonSnapshot, type EvaluationPresetComparisonResult } from '../domain/shogi/evaluationPresetComparison';
import type { EvaluationPresetComparisonWorkerRequest, EvaluationPresetComparisonWorkerResponse } from '../workers/evaluationPresetComparisonWorkerProtocol';
import { createSearchWorker, createSearchWorkerRequestId, runSearchWorkerJob, type SearchWorkerLike } from './searchWorkerJob';
import { isSameComparisonPosition, validateEvaluationPresetComparison } from './evaluationPresetComparisonValidation';

export function createEvaluationPresetComparisonWorkerClient(dependencies: {
  workerFactory?: () => SearchWorkerLike<EvaluationPresetComparisonWorkerRequest>;
  requestIdFactory?: () => string;
} = {}) {
  return {
    run(state: BoardState, depth: number, signal?: AbortSignal): Promise<readonly EvaluationPresetComparisonResult[]> {
      const snapshot = createComparisonSnapshot(state);
      return runSearchWorkerJob(dependencies.workerFactory ?? createSearchWorker<EvaluationPresetComparisonWorkerRequest>, () => ({ type: 'compare-evaluation-presets' as const,
        requestId: dependencies.requestIdFactory?.() ?? createSearchWorkerRequestId(), state: snapshot, depth,
      }), (data) => {
        const response = data as EvaluationPresetComparisonWorkerResponse;
        if (response.type === 'evaluation-preset-comparison-failed') throw new Error(response.errorMessage);
        if (response.type !== 'evaluation-preset-comparison-succeeded' || response.depth !== depth ||
          !isSameComparisonPosition(snapshot, response.state)) throw new Error('比較の開始局面または深さが一致しません。');
        validateEvaluationPresetComparison(snapshot, depth, response.results);
        return response.results;
      }, signal);
    },
  };
}

export function runEvaluationPresetComparisonInWorker(state: BoardState, depth: number, signal?: AbortSignal) {
  return createEvaluationPresetComparisonWorkerClient().run(state, depth, signal);
}
