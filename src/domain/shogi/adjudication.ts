import { BoardState, Player } from '../../types/shogi';
import { isPlayerInCheck, isCheckmate } from './checkmate';
import {
  classifyRepetition,
  createPositionKey,
  recordPositionAfterLegalMove,
} from './repetition';

/** Applies the common check/checkmate status after one already-legal move or drop. */
export function adjudicateAfterLegalMove(
  state: BoardState,
  movingPlayer: Player
): BoardState {
  const respondingPlayer = state.turn;
  const gaveCheck = isPlayerInCheck(state, respondingPlayer);
  const recordedState = recordPositionAfterLegalMove(state, movingPlayer, gaveCheck);

  if (isCheckmate(recordedState, respondingPlayer)) {
    return {
      ...recordedState,
      status: 'ended',
      result: {
        winner: movingPlayer,
        loser: respondingPlayer,
        endReason: 'checkmate',
      },
    };
  }

  const repetition = classifyRepetition(
    recordedState.positionHistory ?? [],
    createPositionKey(recordedState)
  );

  if (repetition?.kind === 'perpetual_check') {
    const checkingPlayer = repetition.checkingPlayer;
    const winner: Player = checkingPlayer === 'sente' ? 'gote' : 'sente';
    return {
      ...recordedState,
      status: 'ended',
      result: {
        winner,
        loser: checkingPlayer,
        endReason: 'foul_loss',
        foulReason: 'perpetual_check_repetition',
        details: '連続王手の千日手による反則負け',
      },
    };
  }

  if (repetition?.kind === 'repetition') {
    return {
      ...recordedState,
      status: 'ended',
      result: {
        winner: null,
        loser: null,
        endReason: 'repetition',
        details: '千日手による無勝負',
      },
    };
  }

  if (gaveCheck) {
    return {
      ...recordedState,
      status: 'check',
      result: null,
    };
  }

  return {
    ...recordedState,
    status: 'active',
    result: null,
  };
}
