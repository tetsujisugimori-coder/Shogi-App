import { analyzeQuiescenceComparison } from '../domain/shogi/quiescenceComparison';
import type { QuiescenceComparisonWorkerRequest, QuiescenceComparisonWorkerResponse } from './quiescenceComparisonWorkerProtocol';

export function handleQuiescenceComparisonWorkerRequest(
  request: QuiescenceComparisonWorkerRequest,
  compare = analyzeQuiescenceComparison,
): QuiescenceComparisonWorkerResponse {
  try {
    const results = compare(request.state, request.depth);
    return { type: 'quiescence-comparison-succeeded', requestId: request.requestId,
      state: request.state, depth: request.depth, results };
  } catch (error) {
    return { type: 'quiescence-comparison-failed', requestId: request.requestId,
      errorName: error instanceof Error ? error.name : 'Error',
      errorMessage: error instanceof Error ? error.message : 'Quiescence comparison failed.' };
  }
}
