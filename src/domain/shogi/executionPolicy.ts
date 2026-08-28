import {
  BoardState,
  ExecutionMode,
  FoulRecord,
  FoulLossGameResult,
  IllegalMoveReason,
  Player,
} from '../../types/shogi';

export type RejectedExecutionResult = {
  type: 'rejected';
  state: BoardState;
  reason: IllegalMoveReason;
  message: string;
};

export type FoulLossExecutionResult = {
  type: 'foul_loss';
  state: BoardState;
  foul: FoulRecord;
  result: FoulLossGameResult;
};

/** Shared internal policy for assist rejection and strict foul-loss transitions. */
export function finalizeIllegalProposal(
  state: BoardState,
  mode: ExecutionMode,
  foulRecord: FoulRecord
): RejectedExecutionResult | FoulLossExecutionResult {
  if (mode !== 'strict') {
    return {
      type: 'rejected',
      state,
      reason: foulRecord.reason,
      message: foulRecord.message,
    };
  }

  const winner: Player = state.turn === 'sente' ? 'gote' : 'sente';
  const gameResult: FoulLossGameResult = {
    winner,
    loser: state.turn,
    endReason: 'foul_loss',
    foulReason: foulRecord.reason,
    details: foulRecord.message,
  };
  const endedState: BoardState = {
    ...state,
    status: 'ended',
    result: gameResult,
    foulHistory: [...(state.foulHistory ?? []), foulRecord],
  };

  return {
    type: 'foul_loss',
    state: endedState,
    foul: foulRecord,
    result: gameResult,
  };
}
