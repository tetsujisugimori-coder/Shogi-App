import { analyzeTimeLimitedQuiescenceComparison } from '../domain/shogi/timeLimitedQuiescenceComparison';
import type { TimeLimitedQuiescenceComparisonWorkerRequest, TimeLimitedQuiescenceComparisonWorkerResponse } from './timeLimitedQuiescenceComparisonWorkerProtocol';

export function handleTimeLimitedQuiescenceComparisonWorkerRequest(
  request: TimeLimitedQuiescenceComparisonWorkerRequest,
  compare = analyzeTimeLimitedQuiescenceComparison,
): TimeLimitedQuiescenceComparisonWorkerResponse {
  try {
    const results = compare(request.state, request.maxDepth, request.timeLimitMilliseconds);
    return { type: 'time-limited-quiescence-comparison-succeeded', requestId: request.requestId,
      state: request.state, maxDepth: request.maxDepth, timeLimitMilliseconds: request.timeLimitMilliseconds, results };
  } catch (error) {
    return { type: 'time-limited-quiescence-comparison-failed', requestId: request.requestId,
      errorName: error instanceof Error ? error.name : 'Error',
      errorMessage: error instanceof Error ? error.message : 'Quiescence comparison failed.' };
  }
}
