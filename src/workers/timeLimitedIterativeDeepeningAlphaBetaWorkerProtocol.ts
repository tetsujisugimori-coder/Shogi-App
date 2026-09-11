import type { TimeLimitedIterativeDeepeningAlphaBetaSearchResult } from '../domain/shogi/twoPlyAlphaBetaAi';
import type { BoardState } from '../types/shogi';

/** A structured-cloneable request sent from the UI thread to one search worker. */
export interface RunTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest {
  type: 'run-time-limited-iterative-deepening-alpha-beta-search';
  requestId: string;
  state: BoardState;
  maxDepth: number;
  timeLimitMilliseconds: number;
}

/** A completed time-limited search, preserving numeric values such as Infinity. */
export interface TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerSuccessResponse {
  type: 'time-limited-iterative-deepening-alpha-beta-search-succeeded';
  requestId: string;
  result: TimeLimitedIterativeDeepeningAlphaBetaSearchResult;
}

/** A structured-cloneable representation of an error raised by the worker. */
export interface TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerFailureResponse {
  type: 'time-limited-iterative-deepening-alpha-beta-search-failed';
  requestId: string | null;
  errorName: string;
  errorMessage: string;
}

export type TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest =
  RunTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest;

export type TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse =
  | TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerSuccessResponse
  | TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerFailureResponse;
