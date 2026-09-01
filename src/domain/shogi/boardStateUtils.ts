import type { BoardSquare, Player } from '../../types/shogi';

/** Deep-clones board squares and their pieces without mutating the source. */
export function cloneBoardSquares(squares: BoardSquare[][]): BoardSquare[][] {
  return squares.map((row) =>
    row.map((square) => ({
      ...square,
      piece: square.piece ? { ...square.piece } : null,
    }))
  );
}

/** Returns the opposing player. */
export function getOpponent(player: Player): Player {
  return player === 'sente' ? 'gote' : 'sente';
}
