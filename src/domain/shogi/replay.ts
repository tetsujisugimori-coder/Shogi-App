import type {
  BoardState,
  GameResult,
  MoveRecord,
  Piece,
  PositionSnapshot,
} from '../../types/shogi';
import { cloneBoardSquares } from './boardStateUtils';
import { createPositionKey } from './repetition';

function clonePieces(pieces: readonly Piece[]): Piece[] {
  return pieces.map((piece) => ({ ...piece }));
}

function cloneMoveRecord(move: MoveRecord | null | undefined): MoveRecord | null {
  if (!move) return null;
  return move.kind === 'move'
    ? { ...move, from: { ...move.from }, to: { ...move.to } }
    : { ...move, to: { ...move.to } };
}

function cloneGameResult(result: GameResult | null | undefined): GameResult | null {
  return result ? { ...result } : null;
}

function cloneMoveLimitJishogi(
  moveLimitJishogi: BoardState['moveLimitJishogi']
): BoardState['moveLimitJishogi'] {
  return moveLimitJishogi ? { ...moveLimitJishogi } : null;
}

/** Creates an independent display snapshot without copying any history collections. */
export function createPositionSnapshot(state: BoardState): PositionSnapshot {
  return {
    historyIndex: state.history.length,
    squares: cloneBoardSquares(state.squares),
    senteHand: clonePieces(state.senteHand),
    goteHand: clonePieces(state.goteHand),
    turn: state.turn,
    moveNumber: state.moveNumber,
    status: state.status,
    lastMove: cloneMoveRecord(state.lastMove),
    result: cloneGameResult(state.result),
    moveLimitJishogi: cloneMoveLimitJishogi(state.moveLimitJishogi),
  };
}

function snapshotMatchesCurrentPosition(
  snapshot: PositionSnapshot,
  state: BoardState
): boolean {
  return (
    snapshot.historyIndex === state.history.length &&
    snapshot.moveNumber === state.moveNumber &&
    createPositionKey(snapshot) === createPositionKey(state)
  );
}

/**
 * Keeps a trustworthy replay chain, or replaces it with the supplied current
 * position as the sole baseline. Missing historical positions are never inferred.
 */
export function normalizePositionSnapshots(state: BoardState): BoardState {
  const snapshots = state.positionSnapshots;
  const tail = snapshots?.at(-1);
  if (tail && snapshotMatchesCurrentPosition(tail, state)) {
    return state;
  }

  return {
    ...state,
    positionSnapshots: [createPositionSnapshot(state)],
  };
}

/** Appends exactly one post-adjudication snapshot for an already-legal move. */
export function recordPositionSnapshotAfterLegalMove(state: BoardState): BoardState {
  return {
    ...state,
    positionSnapshots: [
      ...(state.positionSnapshots ?? []),
      createPositionSnapshot(state),
    ],
  };
}

/** Returns only an exact, uniquely identified replay position. */
export function getPositionSnapshot(
  state: Pick<BoardState, 'positionSnapshots'>,
  historyIndex: number
): PositionSnapshot | null {
  if (!Number.isInteger(historyIndex) || historyIndex < 0) return null;
  const matches = (state.positionSnapshots ?? []).filter(
    (snapshot) => snapshot.historyIndex === historyIndex
  );
  return matches.length === 1 ? matches[0] : null;
}
