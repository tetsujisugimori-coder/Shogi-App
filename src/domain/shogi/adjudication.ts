import { BoardState, Player } from '../../types/shogi';
import { isPlayerInCheck, isCheckmate } from './checkmate';
import {
  classifyRepetition,
  createPositionKey,
  recordPositionAfterLegalMove,
} from './repetition';
import { classifyMoveLimitJishogi } from './moveLimitJishogi';

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
      moveLimitJishogi: null,
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
      moveLimitJishogi: null,
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
      moveLimitJishogi: null,
    };
  }

  const moveLimitJishogi = classifyMoveLimitJishogi(
    recordedState,
    movingPlayer,
    gaveCheck
  );

  if (moveLimitJishogi.kind === 'draw') {
    return {
      ...recordedState,
      status: 'ended',
      result: {
        winner: null,
        loser: null,
        endReason: 'five_hundred_move_jishogi',
        details: '500手規定による持将棋・無勝負',
      },
      moveLimitJishogi: null,
    };
  }

  const stateAfterMoveLimit =
    moveLimitJishogi.kind === 'waiting'
      ? { ...recordedState, moveLimitJishogi: moveLimitJishogi.state }
      : recordedState;

  if (gaveCheck) {
    return {
      ...stateAfterMoveLimit,
      status: 'check',
      result: null,
    };
  }

  return {
    ...stateAfterMoveLimit,
    status: 'active',
    result: null,
  };
}
