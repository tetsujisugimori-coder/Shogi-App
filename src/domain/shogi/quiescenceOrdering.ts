import type { BoardState } from '../../types/shogi';
import type { LegalAction } from './legalActions';
import { getBoardPieceMaterialValue, type MaterialValueTable } from './materialEvaluation';

export type QuiescenceMoveOrderingMode = 'original' | 'material';

export function resolveQuiescenceMoveOrdering(mode: unknown): QuiescenceMoveOrderingMode {
  if (mode === undefined) return 'original';
  if (mode === 'original' || mode === 'material') return mode;
  throw new RangeError(`Unsupported quiescence move ordering mode: ${String(mode)}`);
}

/** Order an already selected candidate set, without generating or executing moves.
 * All non-capturing evasions retain their relative order, after captures.
 * Capture gain is opponent board loss PLUS our unpromoted hand gain.
 */
export function orderQuiescenceCandidates(
  state: BoardState, candidates: readonly LegalAction[], mode: QuiescenceMoveOrderingMode,
  table: MaterialValueTable, interruptionCheck?: () => void,
): readonly LegalAction[] {
  if (mode === 'original' || candidates.length < 2) return candidates;
  const ranked = candidates.map((action, index) => {
    interruptionCheck?.();
    const target = action.kind === 'move' ? state.squares[action.to.row][action.to.col].piece : null;
    const capture = target !== null && target.player !== action.player;
    if (!capture || action.kind !== 'move') return { action, index, capture: false, gain: 0, promotion: 0, attacker: 0 };
    const attacker = state.squares[action.from.row][action.from.col].piece!;
    const attackerValue = getBoardPieceMaterialValue(attacker, table);
    return {
      action, index, capture: true,
      gain: getBoardPieceMaterialValue(target, table) + table.unpromoted[target.type],
      promotion: action.promotion === 'promote'
        ? getBoardPieceMaterialValue({ ...attacker, isPromoted: true }, table) - attackerValue : 0,
      attacker: attackerValue,
    };
  });
  ranked.sort((a, b) => {
    interruptionCheck?.();
    return Number(b.capture) - Number(a.capture) || b.gain - a.gain ||
      b.promotion - a.promotion || a.attacker - b.attacker || a.index - b.index;
  });
  interruptionCheck?.();
  return ranked.map(({ action }) => action);
}
