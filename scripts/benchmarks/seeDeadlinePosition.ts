import { createInitialBoardState, type BoardState, type PieceType, type Player } from '../../src/types/shogi';

/** Composed fixture derived from the SEE multiple-recapture / opened-lance tests.
 * This is not the independent review's unavailable reported position.
 */
export function createSeeDeadlinePosition(): BoardState {
  const state = createInitialBoardState();
  for (const row of state.squares) for (const square of row) square.piece = null;
  const pieces: [number, number, PieceType, Player][] = [
    [8, 8, 'king', 'sente'], [0, 8, 'king', 'gote'],
    [5, 4, 'rook', 'sente'], [4, 4, 'pawn', 'gote'],
    [4, 0, 'rook', 'gote'], [3, 5, 'gold', 'gote'],
    [6, 4, 'lance', 'sente'], [2, 2, 'bishop', 'sente'], [5, 5, 'silver', 'sente'],
  ];
  for (const [row, col, type, player] of pieces) {
    state.squares[row][col].piece = { id: `${player}-${row}-${col}`, type, player };
  }
  state.recordId = 'see-deadline-branching';
  state.senteHand = []; state.goteHand = [];
  state.positionHistory = []; state.positionSnapshots = [];
  return state;
}
