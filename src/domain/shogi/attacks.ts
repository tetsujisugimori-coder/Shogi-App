/**
 * Shogi Attacks & Check Detection
 * Pure functions to compute piece attacks, find kings, and detect checks (王手).
 *
 * Design rules:
 * - Computes raw piece attacks without checking for resulting self-check (no circular recursion).
 * - Squares occupied by any piece (including kings) are valid attack targets and stop sliding rays.
 */

import { BoardSquare, Piece, Player } from '../../types/shogi';
import { Coordinate, isWithinBoard } from './coordinates';

/**
 * Standard directional ray vectors [dRow, dCol]
 */
export const ORTHOGONAL_DIRECTIONS: readonly [number, number][] = [
  [-1, 0], // Up (Sente forward)
  [1, 0],  // Down (Gote forward)
  [0, -1], // Left (File +1)
  [0, 1],  // Right (File -1)
];

export const DIAGONAL_DIRECTIONS: readonly [number, number][] = [
  [-1, -1], // Up-Left
  [-1, 1],  // Up-Right
  [1, -1],  // Down-Left
  [1, 1],   // Down-Right
];

/**
 * Returns the forward direction delta for the given player.
 * Sente moves upward (row decreases, delta = -1)
 * Gote moves downward (row increases, delta = +1)
 */
export function getForwardDelta(player: Player): number {
  return player === 'sente' ? -1 : 1;
}

/**
 * Finds the coordinate of the specified player's King on the board.
 */
export function findKingSquare(
  squares: BoardSquare[][],
  player: Player
): Coordinate | null {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = squares[r][c].piece;
      if (piece && piece.player === player && piece.type === 'king') {
        return { row: r, col: c };
      }
    }
  }
  return null;
}

export interface AttackPattern {
  stepOffsets: readonly [number, number][];
  rayDirections: readonly [number, number][];
}

/**
 * Returns the raw attack/influence pattern of a piece (step offsets and ray directions).
 * Correctly accounts for promoted pieces (と金, 成香, 成桂, 成銀, 竜王, 竜馬).
 */
export function getPieceAttackPattern(piece: Piece): AttackPattern {
  const forward = getForwardDelta(piece.player);

  if (piece.isPromoted) {
    switch (piece.type) {
      // Promoted minor pieces move like Gold (金将)
      case 'pawn':
      case 'lance':
      case 'knight':
      case 'silver':
        return {
          stepOffsets: [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
            [forward, -1],
            [forward, 1],
          ],
          rayDirections: [],
        };

      // Promoted Rook (竜王): Rook ray + 4 diagonals (1 step)
      case 'rook':
        return {
          stepOffsets: DIAGONAL_DIRECTIONS,
          rayDirections: ORTHOGONAL_DIRECTIONS,
        };

      // Promoted Bishop (竜馬): Bishop ray + 4 orthogonals (1 step)
      case 'bishop':
        return {
          stepOffsets: ORTHOGONAL_DIRECTIONS,
          rayDirections: DIAGONAL_DIRECTIONS,
        };

      default:
        break;
    }
  }

  // Non-promoted pieces
  switch (piece.type) {
    case 'pawn':
      return {
        stepOffsets: [[forward, 0]],
        rayDirections: [],
      };

    case 'lance':
      return {
        stepOffsets: [],
        rayDirections: [[forward, 0]],
      };

    case 'knight':
      return {
        stepOffsets: [
          [forward * 2, -1],
          [forward * 2, 1],
        ],
        rayDirections: [],
      };

    case 'silver':
      return {
        stepOffsets: [
          [forward, 0],
          [-1, -1],
          [-1, 1],
          [1, -1],
          [1, 1],
        ],
        rayDirections: [],
      };

    case 'gold':
      return {
        stepOffsets: [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
          [forward, -1],
          [forward, 1],
        ],
        rayDirections: [],
      };

    case 'king':
      return {
        stepOffsets: [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
          [-1, -1],
          [-1, 1],
          [1, -1],
          [1, 1],
        ],
        rayDirections: [],
      };

    case 'rook':
      return {
        stepOffsets: [],
        rayDirections: ORTHOGONAL_DIRECTIONS,
      };

    case 'bishop':
      return {
        stepOffsets: [],
        rayDirections: DIAGONAL_DIRECTIONS,
      };

    default:
      return {
        stepOffsets: [],
        rayDirections: [],
      };
  }
}

/**
 * Checks if a specific piece at `pieceCoord` is attacking `targetCoord`.
 */
export function isPieceAttacking(
  squares: BoardSquare[][],
  pieceCoord: Coordinate,
  piece: Piece,
  targetCoord: Coordinate
): boolean {
  const pattern = getPieceAttackPattern(piece);

  // Check step offsets
  for (const [dr, dc] of pattern.stepOffsets) {
    if (
      pieceCoord.row + dr === targetCoord.row &&
      pieceCoord.col + dc === targetCoord.col
    ) {
      return true;
    }
  }

  // Check ray directions
  for (const [dr, dc] of pattern.rayDirections) {
    let currRow = pieceCoord.row + dr;
    let currCol = pieceCoord.col + dc;

    while (isWithinBoard(currRow, currCol)) {
      if (currRow === targetCoord.row && currCol === targetCoord.col) {
        return true;
      }

      // If there's any piece blocking the ray, stop sliding
      if (squares[currRow][currCol].piece) {
        break;
      }

      currRow += dr;
      currCol += dc;
    }
  }

  return false;
}

/**
 * Determines whether `targetCoord` is currently under attack by any piece belonging to `attacker`.
 * NOTE: Target square is attacked regardless of what piece (including King or friendly piece) occupies it.
 */
export function isSquareAttackedBy(
  squares: BoardSquare[][],
  targetCoord: Coordinate,
  attacker: Player
): boolean {
  if (!isWithinBoard(targetCoord.row, targetCoord.col)) {
    return false;
  }

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = squares[r][c].piece;
      if (piece && piece.player === attacker) {
        if (isPieceAttacking(squares, { row: r, col: c }, piece, targetCoord)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Determines whether the specified player's King is in check (王手).
 */
export function isKingInCheck(
  squares: BoardSquare[][],
  player: Player
): boolean {
  const kingCoord = findKingSquare(squares, player);
  if (!kingCoord) {
    return false; // If no king exists on board, cannot be in check
  }

  const opponent: Player = player === 'sente' ? 'gote' : 'sente';
  return isSquareAttackedBy(squares, kingCoord, opponent);
}
