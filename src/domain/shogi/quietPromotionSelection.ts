import type { BoardState } from '../../types/shogi';
import type { LegalAction } from './legalActions';
import { findKingSquare, isPieceAttacking } from './attacks';
import { getBoardPieceMaterialValue, type MaterialValueTable } from './materialEvaluation';

/** Experimental approximation, never a proof that omitted promotions are inferior.
 * The caller chooses the per-node cap explicitly; there is no new default policy. */
export interface QuietPromotionSelection { readonly maxCandidates: number }

/** Require an own maxCandidates (enumerable or not). Inherited-only values are
 * rejected; unknown own keys, including symbols, are rejected. Read once and
 * build a plain snapshot so validation and copying cannot disagree. */
export function resolveQuietPromotionSelection(value: unknown): QuietPromotionSelection | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      !Object.prototype.hasOwnProperty.call(value, 'maxCandidates') ||
      Reflect.ownKeys(value).some(k => k !== 'maxCandidates')) {
    throw new RangeError('selectiveQuietPromotions requires an own positive safe integer maxCandidates.');
  }
  const maxCandidates = (value as QuietPromotionSelection).maxCandidates;
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    throw new RangeError('selectiveQuietPromotions requires an own positive safe integer maxCandidates.');
  }
  return { maxCandidates };
}

export function validateQuietPromotionSelection(value: unknown): asserts value is QuietPromotionSelection | undefined {
  resolveQuietPromotionSelection(value);
}

/** Rank already legal quiet promotions, without execution, legal regeneration or SEE.
 * Shadow only the two changed squares: moving a blocker can expose a recapture.
 * Raw influence includes pins, kings and x-rays blocked by the first occupant;
 * one recapture estimate does not model a complete exchange or forced responses. */
export function rankQuietPromotions(state: BoardState, actions: readonly LegalAction[],
  table: MaterialValueTable, interruptionCheck?: () => void) {
  const enemy = state.turn === 'sente' ? 'gote' : 'sente';
  let king: ReturnType<typeof findKingSquare> | undefined;
  const ranked = [];
  for (let index = 0; index < actions.length; index++) {
    interruptionCheck?.();
    const action = actions[index];
    if (action.kind !== 'move' || action.promotion !== 'promote' ||
        state.squares[action.to.row][action.to.col].piece !== null) continue;
    const piece = state.squares[action.from.row][action.from.col].piece!;
    const promoted = { ...piece, isPromoted: true };
    const gain = getBoardPieceMaterialValue(promoted, table) - getBoardPieceMaterialValue(piece, table);
    const squares = state.squares.map(row => row.slice());
    squares[action.from.row][action.from.col] = { ...squares[action.from.row][action.from.col], piece: null };
    squares[action.to.row][action.to.col] = { ...squares[action.to.row][action.to.col], piece: promoted };
    // Most nodes have no quiet promotion. Preserve all interruption checks, but
    // defer the board scan until it is actually needed by a promotion score.
    if (king === undefined) king = findKingSquare(state.squares, enemy);
    const check = king !== null && isPieceAttacking(squares, action.to, promoted, king);
    let cheapestAttacker = Infinity, defended = false;
    for (const row of squares) {
      interruptionCheck?.();
      for (const square of row) {
        const other = square.piece;
        if (!other || square.row === action.to.row && square.col === action.to.col) continue;
        if (!isPieceAttacking(squares, square, other, action.to)) continue;
        if (other.player === piece.player) defended = true;
        else cheapestAttacker = Math.min(cheapestAttacker,
          getBoardPieceMaterialValue(other, table) + table.unpromoted[other.type]);
      }
    }
    const loss = getBoardPieceMaterialValue(promoted, table) + table.unpromoted[piece.type];
    const risk = cheapestAttacker === Infinity ? 0 : Math.max(0, loss - (defended ? cheapestAttacker : 0));
    const score = gain - risk;
    if (![gain, risk, score].every(Number.isFinite)) throw new RangeError('Non-finite quiet promotion selection score.');
    ranked.push({ action, index, gain, risk, score, check });
  }
  ranked.sort((a,b) => b.score-a.score || Number(b.check)-Number(a.check) || a.index-b.index);
  interruptionCheck?.();
  return ranked;
}

export function selectQuietPromotions(state: BoardState, actions: readonly LegalAction[],
  table: MaterialValueTable, selection: QuietPromotionSelection, interruptionCheck?: () => void): LegalAction[] {
  return rankQuietPromotions(state, actions, table, interruptionCheck)
    .filter(r => r.check || r.score > 0).slice(0, selection.maxCandidates).map(r => r.action);
}
