/**
 * Penalizes board pieces which are under raw enemy attack without any raw
 * friendly defender. This intentionally stays below material loss: it is a
 * shallow-search warning, not an exchange or capture evaluation.
 */
import type { BoardState, Player } from '../../types/shogi';
import {
  createAttackCountMaps,
  getAttackCount,
  type AttackCountMaps,
} from './attacks';
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

export type PieceSafetyMode = 'legacy' | 'experimental';

export function resolvePieceSafetyMode(mode: unknown = 'legacy'): PieceSafetyMode {
  if (mode !== 'legacy' && mode !== 'experimental') throw new Error('Unknown piece safety mode.');
  return mode;
}

function ownedUndefendedPiecePenalty(
  state: BoardState,
  owner: Player,
  valueTable: MaterialValueTable,
  attackCountMaps: AttackCountMaps,
  mode: PieceSafetyMode
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
      const enemyAttackers = getAttackCount(attackCountMaps, square, opponent);
      const friendlyDefenders = getAttackCount(attackCountMaps, square, owner);
      if (enemyAttackers > 0 && (friendlyDefenders === 0 || mode === 'experimental')) {
        const value = getBoardPieceMaterialValue(piece, valueTable);
        if (mode === 'experimental' && (!Number.isFinite(value) || value < 0)) {
          throw new RangeError('Experimental piece safety requires finite non-negative board values.');
        }
        // Bounded raw pressure, NOT a legal exchange estimate. Pinned defenders
        // still count; neither numerical superiority nor defence proves safety.
        // Keep the historical arithmetic exactly for every undefended piece.
        const warning = value * UNDEFENDED_PIECE_SAFETY_PENALTY_RATE;
        penalty += mode === 'experimental' && friendlyDefenders > 0
          ? warning * (enemyAttackers / (enemyAttackers + friendlyDefenders)) : warning;
      }
    }
  }

  if (mode === 'experimental' && !Number.isFinite(penalty)) throw new RangeError('Piece safety penalty overflow.');
  return penalty;
}

/**
 * Returns the opponent's undefended-piece penalty minus the explicit
 * perspective's penalty. A larger value is therefore better for
 * `perspective`, independently of turn, result, history, and hand pieces.
 *
 * The query deliberately uses the shared raw attacker-count contract: pinned
 * pieces still count as influence. Experimental mode discounts the same 10%
 * warning by A/(A+D), instead of treating any defence as zero warning. It does
 * not prove a capture, recapture, pin resolution or material loss. Kings and
 * hand pieces remain excluded; no legal moves or SEE are generated here.
 */
export function evaluateUndefendedPieceSafety(
  state: BoardState,
  perspective: Player,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE,
  attackCountMaps: AttackCountMaps = createAttackCountMaps(state.squares),
  mode: PieceSafetyMode = 'legacy'
): number {
  resolvePieceSafetyMode(mode);
  const opponent = getOpponent(perspective);
  return ownedUndefendedPiecePenalty(state, opponent, valueTable, attackCountMaps, mode) -
    ownedUndefendedPiecePenalty(state, perspective, valueTable, attackCountMaps, mode);
}
