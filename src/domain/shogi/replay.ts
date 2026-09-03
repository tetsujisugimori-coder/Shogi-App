import type {
  BoardState,
  FoulRecord,
  GameResult,
  MoveRecord,
  Piece,
  PositionRecord,
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

function cloneMoveRecords(moves: readonly MoveRecord[]): MoveRecord[] {
  return moves.map((move) => cloneMoveRecord(move)!);
}

function cloneFoulRecord(foul: FoulRecord): FoulRecord {
  return foul.kind === 'move'
    ? { ...foul, from: { ...foul.from }, to: { ...foul.to } }
    : { ...foul, to: { ...foul.to } };
}

function clonePositionRecords(records: readonly PositionRecord[]): PositionRecord[] {
  return records.map((record) => ({ ...record }));
}

function cloneGameResult(result: GameResult | null | undefined): GameResult | null {
  return result ? { ...result } : null;
}

function cloneMoveLimitJishogi(
  moveLimitJishogi: BoardState['moveLimitJishogi']
): BoardState['moveLimitJishogi'] {
  return moveLimitJishogi ? { ...moveLimitJishogi } : null;
}

function clonePositionSnapshot(snapshot: PositionSnapshot): PositionSnapshot {
  return {
    historyIndex: snapshot.historyIndex,
    squares: cloneBoardSquares(snapshot.squares),
    senteHand: clonePieces(snapshot.senteHand),
    goteHand: clonePieces(snapshot.goteHand),
    turn: snapshot.turn,
    moveNumber: snapshot.moveNumber,
    status: snapshot.status,
    lastMove: cloneMoveRecord(snapshot.lastMove),
    result: cloneGameResult(snapshot.result),
    moveLimitJishogi: cloneMoveLimitJishogi(snapshot.moveLimitJishogi),
  };
}

/** Creates a complete mutable-reference-free copy of one game state. */
export function cloneBoardState(state: BoardState): BoardState {
  return {
    ...state,
    branchFrom: state.branchFrom ? { ...state.branchFrom } : undefined,
    squares: cloneBoardSquares(state.squares),
    senteHand: clonePieces(state.senteHand),
    goteHand: clonePieces(state.goteHand),
    history: cloneMoveRecords(state.history),
    lastMove: cloneMoveRecord(state.lastMove),
    result: cloneGameResult(state.result),
    foulHistory: (state.foulHistory ?? []).map(cloneFoulRecord),
    positionHistory: clonePositionRecords(state.positionHistory ?? []),
    positionSnapshots: (state.positionSnapshots ?? []).map(clonePositionSnapshot),
    moveLimitJishogi: cloneMoveLimitJishogi(state.moveLimitJishogi),
  };
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

/**
 * Restores an independently mutable complete game state after the requested
 * ply. The state must have the exact replay snapshot produced by the normal
 * game rules; malformed, missing, or out-of-range positions are rejected.
 */
export function restoreBoardStateAtHistoryIndex(
  mainline: BoardState,
  historyIndex: number
): BoardState | null {
  if (
    !Number.isInteger(historyIndex) ||
    historyIndex < 0 ||
    historyIndex > mainline.history.length
  ) {
    return null;
  }

  // Non-move endings (for example resignation) intentionally do not create a
  // new move snapshot. At the final ply, the live state is the authoritative
  // complete position, including its terminal result.
  if (historyIndex === mainline.history.length) return cloneBoardState(mainline);

  const snapshot = getPositionSnapshot(mainline, historyIndex);
  if (!snapshot || snapshot.moveNumber !== historyIndex + 1) return null;

  return {
    recordId: mainline.recordId,
    branchFrom: mainline.branchFrom ? { ...mainline.branchFrom } : undefined,
    squares: cloneBoardSquares(snapshot.squares),
    senteHand: clonePieces(snapshot.senteHand),
    goteHand: clonePieces(snapshot.goteHand),
    turn: snapshot.turn,
    moveNumber: snapshot.moveNumber,
    status: snapshot.status,
    viewMode: mainline.viewMode,
    history: cloneMoveRecords(mainline.history.slice(0, historyIndex)),
    lastMove: cloneMoveRecord(snapshot.lastMove),
    result: cloneGameResult(snapshot.result),
    foulHistory: (mainline.foulHistory ?? [])
      .filter((foul) => foul.moveNumber < snapshot.moveNumber)
      .map(cloneFoulRecord),
    positionHistory: clonePositionRecords(
      (mainline.positionHistory ?? []).filter((record) => record.historyIndex <= historyIndex)
    ),
    positionSnapshots: (mainline.positionSnapshots ?? [])
      .filter((item) => item.historyIndex <= historyIndex)
      .map(clonePositionSnapshot),
    moveLimitJishogi: cloneMoveLimitJishogi(snapshot.moveLimitJishogi),
  };
}
