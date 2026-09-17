import type { SearchEvaluationBreakdown } from '../../domain/shogi';
import type { Player } from '../../types/shogi';

/** The only root-player -> sente conversion used by all displayed scores. */
export function formatSenteEvaluation(value: number | null, perspective: Player): string {
  if (value === null || typeof value !== 'number' || Number.isNaN(value)) return '該当なし';
  const senteValue = perspective === 'sente' ? value : -value;
  if (senteValue === Infinity) return '+∞';
  if (senteValue === -Infinity) return '-∞';
  return senteValue > 0 ? `+${senteValue}` : String(senteValue);
}

/** Validate received data only; never evaluate a board in the UI. */
export function getDisplayEvaluationBreakdown(
  value: unknown,
  selectedEvaluation: number | null,
): SearchEvaluationBreakdown | null {
  if (typeof value !== 'object' || value === null ||
    !('total' in value) || !('material' in value) || !('pieceSquare' in value) ||
    !('kingSafety' in value) || !('undefendedPieceSafety' in value) || !('terminal' in value)) return null;
  const { total, material, pieceSquare, kingSafety, undefendedPieceSafety, terminal } = value;
  if (typeof total !== 'number' || Number.isNaN(total) || total !== selectedEvaluation ||
    typeof material !== 'number' || !Number.isFinite(material) ||
    typeof pieceSquare !== 'number' || !Number.isFinite(pieceSquare) ||
    typeof kingSafety !== 'number' || !Number.isFinite(kingSafety) ||
    typeof undefendedPieceSafety !== 'number' || !Number.isFinite(undefendedPieceSafety)) return null;
  if (terminal === null) {
    if (!Number.isFinite(total) || total !== material + pieceSquare + kingSafety + undefendedPieceSafety) return null;
  } else {
    if (terminal !== 'win' && terminal !== 'loss' && terminal !== 'draw') return null;
    const expectedTotal = terminal === 'win' ? Infinity : terminal === 'loss' ? -Infinity : 0;
    if (total !== expectedTotal || material !== 0 || pieceSquare !== 0 || kingSafety !== 0 || undefendedPieceSafety !== 0) return null;
  }
  return { total, material, pieceSquare, kingSafety, undefendedPieceSafety, terminal };
}
