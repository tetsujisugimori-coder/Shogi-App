import {
  analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch,
  type TimeLimitedIterativeDeepeningAlphaBetaSearchResult,
} from '../domain/shogi/twoPlyAlphaBetaAi';
import type {
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerFailureResponse,
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest,
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse,
} from './timeLimitedIterativeDeepeningAlphaBetaWorkerProtocol';

export type TimeLimitedIterativeDeepeningAlphaBetaSearch = (
  state: TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest['state'],
  maxDepth: number,
  timeLimitMilliseconds: number
) => TimeLimitedIterativeDeepeningAlphaBetaSearchResult;

function toWorkerFailureResponse(
  requestId: string | null,
  error: unknown
): TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerFailureResponse {
  if (error instanceof Error) {
    return {
      type: 'time-limited-iterative-deepening-alpha-beta-search-failed',
      requestId,
      errorName: error.name || 'Error',
      errorMessage: error.message || 'Worker search failed.',
    };
  }

  return {
    type: 'time-limited-iterative-deepening-alpha-beta-search-failed',
    requestId,
    errorName: 'UnknownWorkerSearchError',
    errorMessage: typeof error === 'string' && error.length > 0
      ? error
      : 'Worker search failed with a non-Error value.',
  };
}

/**
 * Pure worker-side request handling. Keeping this independent of `self` makes
 * search behavior testable without a browser Worker implementation.
 */
export function handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(
  request: TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest,
  search: TimeLimitedIterativeDeepeningAlphaBetaSearch =
    analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch
): TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse {
  try {
    return {
      type: 'time-limited-iterative-deepening-alpha-beta-search-succeeded',
      requestId: request.requestId,
      result: search(request.state, request.maxDepth, request.timeLimitMilliseconds),
    };
  } catch (error) {
    return toWorkerFailureResponse(request.requestId, error);
  }
}
