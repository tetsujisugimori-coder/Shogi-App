import type {
  BoardState,
  FoulRecord,
  GameResult,
  MoveLimitJishogiState,
  MoveRecord,
  Piece,
  PositionRecord,
  PositionSnapshot,
} from '../../types/shogi';
import { cloneBoardSquares } from './boardStateUtils';
import { getPositionSnapshot } from './replay';

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

function cloneGameResult(result: GameResult | null | undefined): GameResult | null {
  return result ? { ...result } : null;
}

function clonePositionRecords(records: readonly PositionRecord[]): PositionRecord[] {
  return records.map((record) => ({ ...record }));
}

function cloneMoveLimitJishogi(
  value: MoveLimitJishogiState | null | undefined
): MoveLimitJishogiState | null {
  return value ? { ...value } : null;
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

/** A disposable one-line analysis record; its mainline is never mutated. */
export interface GameRecordBranch {
  originHistoryIndex: number;
  mainline: BoardState;
}

export interface BranchReplayStart {
  branch: GameRecordBranch;
  state: BoardState;
}

/** Creates a complete, mutable-reference-free copy of a live game record. */
export function cloneBoardState(state: BoardState): BoardState {
  return {
    ...state,
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

/**
 * Produces a normal BoardState from an exact replay snapshot and a separately
 * retained, immutable-by-convention mainline backup. Future mainline data is
 * deliberately excluded from every history collection.
 */
export function createBranchFromReplayPosition(
  mainline: BoardState,
  historyIndex: number
): BranchReplayStart | null {
  if (!Number.isInteger(historyIndex) || historyIndex < 0 || historyIndex >= mainline.history.length) {
    return null;
  }

  const snapshot = getPositionSnapshot(mainline, historyIndex);
  if (!snapshot) return null;

  const branchState: BoardState = {
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
    // A strict-mode foul terminates a game and has no subsequent snapshot.
    // Keep only records that predate this restored position.
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

  return {
    branch: {
      originHistoryIndex: historyIndex,
      mainline: cloneBoardState(mainline),
    },
    state: branchState,
  };
}

/** Restores a fresh copy so returning to the mainline cannot re-share references. */
export function restoreMainlineFromBranch(branch: GameRecordBranch): BoardState {
  return cloneBoardState(branch.mainline);
}
