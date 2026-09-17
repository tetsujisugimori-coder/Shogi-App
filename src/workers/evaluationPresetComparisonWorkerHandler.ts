import { analyzeEvaluationPresetComparison } from '../domain/shogi/evaluationPresetComparison';
import type { EvaluationPresetComparisonWorkerRequest, EvaluationPresetComparisonWorkerResponse } from './evaluationPresetComparisonWorkerProtocol';

export function handleEvaluationPresetComparisonWorkerRequest(
  request: EvaluationPresetComparisonWorkerRequest,
  compare = analyzeEvaluationPresetComparison,
): EvaluationPresetComparisonWorkerResponse {
  try {
    const results = compare(request.state, request.depth);
    return { type: 'evaluation-preset-comparison-succeeded', requestId: request.requestId,
      state: request.state, depth: request.depth, results };
  } catch (error) {
    return { type: 'evaluation-preset-comparison-failed', requestId: request.requestId,
      errorName: error instanceof Error ? error.name : 'Error',
      errorMessage: error instanceof Error ? error.message : 'Preset comparison failed.' };
  }
}
