/**
 * Board Coordinate Helpers
 * Handles row/col (0-indexed) to file/rank (1-indexed) conversions and bounds checking.
 *
 * Board Geometry:
 * - row: 0 (Rank 1 / 一段目) to 8 (Rank 9 / 九段目)
 * - col: 0 (File 9 / 9筋) to 8 (File 1 / 1筋)
 * - file: 9 - col (9 to 1)
 * - rank: row + 1 (1 to 9)
 */

import { RANK_KANJI } from '../../types/shogi';

export interface Coordinate {
  row: number;
  col: number;
}

/**
 * Checks if a coordinate is strictly within the 9x9 board boundaries.
 */
export function isWithinBoard(row: number, col: number): boolean {
  return row >= 0 && row < 9 && col >= 0 && col < 9;
}

/**
 * Checks if two coordinates point to the exact same square.
 */
export function areCoordinatesEqual(a: Coordinate | null | undefined, b: Coordinate | null | undefined): boolean {
  if (!a || !b) return false;
  return a.row === b.row && a.col === b.col;
}

/**
 * Converts (row, col) to standard Japanese coordinate string (e.g. 7七, 5一).
 */
export function toCoordinateLabel(row: number, col: number): string {
  const file = 9 - col;
  const rankKanji = RANK_KANJI[row] ?? `${row + 1}`;
  return `${file}${rankKanji}`;
}

/**
 * Converts a standard coordinate string (e.g. '7七', '2八') to { row, col }.
 */
export function fromCoordinateLabel(label: string): Coordinate | null {
  if (!label || label.length < 2) return null;
  const fileChar = label.charAt(0);
  const rankChar = label.charAt(1);

  const file = parseInt(fileChar, 10);
  if (isNaN(file) || file < 1 || file > 9) return null;
  const col = 9 - file;

  const rowIndex = RANK_KANJI.indexOf(rankChar as any);
  if (rowIndex === -1) {
    const rankNum = parseInt(rankChar, 10);
    if (isNaN(rankNum) || rankNum < 1 || rankNum > 9) return null;
    return { row: rankNum - 1, col };
  }

  return { row: rowIndex, col };
}
