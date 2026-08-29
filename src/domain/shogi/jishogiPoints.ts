import type { Piece } from '../../types/shogi';

/** Official jishogi value: major pieces are five points, small pieces one, kings zero. */
export function getJishogiPiecePoints(piece: Piece): number {
  if (piece.type === 'king') return 0;
  return piece.type === 'rook' || piece.type === 'bishop' ? 5 : 1;
}
