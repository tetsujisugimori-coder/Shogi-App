import type { BoardState } from '../types/shogi';
import type { QuiescenceComparisonResult } from '../domain/shogi/quiescenceComparison';

export interface QuiescenceComparisonWorkerRequest {
  type: 'compare-quiescence-settings';
  requestId: string;
  state: BoardState;
  depth: number;
}

export type QuiescenceComparisonWorkerResponse = {
  type: 'quiescence-comparison-succeeded';
  requestId: string;
  state: BoardState;
  depth: number;
  results: readonly QuiescenceComparisonResult[];
} | {
  type: 'quiescence-comparison-failed';
  requestId: string;
  errorName: string;
  errorMessage: string;
};
