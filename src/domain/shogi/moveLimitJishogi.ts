import type {
  BoardState,
  MoveLimitJishogiState,
  Player,
} from '../../types/shogi';

export const JISHOGI_MOVE_LIMIT = 500;

export type MoveLimitJishogiAdjudication =
  | { kind: 'not_reached' }
  | { kind: 'waiting'; state: MoveLimitJishogiState }
  | { kind: 'draw' };

function isPendingState(
  state: MoveLimitJishogiState | null | undefined
): state is MoveLimitJishogiState {
  return (
    state?.kind === 'awaiting_continuous_check_end' &&
    (state.checkingPlayer === 'sente' || state.checkingPlayer === 'gote')
  );
}

/**
 * Classifies the 500-move jishogi rule after an already-legal move.
 * `moveNumber` is the next move number, so completed moves are `moveNumber - 1`.
 */
export function classifyMoveLimitJishogi(
  state: BoardState,
  movingPlayer: Player,
  gaveCheck: boolean
): MoveLimitJishogiAdjudication {
  const pending = isPendingState(state.moveLimitJishogi)
    ? state.moveLimitJishogi
    : null;

  if (pending) {
    if (movingPlayer !== pending.checkingPlayer || gaveCheck) {
      return { kind: 'waiting', state: pending };
    }
    return { kind: 'draw' };
  }

  const completedMoves = state.moveNumber - 1;
  if (completedMoves < JISHOGI_MOVE_LIMIT) {
    return { kind: 'not_reached' };
  }

  if (gaveCheck) {
    return {
      kind: 'waiting',
      state: {
        kind: 'awaiting_continuous_check_end',
        checkingPlayer: movingPlayer,
      },
    };
  }

  return { kind: 'draw' };
}
