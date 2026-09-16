/**
 * Penalizes board pieces which are under raw enemy attack without any raw
 * friendly defender. This intentionally stays below material loss: it is a
 * shallow-search warning, not an exchange or capture evaluation.
 */
import type { BoardState, Player } from '../../types/shogi';
import { countSquareAttackersBy } from './attacks';
import { getOpponent } from './boardStateUtils';
import {
  DEFAULT_MATERIAL_VALUE_TABLE,
  getBoardPieceMaterialValue,
  type MaterialValueTable,
} from './materialEvaluation';

/**
 * A threatened, undefended piece loses only 10% of its existing board value.
 * This makes a rook warning (100) meaningful while remaining far below its
 * full material loss (1000); a pawn warning is correspondingly just 10.
 */
export const UNDEFENDED_PIECE_SAFETY_PENALTY_RATE = 0.1;

function ownedUndefendedPiecePenalty(
  state: BoardState,
  owner: Player,
  valueTable: MaterialValueTable
): number {
  const opponent = getOpponent(owner);
  let penalty = 0;

  for (let row = 0; row < state.squares.length; row += 1) {
    for (let col = 0; col < state.squares[row].length; col += 1) {
      const piece = state.squares[row][col].piece;
      // Kings have their own dedicated safety evaluation, and hand pieces do
      // not appear on board squares, so neither belongs to this heuristic.
      if (!piece || piece.player !== owner || piece.type === 'king') continue;

      const square = { row, col };
      const enemyAttackers = countSquareAttackersBy(state.squares, square, opponent);
      const friendlyDefenders = countSquareAttackersBy(state.squares, square, owner);
      if (enemyAttackers > 0 && friendlyDefenders === 0) {
        penalty += getBoardPieceMaterialValue(piece, valueTable) * UNDEFENDED_PIECE_SAFETY_PENALTY_RATE;
      }
    }
  }

  return penalty;
}

/**
 * Returns the opponent's undefended-piece penalty minus the explicit
 * perspective's penalty. A larger value is therefore better for
 * `perspective`, independently of turn, result, history, and hand pieces.
 *
 * The query deliberately uses the shared raw attacker-count contract: pinned
 * pieces still count as influence, while exchange analysis remains out of
 * scope.
 */
export function evaluateUndefendedPieceSafety(
  state: BoardState,
  perspective: Player,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE
): number {
  const opponent = getOpponent(perspective);
  return ownedUndefendedPiecePenalty(state, opponent, valueTable) -
    ownedUndefendedPiecePenalty(state, perspective, valueTable);
}
