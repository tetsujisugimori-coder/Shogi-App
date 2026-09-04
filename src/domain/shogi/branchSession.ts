import type { BoardState } from '../../types/shogi';
import { createBranchFromReplayPosition } from './branchReplay';
import { cloneBoardState } from './replay';

export type GameRecordSessionSelection =
  | { kind: 'mainline' }
  | { kind: 'branch'; recordId: string };

export interface GameRecordSessionBranch {
  originHistoryIndex: number;
  originSequence: number;
  displayName: string;
  state: BoardState;
}

function getBranchRecordId(branch: GameRecordSessionBranch): string | null {
  return branch.state.recordId ?? null;
}

export interface GameRecordSession {
  mainline: BoardState;
  branches: GameRecordSessionBranch[];
  selection: GameRecordSessionSelection;
}

export interface GameRecordSessionTransition {
  ok: boolean;
  session: GameRecordSession;
  boardState: BoardState | null;
}

export function cloneSelection(selection: GameRecordSessionSelection): GameRecordSessionSelection {
  return selection.kind === 'mainline' ? selection : { ...selection };
}

export function cloneGameRecordSession(session: GameRecordSession): GameRecordSession {
  return {
    mainline: cloneBoardState(session.mainline),
    branches: session.branches.map((branch) => ({ ...branch, state: cloneBoardState(branch.state) })),
    selection: cloneSelection(session.selection),
  };
}

export function createGameRecordSession(mainline: BoardState): GameRecordSession {
  return { mainline: cloneBoardState(mainline), branches: [], selection: { kind: 'mainline' } };
}

export function discardGameRecordSession(): null {
  return null;
}

function branchLabel(historyIndex: number, sequence: number): string {
  const origin = historyIndex === 0 ? '初期局面' : `第${historyIndex}手後`;
  return `${origin}からの分岐 ${sequence}`;
}

export function addGameRecordSessionBranch(
  session: GameRecordSession,
  currentState: BoardState,
  historyIndex: number
): GameRecordSessionTransition {
  if (session.selection.kind !== 'mainline' || currentState.branchFrom) {
    return { ok: false, session, boardState: null };
  }
  const mainline = cloneBoardState(currentState);
  const started = createBranchFromReplayPosition(mainline, historyIndex);
  if (!started?.state.recordId) return { ok: false, session, boardState: null };
  const originSequence =
    Math.max(
      0,
      ...session.branches
        .filter((branch) => branch.originHistoryIndex === historyIndex)
        .map((branch) => branch.originSequence)
    ) + 1;
  const branch: GameRecordSessionBranch = {
    originHistoryIndex: historyIndex,
    originSequence,
    displayName: branchLabel(historyIndex, originSequence),
    state: cloneBoardState(started.state),
  };
  const next: GameRecordSession = {
    mainline,
    branches: [...session.branches.map((item) => ({ ...item, state: cloneBoardState(item.state) })), branch],
    selection: { kind: 'branch', recordId: started.state.recordId },
  };
  return { ok: true, session: next, boardState: cloneBoardState(branch.state) };
}

export function storeGameRecordSessionState(
  session: GameRecordSession,
  currentState: BoardState
): GameRecordSession {
  const next = cloneGameRecordSession(session);
  if (next.selection.kind === 'mainline') {
    next.mainline = cloneBoardState(currentState);
    return next;
  }
  const selectedRecordId = next.selection.recordId;
  const branch = next.branches.find((item) => getBranchRecordId(item) === selectedRecordId);
  if (branch) branch.state = cloneBoardState(currentState);
  return next;
}

export function switchGameRecordSessionToMainline(
  session: GameRecordSession,
  currentState: BoardState
): GameRecordSessionTransition {
  if (session.selection.kind === 'mainline') return { ok: false, session, boardState: null };
  const stored = storeGameRecordSessionState(session, currentState);
  stored.selection = { kind: 'mainline' };
  return { ok: true, session: stored, boardState: cloneBoardState(stored.mainline) };
}

export function switchGameRecordSessionToBranch(
  session: GameRecordSession,
  currentState: BoardState,
  recordId: string
): GameRecordSessionTransition {
  if (session.selection.kind === 'branch' && session.selection.recordId === recordId) {
    return { ok: false, session, boardState: null };
  }
  const target = session.branches.find((branch) => getBranchRecordId(branch) === recordId);
  if (!target) return { ok: false, session, boardState: null };
  const stored = storeGameRecordSessionState(session, currentState);
  const storedTarget = stored.branches.find((branch) => getBranchRecordId(branch) === recordId)!;
  stored.selection = { kind: 'branch', recordId };
  return { ok: true, session: stored, boardState: cloneBoardState(storedTarget.state) };
}
