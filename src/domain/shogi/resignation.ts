import type { BoardState, Player, ResignationGameResult } from '../../types/shogi';

export type ResignationRejectionReason =
  | 'game_already_ended'
  | 'resignation_not_available';

export type ResignationExecutionResult =
  | {
      type: 'applied';
      state: BoardState;
      result: ResignationGameResult;
    }
  | {
      type: 'rejected';
      state: BoardState;
      reason: ResignationRejectionReason;
      message: string;
    };

/** Ends an active game by treating the current side to move as the resigning player. */
export function executeResignation(state: BoardState): ResignationExecutionResult {
  if (state.status === 'ended') {
    return {
      type: 'rejected',
      state,
      reason: 'game_already_ended',
      message: '対局は既に終局しています。',
    };
  }

  if (state.status !== 'active' && state.status !== 'check') {
    return {
      type: 'rejected',
      state,
      reason: 'resignation_not_available',
      message: '現在の対局状態では投了できません。',
    };
  }

  const resigningPlayer = state.turn;
  const winner: Player = resigningPlayer === 'sente' ? 'gote' : 'sente';
  const resigningPlayerName = resigningPlayer === 'sente' ? '先手' : '後手';
  const result: ResignationGameResult = {
    winner,
    loser: resigningPlayer,
    endReason: 'resignation',
    details: `${resigningPlayerName}が投了`,
  };

  return {
    type: 'applied',
    state: {
      ...state,
      status: 'ended',
      result,
    },
    result,
  };
}
