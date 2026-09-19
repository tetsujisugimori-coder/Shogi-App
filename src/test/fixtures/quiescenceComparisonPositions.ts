import { createInitialBoardState, type BoardState } from '../../types/shogi';

/** Existing recapture trap, optionally with a gold for the depth-three horizon. */
export function comparisonCaptureTrap(withGold = false): BoardState {
  const state = createInitialBoardState();
  for (const row of state.squares) for (const square of row) square.piece = null;
  state.squares[8][8].piece = { id: 'sk', type: 'king', player: 'sente' };
  state.squares[0][8].piece = { id: 'gk', type: 'king', player: 'gote' };
  state.squares[5][4].piece = { id: 'sr', type: 'rook', player: 'sente' };
  state.squares[4][4].piece = { id: 'gp', type: 'pawn', player: 'gote' };
  state.squares[3][4].piece = { id: 'grp', type: 'pawn', player: 'gote' };
  if (withGold) state.squares[2][6].piece = { id: 'gg', type: 'gold', player: 'gote' };
  return state;
}

export function comparisonExtendedPv(): BoardState {
  const state = comparisonCaptureTrap();
  state.squares[1][0].piece = { id: 'gg', type: 'gold', player: 'gote' };
  return state;
}
