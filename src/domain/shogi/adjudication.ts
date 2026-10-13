import { BoardState, Player } from '../../types/shogi';
import { isPlayerInCheck, hasLegalResponse } from './checkmate';
import {
  classifyRepetition,
  createPositionKey,
  recordPositionAfterLegalMove,
} from './repetition';
import { classifyMoveLimitJishogi } from './moveLimitJishogi';

/** Pure adjudication for a custom active/check position without a new move. */
export function adjudicateNoLegalActions(state: BoardState): BoardState | null {
  const bothKingsExist = (['sente', 'gote'] as const).every(player =>
    state.squares.some(row => row.some(square => square.piece?.type === 'king' && square.piece.player === player)));
  if (!bothKingsExist || (state.status !== 'active' && state.status !== 'check') || hasLegalResponse(state, state.turn)) return null;
  return {
    ...state, status: 'ended', moveLimitJishogi: null,
    result: {
      winner: state.turn === 'sente' ? 'gote' : 'sente', loser: state.turn,
      endReason: isPlayerInCheck(state, state.turn) ? 'checkmate' : 'no_legal_actions',
    },
  };
}

/** Applies terminal/check status after one already-legal move or drop. */
export function adjudicateAfterLegalMove(
  state: BoardState,
  movingPlayer: Player
): BoardState {
  const respondingPlayer = state.turn;
  const gaveCheck = isPlayerInCheck(state, respondingPlayer);
  const recordedState = recordPositionAfterLegalMove(state, movingPlayer, gaveCheck);

  const bothKingsExist = (['sente', 'gote'] as const).every(player =>
    recordedState.squares.some(row => row.some(square => square.piece?.type === 'king' && square.piece.player === player)));
  if ((gaveCheck || bothKingsExist) && !hasLegalResponse(recordedState, respondingPlayer)) {
    return {
      ...recordedState,
      status: 'ended',
      result: {
        winner: movingPlayer,
        loser: respondingPlayer,
        endReason: gaveCheck ? 'checkmate' : 'no_legal_actions',
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
