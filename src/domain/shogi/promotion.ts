import { Piece, PieceType, Player } from '../../types/shogi';
import { Coordinate } from './coordinates';

export type PromotionStatus = 'none' | 'optional' | 'required';

const PROMOTABLE_PIECE_TYPES: ReadonlySet<PieceType> = new Set([
  'pawn',
  'lance',
  'knight',
  'silver',
  'bishop',
  'rook',
]);

/** Returns whether an unpromoted piece type has a promoted form. */
export function isPromotablePieceType(type: PieceType): boolean {
  return PROMOTABLE_PIECE_TYPES.has(type);
}

/** Returns whether the piece can promote from its current state. */
export function canPiecePromote(piece: Piece): boolean {
  return isPromotablePieceType(piece.type) && !piece.isPromoted;
}

/** Returns whether a board row is inside the player's promotion zone. */
export function isPromotionZone(player: Player, row: number): boolean {
  return player === 'sente' ? row >= 0 && row <= 2 : row >= 6 && row <= 8;
}

/** Returns whether a move crosses or occurs within the player's promotion zone. */
export function canPromoteMove(piece: Piece, from: Coordinate, to: Coordinate): boolean {
  return (
    canPiecePromote(piece) &&
    (isPromotionZone(piece.player, from.row) || isPromotionZone(piece.player, to.row))
  );
}

/** Returns whether declining promotion would leave a pawn, lance, or knight immobile. */
export function isPromotionRequired(piece: Piece, to: Coordinate): boolean {
  if (!canPiecePromote(piece)) {
    return false;
  }

  if (piece.type === 'pawn' || piece.type === 'lance') {
    return piece.player === 'sente' ? to.row === 0 : to.row === 8;
  }

  if (piece.type === 'knight') {
    return piece.player === 'sente' ? to.row <= 1 : to.row >= 7;
  }

  return false;
}

/** Classifies the promotion choice required for a move. */
export function getPromotionStatus(
  piece: Piece,
  from: Coordinate,
  to: Coordinate
): PromotionStatus {
  if (!canPromoteMove(piece, from, to)) {
    return 'none';
  }

  return isPromotionRequired(piece, to) ? 'required' : 'optional';
}

// Explicit aliases keep the domain API easy to discover at call sites.
export const isPieceTypePromotable = isPromotablePieceType;
export const isMovePromotable = canPromoteMove;
export const getMovePromotionStatus = getPromotionStatus;
