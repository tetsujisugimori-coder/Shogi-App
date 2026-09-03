import { describe, expect, it } from 'vitest';
import {
  addGameRecordSessionBranch,
  createGameRecordSession,
  createShogiGameRecordV1,
  executeMove,
  executeResignation,
  importShogiGameRecordSession,
  serializeShogiGameRecordSessionV1,
  storeGameRecordSessionState,
  switchGameRecordSessionToBranch,
  switchGameRecordSessionToMainline,
  type GameRecordSession,
} from '../domain/shogi';
import { createInitialBoardState, type BoardState } from '../types/shogi';

const EXPORTED_AT = new Date('2026-09-04T00:00:00.000Z');

function applyMove(state: BoardState, from: { row: number; col: number }, to: { row: number; col: number }): BoardState {
  const result = executeMove(state, from, to);
  expect(result.type).toBe('applied');
  if (result.type !== 'applied') throw new Error('fixture move failed');
  return result.state;
}

function createFourMoveState(): BoardState {
  let state = createInitialBoardState();
  state = applyMove(state, { row: 6, col: 2 }, { row: 5, col: 2 });
  state = applyMove(state, { row: 2, col: 6 }, { row: 3, col: 6 });
  state = applyMove(state, { row: 6, col: 3 }, { row: 5, col: 3 });
  return applyMove(state, { row: 2, col: 5 }, { row: 3, col: 5 });
}

function requireState(result: { ok: boolean; session: GameRecordSession; boardState: BoardState | null }): { session: GameRecordSession; boardState: BoardState } {
  expect(result.ok).toBe(true);
  if (!result.ok || !result.boardState) throw new Error('expected session transition');
  return { session: result.session, boardState: result.boardState };
}

function createSessionWithSiblings(): GameRecordSession {
  const mainline = createFourMoveState();
  let active = mainline;
  let session = createGameRecordSession(mainline);
  let step = requireState(addGameRecordSessionBranch(session, active, 2));
  session = step.session;
  active = applyMove(step.boardState, { row: 6, col: 3 }, { row: 5, col: 3 });
  step = requireState(switchGameRecordSessionToMainline(session, active));
  session = step.session;
  active = step.boardState;
  step = requireState(addGameRecordSessionBranch(session, active, 2));
  session = step.session;
  active = applyMove(step.boardState, { row: 6, col: 1 }, { row: 5, col: 1 });
  step = requireState(switchGameRecordSessionToMainline(session, active));
  session = step.session;
  active = step.boardState;
  step = requireState(addGameRecordSessionBranch(session, active, 3));
  session = step.session;
  active = applyMove(step.boardState, { row: 2, col: 2 }, { row: 3, col: 2 });
  return storeGameRecordSessionState(session, active);
}

function roundTrip(session: GameRecordSession) {
  const result = importShogiGameRecordSession(serializeShogiGameRecordSessionV1(session, EXPORTED_AT));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe('研究セッションJSON', () => {
  it('本譜のみ、兄弟分岐、異なる分岐元、表示名、recordId、選択状態を丸ごと往復する', () => {
    const mainlineOnly = roundTrip(createGameRecordSession(createFourMoveState()));
    expect(mainlineOnly.session.branches).toEqual([]);
    expect(mainlineOnly.session.selection).toEqual({ kind: 'mainline' });

    const source = createSessionWithSiblings();
    const result = roundTrip(source);
    expect(result.session.branches).toHaveLength(3);
    expect(result.session.branches.map((branch) => [branch.originHistoryIndex, branch.originSequence, branch.displayName]))
      .toEqual(source.branches.map((branch) => [branch.originHistoryIndex, branch.originSequence, branch.displayName]));
    expect(result.session.branches.map((branch) => branch.state.recordId))
      .toEqual(source.branches.map((branch) => branch.state.recordId));
    expect(result.session.selection).toEqual(source.selection);
    expect(result.state.recordId).toBe(source.branches[2].state.recordId);
  });

  it('盤面、持ち駒、手番、手数、最終手、終局結果、履歴、再生スナップショットと分岐元を復元する', () => {
    const session = createSessionWithSiblings();
    const activeBranch = session.branches[2];
    const resigned = executeResignation(activeBranch.state);
    expect(resigned.type).toBe('applied');
    if (resigned.type !== 'applied') return;
    const source = storeGameRecordSessionState(session, resigned.state);
    const result = roundTrip(source);
    const restored = result.session.branches[2].state;
    expect(restored.squares.map((row) => row.map((square) => square.piece?.isPromoted ?? false)))
      .toEqual(resigned.state.squares.map((row) => row.map((square) => square.piece?.isPromoted ?? false)));
    expect(restored.senteHand).toEqual(resigned.state.senteHand);
    expect(restored.goteHand).toEqual(resigned.state.goteHand);
    expect(restored.turn).toBe(resigned.state.turn);
    expect(restored.moveNumber).toBe(resigned.state.moveNumber);
    expect(restored.lastMove).toEqual(resigned.state.lastMove);
    expect(restored.result).toEqual(resigned.state.result);
    expect(restored.positionHistory).toEqual(resigned.state.positionHistory);
    expect(createShogiGameRecordV1(restored, EXPORTED_AT).positionSnapshots)
      .toEqual(createShogiGameRecordV1(resigned.state, EXPORTED_AT).positionSnapshots);
    expect(restored.moveLimitJishogi).toEqual(resigned.state.moveLimitJishogi);
    expect(restored.branchFrom).toEqual(activeBranch.state.branchFrom);
  });

  it('選択中が本譜でも分岐でも復元し、可変参照を共有しない', () => {
    const branchSelected = roundTrip(createSessionWithSiblings());
    branchSelected.session.branches[0].state.squares[5][2].piece = null;
    expect(branchSelected.session.mainline.squares[5][2].piece).not.toBeNull();
    expect(branchSelected.session.branches[1].state.squares[5][2].piece).not.toBeNull();

    const mainline = createSessionWithSiblings();
    const returned = requireState(switchGameRecordSessionToMainline(mainline, mainline.branches[2].state));
    const mainlineSelected = roundTrip(returned.session);
    expect(mainlineSelected.session.selection).toEqual({ kind: 'mainline' });
    expect(mainlineSelected.state.recordId).toBe(mainlineSelected.session.mainline.recordId);
  });

  it('v1の一本道JSONを新しい本譜セッションとして読み込み、通常の分岐操作を続けられる', () => {
    const v1 = JSON.stringify(createShogiGameRecordV1(createFourMoveState(), EXPORTED_AT));
    const result = importShogiGameRecordSession(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata.isLegacyGameRecord).toBe(true);
    expect(result.session.branches).toEqual([]);
    const branch = addGameRecordSessionBranch(result.session, result.state, 2);
    expect(branch.ok).toBe(true);
  });

  it.each([
    ['unsupported version', (record: Record<string, unknown>) => { record.version = 99; }],
    ['duplicate recordId', (record: Record<string, unknown>) => { (record.branches as Array<Record<string, unknown>>)[0].record = record.mainline; }],
    ['unknown selectedRecordId', (record: Record<string, unknown>) => { record.selectedRecordId = 'missing'; }],
    ['nested branch', (record: Record<string, unknown>) => {
      const branch = (record.branches as Array<Record<string, unknown>>)[0];
      ((branch.record as Record<string, unknown>).branchFrom as Record<string, unknown>).recordId =
        ((record.branches as Array<Record<string, unknown>>)[1].record as Record<string, unknown>).recordId;
    }],
  ])('%sを安全に拒否する', (_label, mutate) => {
    const record = JSON.parse(serializeShogiGameRecordSessionV1(createSessionWithSiblings(), EXPORTED_AT)) as Record<string, unknown>;
    mutate(record);
    expect(importShogiGameRecordSession(JSON.stringify(record))).toMatchObject({ ok: false });
  });
});
