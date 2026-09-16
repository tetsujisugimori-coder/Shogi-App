import type { BoardState, Player } from '../../types/shogi';
import {
  createAttackCountMaps,
  getAttackCount,
  findKingSquare,
  type AttackCountMaps,
} from './attacks';
import { isWithinBoard } from './coordinates';
import { getOpponent } from './boardStateUtils';

/**
 * Weights for the pure king-safety heuristic. A direct attack on the King is
 * deliberately much more urgent than one uncovered attack on an adjacent square.
 * These provisional values are used by search unless explicitly overridden.
 */
export interface KingSafetyEvaluationWeights {
  readonly kingSquareAttack: number;
  readonly uncoveredAdjacentAttack: number;
}

export const DEFAULT_KING_SAFETY_EVALUATION_WEIGHTS: Readonly<KingSafetyEvaluationWeights> = {
  kingSquareAttack: 10,
  uncoveredAdjacentAttack: 1,
};

function kingDanger(
  state: BoardState,
  player: Player,
  weights: Readonly<KingSafetyEvaluationWeights>,
  attackCountMaps: AttackCountMaps
): number {
  const kingCoord = findKingSquare(state.squares, player);
  if (!kingCoord) return 0;

  const opponent = getOpponent(player);
  // Check pressure is not offset by friendly defenders: it is a distinct,
  // immediate risk from the balance of influence around the King.
  let danger = getAttackCount(attackCountMaps, kingCoord, opponent) * weights.kingSquareAttack;

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
      if (rowOffset === 0 && colOffset === 0) continue;

      const target = { row: kingCoord.row + rowOffset, col: kingCoord.col + colOffset };
      if (!isWithinBoard(target.row, target.col)) continue;

      const enemyAttackers = getAttackCount(attackCountMaps, target, opponent);
      // The King always attacks its adjacent squares and must not by itself make
      // an otherwise bare escape square look defended.
      const friendlyDefenders = Math.max(
        0,
        getAttackCount(attackCountMaps, target, player) - 1
      );
      danger += Math.max(0, enemyAttackers - friendlyDefenders) * weights.uncoveredAdjacentAttack;
    }
  }

  return danger;
}

/**
 * Returns the opponent King's danger minus the explicit perspective King's danger.
 * This raw-influence evaluation is independent of turn, terminal status, history,
 * hand pieces, and legal-move generation. If either King is absent from an
 * artificial position, it deliberately returns neutral rather than inferring a result.
 */
export function evaluateKingSafety(
  state: BoardState,
  perspective: Player,
  weights: Readonly<KingSafetyEvaluationWeights> = DEFAULT_KING_SAFETY_EVALUATION_WEIGHTS,
  attackCountMaps: AttackCountMaps = createAttackCountMaps(state.squares)
): number {
  const opponent = getOpponent(perspective);
  if (!findKingSquare(state.squares, perspective) || !findKingSquare(state.squares, opponent)) {
    return 0;
  }

  return kingDanger(state, opponent, weights, attackCountMaps) -
    kingDanger(state, perspective, weights, attackCountMaps);
}
