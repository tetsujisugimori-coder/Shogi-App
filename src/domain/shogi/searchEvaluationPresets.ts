/** Plain, structured-cloneable multipliers for the four existing terms. */
export interface SearchEvaluationCoefficients {
  readonly material: number;
  readonly pieceSquare: number;
  readonly kingSafety: number;
  readonly undefendedPieceSafety: number;
}

export const SEARCH_EVALUATION_PRESETS = Object.freeze({
  standard: Object.freeze({ material: 1, pieceSquare: 1, kingSafety: 1, undefendedPieceSafety: 1 }),
  'material-focused': Object.freeze({ material: 1.25, pieceSquare: 0.5, kingSafety: 0.5, undefendedPieceSafety: 1 }),
  'king-safety-focused': Object.freeze({ material: 1, pieceSquare: 1, kingSafety: 2, undefendedPieceSafety: 1 }),
} satisfies Record<string, SearchEvaluationCoefficients>);

export type SearchEvaluationPresetId = keyof typeof SEARCH_EVALUATION_PRESETS;
export const DEFAULT_SEARCH_EVALUATION_PRESET_ID: SearchEvaluationPresetId = 'standard';
export const SEARCH_EVALUATION_PRESET_IDS = Object.freeze(
  Object.keys(SEARCH_EVALUATION_PRESETS) as SearchEvaluationPresetId[]
);

export function isSearchEvaluationPresetId(value: unknown): value is SearchEvaluationPresetId {
  return typeof value === 'string' && Object.hasOwn(SEARCH_EVALUATION_PRESETS, value);
}

/** Unknown IDs fail at the Worker boundary instead of silently changing settings. */
export function resolveSearchEvaluationPreset(id: SearchEvaluationPresetId = DEFAULT_SEARCH_EVALUATION_PRESET_ID) {
  if (!isSearchEvaluationPresetId(id)) throw new Error('Unknown search evaluation preset.');
  return { coefficients: SEARCH_EVALUATION_PRESETS[id] };
}

export function validateSearchEvaluationCoefficients(coefficients: SearchEvaluationCoefficients): void {
  if (typeof coefficients !== 'object' || coefficients === null ||
    Object.keys(SEARCH_EVALUATION_PRESETS.standard).some((key) => {
      const value = coefficients[key as keyof SearchEvaluationCoefficients];
      return typeof value !== 'number' || !Number.isFinite(value) || value < 0;
    })) {
    throw new Error('Search evaluation coefficients must be finite, non-negative numbers for all four terms.');
  }
}
