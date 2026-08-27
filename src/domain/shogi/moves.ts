/**
 * Shogi Move Generation & Legality Engine
 * Pure functions to compute pseudo-legal moves, filter out illegal moves (王手放置・自殺手・行き所のない駒),
 * and produce strictly legal moves according to standard Shogi rules.
 */

import { BoardSquare, Piece, Player } from '../../types/shogi';
import { Coordinate, isWithinBoard } from './coordinates';
import {
  getPieceAttackPattern,
  isKingInCheck,
} from './attacks';

/**
 * Checks if a move results in a piece having no legal forward moves ("行き所のない駒").
 * Applies only to unpromoted Pawns, Lances (cannot reach rank 1 for Sente / rank 9 for Gote)
 * and Knights (cannot reach ranks 1-2 for Sente / ranks 8-9 for Gote).
 */
export function isDeadPieceMove(piece: Piece, to: Coordinate): boolean {
  if (piece.isPromoted) {
    return false; // Promoted pieces (と金, 成香, 成桂) move like Gold and can retreat
  }

  if (piece.player === 'sente') {
    if (piece.type === 'pawn' || piece.type === 'lance') {
      return to.row === 0; // Rank 1 (top line)
    }
    if (piece.type === 'knight') {
      return to.row === 0 || to.row === 1; // Rank 1 or Rank 2
    }
  } else {
    // Gote
    if (piece.type === 'pawn' || piece.type === 'lance') {
      return to.row === 8; // Rank 9 (bottom line)
    }
    if (piece.type === 'knight') {
      return to.row === 7 || to.row === 8; // Rank 8 or Rank 9
    }
  }

  return false;
}

/**
 * Generates pseudo-legal moves for a piece based on geometric movement,
 * board boundaries, piece collision (stopping at obstacles), and own-piece blocking.
 * Excludes capturing opponent King directly.
 */
export function getPseudoLegalMoves(
  squares: BoardSquare[][],
  from: Coordinate,
  piece: Piece
): Coordinate[] {
  const candidates: Coordinate[] = [];
  const pattern = getPieceAttackPattern(piece);

  // Check single step moves
  for (const [dr, dc] of pattern.stepOffsets) {
    const targetRow = from.row + dr;
    const targetCol = from.col + dc;

    if (!isWithinBoard(targetRow, targetCol)) continue;

    const targetSquare = squares[targetRow][targetCol];
    if (!targetSquare.piece) {
      candidates.push({ row: targetRow, col: targetCol });
    } else if (targetSquare.piece.player !== piece.player) {
      // Opponent piece - can capture unless King
      if (targetSquare.piece.type !== 'king') {
        candidates.push({ row: targetRow, col: targetCol });
      }
    }
  }

  // Check sliding ray moves
  for (const [dr, dc] of pattern.rayDirections) {
    let currRow = from.row + dr;
    let currCol = from.col + dc;

    while (isWithinBoard(currRow, currCol)) {
      const targetSquare = squares[currRow][currCol];

      if (!targetSquare.piece) {
        candidates.push({ row: currRow, col: currCol });
      } else {
        if (targetSquare.piece.player !== piece.player) {
          // Can capture opponent piece unless King, then stop ray
          if (targetSquare.piece.type !== 'king') {
            candidates.push({ row: currRow, col: currCol });
          }
        }
        break; // Blocked by any piece
      }

      currRow += dr;
      currCol += dc;
    }
  }

  return candidates;
}

/**
 * Creates a lightweight simulated 9x9 board with the move applied, for checking king safety.
 */
export function simulateMoveSquares(
  squares: BoardSquare[][],
  from: Coordinate,
  to: Coordinate
): BoardSquare[][] {
  const nextSquares = squares.map((row) =>
    row.map((sq) => ({
      ...sq,
      piece: sq.piece ? { ...sq.piece } : null,
    }))
  );

  const movingPiece = nextSquares[from.row][from.col].piece;
  if (!movingPiece) return nextSquares;

  nextSquares[from.row][from.col].piece = null;
  nextSquares[to.row][to.col].piece = { ...movingPiece };

  return nextSquares;
}

/**
 * Computes strictly legal moves for a piece at `from`.
 * Validates:
 * 1. Piece exists and belongs to current turn (if specified).
 * 2. Basic geometric movements.
 * 3. Does NOT leave own King in check (resolves checks, prevents self-check & pinned piece violations).
 * 4. Does NOT create a dead piece (行き所のない駒).
 */
export function getLegalMoves(
  squares: BoardSquare[][],
  from: Coordinate | null | undefined,
  currentTurn?: Player
): Coordinate[] {
  if (!from || !isWithinBoard(from.row, from.col)) {
    return [];
  }

  const square = squares[from.row][from.col];
  if (!square || !square.piece) {
    return [];
  }

  const piece = square.piece;
  if (currentTurn && piece.player !== currentTurn) {
    return [];
  }

  const pseudoMoves = getPseudoLegalMoves(squares, from, piece);
  const legalMoves: Coordinate[] = [];

  for (const dest of pseudoMoves) {
    // 1. Dead piece check
    if (isDeadPieceMove(piece, dest)) {
      continue;
    }

    // 2. Simulate move and check if own king is left in check
    const simulatedSquares = simulateMoveSquares(squares, from, dest);
    if (isKingInCheck(simulatedSquares, piece.player)) {
      continue;
    }

    legalMoves.push(dest);
  }

  return legalMoves;
}

/**
 * Alias for backward-compatibility with UI components.
 */
export function getMoveCandidates(
  squares: BoardSquare[][],
  from: Coordinate | null | undefined,
  currentTurn?: Player
): Coordinate[] {
  return getLegalMoves(squares, from, currentTurn);
}
