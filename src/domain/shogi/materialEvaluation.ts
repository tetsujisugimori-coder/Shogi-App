/**
 * Material-only position evaluation for future search consumers.
 *
 * This is deliberately separate from the official jishogi point calculation:
 * it compares owned material with AI-oriented values and does not decide a
 * game result.
 */
import type { BoardState, Piece, PieceType, Player } from '../../types/shogi';

type PromotablePieceType = Exclude<PieceType, 'gold' | 'king'>;

/** Values for unpromoted pieces and each legally promotable piece type. */
export interface MaterialValueTable {
  readonly unpromoted: Readonly<Record<PieceType, number>>;
  readonly promoted: Readonly<Record<PromotablePieceType, number>>;
}

/** Default AI material values. Kings have no material value. */
export const DEFAULT_MATERIAL_VALUE_TABLE = {
  unpromoted: {
    pawn: 100,
    lance: 300,
    knight: 300,
    silver: 400,
    gold: 500,
    bishop: 800,
    rook: 1000,
    king: 0,
  },
  promoted: {
    pawn: 500,
    lance: 500,
    knight: 500,
    silver: 500,
    bishop: 1000,
    rook: 1200,
  },
} as const satisfies MaterialValueTable;

function isPromotablePieceType(type: PieceType): type is PromotablePieceType {
  return type !== 'gold' && type !== 'king';
}

function getBoardPieceValue(piece: Piece, valueTable: MaterialValueTable): number {
  if (piece.isPromoted && isPromotablePieceType(piece.type)) {
    return valueTable.promoted[piece.type];
  }
  return valueTable.unpromoted[piece.type];
}

function getHandPieceValue(piece: Piece, valueTable: MaterialValueTable): number {
  // Captured pieces are unpromoted in hand, regardless of the optional flag.
  return valueTable.unpromoted[piece.type];
}

function getOwnedMaterialTotal(
  state: BoardState,
  player: Player,
  valueTable: MaterialValueTable
): number {
  let total = 0;

  for (const row of state.squares) {
    for (const square of row) {
      if (square.piece?.player === player) {
        total += getBoardPieceValue(square.piece, valueTable);
      }
    }
  }

  for (const handPiece of state.senteHand) {
    if (handPiece.player === player) total += getHandPieceValue(handPiece, valueTable);
  }
  for (const handPiece of state.goteHand) {
    if (handPiece.player === player) total += getHandPieceValue(handPiece, valueTable);
  }

  return total;
}

/**
 * Returns owned material from the explicit perspective: that side's total
 * minus the opponent's. Turn, terminal result, and legal-move state are not
 * part of this material-only evaluation.
 */
export function evaluateMaterial(
  state: BoardState,
  perspective: Player,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE
): number {
  const opponent = perspective === 'sente' ? 'gote' : 'sente';
  return getOwnedMaterialTotal(state, perspective, valueTable) -
    getOwnedMaterialTotal(state, opponent, valueTable);
}
