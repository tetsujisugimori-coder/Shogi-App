/**
 * Shogi Move Candidate Generation
 * Pure functions to compute legal move destinations for board pieces according to Shogi rules.
 *
 * Rules enforced:
 * - Within 9x9 board boundary
 * - Cannot move onto own piece
 * - Cannot jump over intermediate pieces for ray-moving pieces (Rook, Bishop, Lance)
 * - Can capture opponent piece (and stops ray upon capture)
 * - King / Gyoku pieces cannot be captured (excluded from move candidates)
 */

import { BoardSquare, Piece, PieceType, Player } from '../../types/shogi';
import { Coordinate, isWithinBoard } from './coordinates';

/**
 * Directional ray vectors [dRow, dCol]
 */
const ORTHOGONAL_DIRECTIONS: readonly [number, number][] = [
  [-1, 0], // Up (Sente forward)
  [1, 0],  // Down (Gote forward)
  [0, -1], // Left (File +1)
  [0, 1],  // Right (File -1)
];

const DIAGONAL_DIRECTIONS: readonly [number, number][] = [
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
 * Collects step moves for given [dRow, dCol] offsets from the origin.
 */
function collectStepMoves(
  squares: BoardSquare[][],
  from: Coordinate,
  piece: Piece,
  offsets: readonly [number, number][]
): Coordinate[] {
  const candidates: Coordinate[] = [];

  for (const [dr, dc] of offsets) {
    const targetRow = from.row + dr;
    const targetCol = from.col + dc;

    if (!isWithinBoard(targetRow, targetCol)) continue;

    const targetSquare = squares[targetRow][targetCol];
    if (!targetSquare.piece) {
      // Empty square
      candidates.push({ row: targetRow, col: targetCol });
    } else if (targetSquare.piece.player !== piece.player) {
      // Opponent piece - can capture unless it's a King
      if (targetSquare.piece.type !== 'king') {
        candidates.push({ row: targetRow, col: targetCol });
      }
    }
    // If own piece, cannot move onto it
  }

  return candidates;
}

/**
 * Collects ray moves (sliding) along the given direction vectors.
 */
function collectRayMoves(
  squares: BoardSquare[][],
  from: Coordinate,
  piece: Piece,
  directions: readonly [number, number][]
): Coordinate[] {
  const candidates: Coordinate[] = [];

  for (const [dr, dc] of directions) {
    let currRow = from.row + dr;
    let currCol = from.col + dc;

    while (isWithinBoard(currRow, currCol)) {
      const targetSquare = squares[currRow][currCol];

      if (!targetSquare.piece) {
        // Empty square, can move here and continue ray
        candidates.push({ row: currRow, col: currCol });
      } else {
        // Square is occupied
        if (targetSquare.piece.player !== piece.player) {
          // Opponent piece - can capture unless King, then stop ray
          if (targetSquare.piece.type !== 'king') {
            candidates.push({ row: currRow, col: currCol });
          }
        }
        // Blocked by piece (own or opponent), stop sliding in this direction
        break;
      }

      currRow += dr;
      currCol += dc;
    }
  }

  return candidates;
}

/**
 * Computes move candidates for a given piece at a specific position on the board.
 */
export function getPieceMoves(
  squares: BoardSquare[][],
  from: Coordinate,
  piece: Piece
): Coordinate[] {
  const forward = getForwardDelta(piece.player);

  switch (piece.type) {
    case 'pawn': {
      // 1 step straight forward
      return collectStepMoves(squares, from, piece, [[forward, 0]]);
    }

    case 'lance': {
      // Straight forward ray
      return collectRayMoves(squares, from, piece, [[forward, 0]]);
    }

    case 'knight': {
      // 2 forward, 1 left or right
      const knightOffsets: [number, number][] = [
        [forward * 2, -1],
        [forward * 2, 1],
      ];
      return collectStepMoves(squares, from, piece, knightOffsets);
    }

    case 'silver': {
      // 1 step forward + 4 diagonals (5 directions)
      const silverOffsets: [number, number][] = [
        [forward, 0],
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ];
      return collectStepMoves(squares, from, piece, silverOffsets);
    }

    case 'gold': {
      // 4 orthogonals + 2 forward diagonals (6 directions)
      const goldOffsets: [number, number][] = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [forward, -1],
        [forward, 1],
      ];
      return collectStepMoves(squares, from, piece, goldOffsets);
    }

    case 'king': {
      // 8 adjacent directions (1 step)
      const kingOffsets: [number, number][] = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ];
      return collectStepMoves(squares, from, piece, kingOffsets);
    }

    case 'rook': {
      // 4 orthogonal rays
      return collectRayMoves(squares, from, piece, ORTHOGONAL_DIRECTIONS);
    }

    case 'bishop': {
      // 4 diagonal rays
      return collectRayMoves(squares, from, piece, DIAGONAL_DIRECTIONS);
    }

    default:
      return [];
  }
}

/**
 * Returns all valid move candidates for the piece at the specified square.
 * Returns empty array if square is empty or invalid.
 */
export function getMoveCandidates(
  squares: BoardSquare[][],
  from: Coordinate | null | undefined
): Coordinate[] {
  if (!from || !isWithinBoard(from.row, from.col)) {
    return [];
  }

  const square = squares[from.row][from.col];
  if (!square || !square.piece) {
    return [];
  }

  return getPieceMoves(squares, from, square.piece);
}
