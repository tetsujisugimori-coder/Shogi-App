import type { BoardState } from '../types/shogi';
import type { TimeLimitedQuiescenceComparisonResult } from '../domain/shogi/timeLimitedQuiescenceComparison';

export interface TimeLimitedQuiescenceComparisonWorkerRequest {
  type: 'compare-time-limited-quiescence-settings';
  requestId: string;
  state: BoardState;
  maxDepth: number;
  timeLimitMilliseconds: number;
}

export type TimeLimitedQuiescenceComparisonWorkerResponse = {
  type: 'time-limited-quiescence-comparison-succeeded';
  requestId: string;
  state: BoardState;
  maxDepth: number;
  timeLimitMilliseconds: number;
  results: readonly TimeLimitedQuiescenceComparisonResult[];
} | {
  type: 'time-limited-quiescence-comparison-failed';
  requestId: string;
  errorName: string;
  errorMessage: string;
};
