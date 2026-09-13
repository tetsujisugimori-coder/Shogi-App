/**
 * Piece-square position evaluation, deliberately independent from material.
 *
 * Scores use the same small unit as the material table. The largest default
 * positional difference for one piece is 5 points, far below a pawn (100).
 * Every grid is written from Sente's view: row 8 is Sente's home rank and
 * row 0 is the far rank. Gote uses the 180-degree counterpart (8 - row,
 * 8 - col), so both players share precisely the same tables.
 */
import type { BoardState, Piece, PieceType, Player } from '../../types/shogi';

type PromotablePieceType = Exclude<PieceType, 'gold' | 'king'>;
export type PieceSquareGrid = readonly (readonly number[])[];

export interface PieceSquareValueTable {
  readonly unpromoted: Readonly<Record<PieceType, PieceSquareGrid>>;
  readonly promoted: Readonly<Record<PromotablePieceType, PieceSquareGrid>>;
}

function gridByRank(rankValues: readonly number[], centerFileBonus = 0): PieceSquareGrid {
  if (rankValues.length !== 9) throw new Error('A piece-square rank definition must contain nine rows.');
  return rankValues.map((rankValue) => [
    rankValue,
    rankValue,
    rankValue + centerFileBonus,
    rankValue + centerFileBonus,
    rankValue + centerFileBonus,
    rankValue + centerFileBonus,
    rankValue + centerFileBonus,
    rankValue,
    rankValue,
  ] as const);
}

/**
 * Conservative default piece-square tables. Pawns, lances, knights, and
 * silvers receive a modest advance/activity preference. Golds stay nearly
 * flat, and bishops/rooks get only a small central-work preference rather
 * than a bonus for entering the far ranks. Kings are intentionally neutral:
 * king safety is outside this evaluation.
 */
export const DEFAULT_PIECE_SQUARE_VALUE_TABLE = {
  unpromoted: {
    pawn: gridByRank([1, 2, 3, 3, 2, 1, 0, 0, -1], 1),
    lance: gridByRank([0, 1, 2, 2, 1, 0, 0, 0, -1]),
    knight: gridByRank([-2, -1, 1, 2, 2, 1, 0, 0, -1], 1),
    silver: gridByRank([0, 1, 2, 3, 3, 2, 1, 0, -1], 1),
    gold: gridByRank([0, 0, 0, 1, 1, 1, 1, 0, 0]),
    bishop: gridByRank([0, 0, 1, 1, 2, 1, 1, 0, 0], 1),
    rook: gridByRank([0, 0, 1, 1, 2, 1, 1, 0, 0], 1),
    king: gridByRank([0, 0, 0, 0, 0, 0, 0, 0, 0]),
  },
  promoted: {
    pawn: gridByRank([0, 1, 2, 2, 2, 1, 1, 0, 0], 1),
    lance: gridByRank([0, 1, 2, 2, 2, 1, 1, 0, 0], 1),
    knight: gridByRank([0, 1, 2, 2, 2, 1, 1, 0, 0], 1),
    silver: gridByRank([0, 1, 2, 2, 2, 1, 1, 0, 0], 1),
    bishop: gridByRank([0, 1, 1, 2, 2, 2, 1, 1, 0], 1),
    rook: gridByRank([0, 1, 1, 2, 2, 2, 1, 1, 0], 1),
  },
} as const satisfies PieceSquareValueTable;

function isPromotablePieceType(type: PieceType): type is PromotablePieceType {
  return type !== 'gold' && type !== 'king';
}

/** Returns the shared Sente-oriented table coordinate for a board square. */
export function toSentePieceSquareCoordinate(player: Player, row: number, col: number): { row: number; col: number } {
  return player === 'sente' ? { row, col } : { row: 8 - row, col: 8 - col };
}

function pieceSquareGrid(piece: Piece, table: PieceSquareValueTable): PieceSquareGrid {
  if (piece.isPromoted && isPromotablePieceType(piece.type)) return table.promoted[piece.type];
  return table.unpromoted[piece.type];
}

function ownedPieceSquareTotal(state: BoardState, player: Player, table: PieceSquareValueTable): number {
  let total = 0;
  for (let row = 0; row < state.squares.length; row += 1) {
    for (let col = 0; col < state.squares[row].length; col += 1) {
      const piece = state.squares[row][col].piece;
      if (!piece || piece.player !== player) continue;
      const coordinate = toSentePieceSquareCoordinate(piece.player, row, col);
      total += pieceSquareGrid(piece, table)[coordinate.row][coordinate.col];
    }
  }
  // Hand pieces have no board coordinate and deliberately receive no score.
  return total;
}

/**
 * Returns board-position points from the explicit perspective. This has no
 * dependency on turn, terminal state, history, or hand pieces.
 */
export function evaluatePieceSquarePosition(
  state: BoardState,
  perspective: Player,
  valueTable: PieceSquareValueTable = DEFAULT_PIECE_SQUARE_VALUE_TABLE
): number {
  const opponent = perspective === 'sente' ? 'gote' : 'sente';
  return ownedPieceSquareTotal(state, perspective, valueTable) -
    ownedPieceSquareTotal(state, opponent, valueTable);
}
