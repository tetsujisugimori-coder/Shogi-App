import { BoardState, Player } from '../../types/shogi';
import { isPlayerInCheck, isCheckmate } from './checkmate';

/** Applies the common check/checkmate status after one already-legal move or drop. */
export function adjudicateAfterLegalMove(
  state: BoardState,
  movingPlayer: Player
): BoardState {
  const respondingPlayer = state.turn;

  if (isCheckmate(state, respondingPlayer)) {
    return {
      ...state,
      status: 'ended',
      result: {
        winner: movingPlayer,
        loser: respondingPlayer,
        endReason: 'checkmate',
      },
    };
  }

  if (isPlayerInCheck(state, respondingPlayer)) {
    return {
      ...state,
      status: 'check',
      result: null,
    };
  }

  return {
    ...state,
    status: 'active',
    result: null,
  };
}
