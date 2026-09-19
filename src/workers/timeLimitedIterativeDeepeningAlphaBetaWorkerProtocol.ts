import type { TimeLimitedIterativeDeepeningAlphaBetaSearchResult } from '../domain/shogi/twoPlyAlphaBetaAi';
import type { BoardState } from '../types/shogi';
import type { SearchEvaluationPresetId } from '../domain/shogi/searchEvaluationPresets';

/** The only tactical extensions exposed by the time-limited Worker contract. */
export type TimeLimitedSearchQuiescenceMaxTacticalDepth = 1 | 2;

export type PresetTimeLimitedSearchResult = TimeLimitedIterativeDeepeningAlphaBetaSearchResult & {
  readonly evaluationPresetId: SearchEvaluationPresetId;
  /** `null` means the Worker intentionally did not enable quiescence search. */
  readonly quiescenceMaxTacticalDepth: TimeLimitedSearchQuiescenceMaxTacticalDepth | null;
};

/** A structured-cloneable request sent from the UI thread to one search worker. */
export interface RunTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest {
  type: 'run-time-limited-iterative-deepening-alpha-beta-search';
  requestId: string;
  state: BoardState;
  maxDepth: number;
  timeLimitMilliseconds: number;
  /** Omitted by legacy callers: resolved to the shared default in the Worker. */
  evaluationPresetId?: SearchEvaluationPresetId;
  /** Omitted means quiescence search is disabled; only 1 and 2 are accepted. */
  quiescenceMaxTacticalDepth?: TimeLimitedSearchQuiescenceMaxTacticalDepth;
}

/** A completed time-limited search, preserving numeric values such as Infinity. */
export interface TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerSuccessResponse {
  type: 'time-limited-iterative-deepening-alpha-beta-search-succeeded';
  requestId: string;
  result: PresetTimeLimitedSearchResult;
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
