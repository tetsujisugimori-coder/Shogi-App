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
import type { CheckInternalsProbe } from './checkInternalsDiagnostics';

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

/** Raw attacker counts for every on-board target square. */
export type AttackCountMap = number[][];

/** Raw attacker counts for both players in one immutable board position. */
export interface AttackCountMaps {
  readonly sente: AttackCountMap;
  readonly gote: AttackCountMap;
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
  for (const [dr, dc] of pattern.stepOffsets) {
    if (pieceCoord.row + dr === targetCoord.row && pieceCoord.col + dc === targetCoord.col)
      return true;
  }
  for (const [dr, dc] of pattern.rayDirections) {
    let currRow = pieceCoord.row + dr;
    let currCol = pieceCoord.col + dc;
    while (isWithinBoard(currRow, currCol)) {
      if (currRow === targetCoord.row && currCol === targetCoord.col) return true;
      if (squares[currRow][currCol].piece) break;
      currRow += dr;
      currCol += dc;
    }
  }
  return false;
}

/** Mirrors the public attack predicate with opt-in timing at its existing step/ray boundaries. */
function isPieceAttackingInternal(
  squares: BoardSquare[][], pieceCoord: Coordinate, piece: Piece,
  targetCoord: Coordinate, probe?: CheckInternalsProbe
): boolean {
  const pieceStart = probe ? performance.now() : 0;
  const pattern = getPieceAttackPattern(piece);
  if (probe) probe.record('pattern', performance.now() - pieceStart);

  // Check step offsets
  const stepStart = probe && pattern.stepOffsets.length ? performance.now() : 0;
  for (const [dr, dc] of pattern.stepOffsets) {
    if (
      pieceCoord.row + dr === targetCoord.row &&
      pieceCoord.col + dc === targetCoord.col
    ) {
      if (probe && pattern.stepOffsets.length) {
        probe.record('step', performance.now() - stepStart);
        probe.record('piece', performance.now() - pieceStart);
      }
      return true;
    }
  }
  if (probe && pattern.stepOffsets.length) probe.record('step', performance.now() - stepStart);

  // Check ray directions
  const rayStart = probe && pattern.rayDirections.length ? performance.now() : 0;
  for (const [dr, dc] of pattern.rayDirections) {
    let currRow = pieceCoord.row + dr;
    let currCol = pieceCoord.col + dc;

    while (isWithinBoard(currRow, currCol)) {
      if (currRow === targetCoord.row && currCol === targetCoord.col) {
        if (probe && pattern.rayDirections.length) {
          probe.record('ray', performance.now() - rayStart);
          probe.record('piece', performance.now() - pieceStart);
        }
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

  if (probe && pattern.rayDirections.length) {
    probe.record('ray', performance.now() - rayStart);
  }
  if (probe) probe.record('piece', performance.now() - pieceStart);
  return false;
}

/**
 * Counts the on-board pieces belonging to `attacker` that currently attack `targetCoord`.
 *
 * This is a raw influence query: pinned pieces are included, and any occupied target square
 * (including a friendly piece or King) can be attacked. Sliding rays include their first
 * occupied square and stop beyond it.
 */
export function countSquareAttackersBy(
  squares: BoardSquare[][],
  targetCoord: Coordinate,
  attacker: Player
): number {
  if (!isWithinBoard(targetCoord.row, targetCoord.col)) return 0;
  let attackerCount = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = squares[r][c].piece;
      if (piece?.player === attacker &&
        isPieceAttacking(squares, { row: r, col: c }, piece, targetCoord))
        attackerCount += 1;
    }
  }
  return attackerCount;
}

/** Stops at the first raw attacker; exact counts remain with countSquareAttackersBy. */
function hasSquareAttackerBy(
  squares: BoardSquare[][], targetCoord: Coordinate, attacker: Player
): boolean {
  if (!isWithinBoard(targetCoord.row, targetCoord.col)) return false;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = squares[r][c].piece;
      if (piece?.player === attacker &&
        isPieceAttacking(squares, { row: r, col: c }, piece, targetCoord))
        return true;
    }
  }
  return false;
}

/** The same early exit with opt-in aggregate diagnostics. */
function hasSquareAttackerByInternal(
  squares: BoardSquare[][], targetCoord: Coordinate, attacker: Player,
  probe?: CheckInternalsProbe
): boolean {
  if (!isWithinBoard(targetCoord.row, targetCoord.col)) {
    return false;
  }

  const searchStart = probe ? performance.now() : 0;
  if (probe) probe.attackScans++;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (probe) probe.scannedSquares++;
      const piece = squares[r][c].piece;
      if (piece?.player === attacker) {
        if (probe) { probe.opponentPieces++; probe.pieceCalls++; }
        if (isPieceAttackingInternal(squares, { row: r, col: c }, piece, targetCoord, probe)) {
          if (probe) {
            probe.earlyExits++;
            probe.record('attackSearch', performance.now() - searchStart);
          }
          return true;
        }
      }
    }
  }

  if (probe) probe.record('attackSearch', performance.now() - searchStart);
  return false;
}

function createEmptyAttackCountMap(): AttackCountMap {
  return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0));
}

/**
 * Builds raw influence counts for both players from this board position.
 *
 * The result deliberately matches `countSquareAttackersBy()`: pinned pieces
 * still contribute, step attacks count only on-board targets, and sliding
 * attacks include their first occupied square before stopping. It does not
 * generate legal moves and does not retain or modify the supplied board.
 */
export function createAttackCountMaps(squares: BoardSquare[][]): AttackCountMaps {
  const maps: AttackCountMaps = {
    sente: createEmptyAttackCountMap(),
    gote: createEmptyAttackCountMap(),
  };

  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = squares[row][col].piece;
      if (!piece) continue;

      const attacks = maps[piece.player];
      const pattern = getPieceAttackPattern(piece);

      for (const [rowOffset, colOffset] of pattern.stepOffsets) {
        const targetRow = row + rowOffset;
        const targetCol = col + colOffset;
        if (isWithinBoard(targetRow, targetCol)) {
          attacks[targetRow][targetCol] += 1;
        }
      }

      for (const [rowOffset, colOffset] of pattern.rayDirections) {
        let targetRow = row + rowOffset;
        let targetCol = col + colOffset;
        while (isWithinBoard(targetRow, targetCol)) {
          attacks[targetRow][targetCol] += 1;
          if (squares[targetRow][targetCol].piece) break;
          targetRow += rowOffset;
          targetCol += colOffset;
        }
      }
    }
  }

  return maps;
}

/**
 * Returns a raw precomputed attacker count with the same out-of-board
 * contract as `countSquareAttackersBy()`.
 */
export function getAttackCount(
  maps: AttackCountMaps,
  targetCoord: Coordinate,
  attacker: Player
): number {
  if (!isWithinBoard(targetCoord.row, targetCoord.col)) return 0;
  return maps[attacker][targetCoord.row][targetCoord.col];
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
  return hasSquareAttackerBy(squares, targetCoord, attacker);
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

/** Internal diagnostic route for quiescence legality; public attack APIs keep their normal path. */
export function isKingInCheckProfiled(
  squares: BoardSquare[][], player: Player, probe: CheckInternalsProbe
): boolean {
  const checkStart = performance.now();
  probe.checks++;
  const kingStart = performance.now();
  const kingCoord = findKingSquare(squares, player);
  probe.record('king', performance.now() - kingStart);
  let checked = false;
  if (kingCoord) {
    const opponent: Player = player === 'sente' ? 'gote' : 'sente';
    checked = hasSquareAttackerByInternal(squares, kingCoord, opponent, probe);
  }
  probe.record('check', performance.now() - checkStart);
  return checked;
}
