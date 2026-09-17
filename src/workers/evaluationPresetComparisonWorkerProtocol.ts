import type { BoardState } from '../types/shogi';
import type { EvaluationPresetComparisonResult } from '../domain/shogi/evaluationPresetComparison';

export interface EvaluationPresetComparisonWorkerRequest {
  type: 'compare-evaluation-presets';
  requestId: string;
  state: BoardState;
  depth: number;
}

export type EvaluationPresetComparisonWorkerResponse = {
  type: 'evaluation-preset-comparison-succeeded';
  requestId: string;
  state: BoardState;
  depth: number;
  results: readonly EvaluationPresetComparisonResult[];
} | {
  type: 'evaluation-preset-comparison-failed';
  requestId: string;
  errorName: string;
  errorMessage: string;
};
