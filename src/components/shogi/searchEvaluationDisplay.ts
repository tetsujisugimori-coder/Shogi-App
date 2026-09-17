import type { Player } from '../../types/shogi';

/** The only root-player -> sente conversion used by all displayed scores. */
export function formatSenteEvaluation(value: number | null, perspective: Player): string {
  if (value === null || typeof value !== 'number' || Number.isNaN(value)) return '該当なし';
  const senteValue = perspective === 'sente' ? value : -value;
  if (senteValue === Infinity) return '+∞';
  if (senteValue === -Infinity) return '-∞';
  return senteValue > 0 ? `+${senteValue}` : String(senteValue);
}

export { getDisplayEvaluationBreakdown } from '../../application/searchEvaluationBreakdownValidation';
