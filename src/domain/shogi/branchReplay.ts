import type { BoardState, GameRecordBranchFrom } from '../../types/shogi';
import { createShogiGameRecordId } from './recordIdentity';
import { cloneBoardState, restoreBoardStateAtHistoryIndex } from './replay';

/** A disposable one-line analysis record; its mainline is never mutated. */
export interface GameRecordBranch {
  originHistoryIndex: number;
  branchFrom: GameRecordBranchFrom;
  mainline: BoardState;
}

export interface BranchReplayStart {
  branch: GameRecordBranch;
  state: BoardState;
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
  if (
    mainline.branchFrom ||
    !mainline.recordId ||
    mainline.recordId.trim().length === 0 ||
    !Number.isInteger(historyIndex) ||
    historyIndex < 0 ||
    historyIndex >= mainline.history.length
  ) {
    return null;
  }
  const restoredState = restoreBoardStateAtHistoryIndex(mainline, historyIndex);
  if (!restoredState) return null;
  const branchFrom: GameRecordBranchFrom = { recordId: mainline.recordId, ply: historyIndex };
  const branchState: BoardState = {
    ...restoredState,
    recordId: createShogiGameRecordId(),
    branchFrom: { ...branchFrom },
  };

  return {
    branch: {
      originHistoryIndex: historyIndex,
      branchFrom,
      mainline: cloneBoardState(mainline),
    },
    state: branchState,
  };
}

/** Restores a fresh copy so returning to the mainline cannot re-share references. */
export function restoreMainlineFromBranch(branch: GameRecordBranch): BoardState {
  return cloneBoardState(branch.mainline);
}
