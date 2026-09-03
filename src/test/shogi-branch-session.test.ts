import { describe, expect, it } from 'vitest';
import {
  addGameRecordSessionBranch,
  createGameRecordSession,
  discardGameRecordSession,
  executeMove,
  storeGameRecordSessionState,
  switchGameRecordSessionToBranch,
  switchGameRecordSessionToMainline,
  type GameRecordSession,
  type GameRecordSessionTransition,
} from '../domain/shogi';
import { createInitialBoardState, type BoardState } from '../types/shogi';

function applyMove(
  state: BoardState,
  from: { row: number; col: number },
  to: { row: number; col: number }
): BoardState {
  const execution = executeMove(state, from, to);
  expect(execution.type).toBe('applied');
  if (execution.type !== 'applied') throw new Error('fixture move failed');
  return execution.state;
}

function createFourMoveState(): BoardState {
  let state = createInitialBoardState();
  state = applyMove(state, { row: 6, col: 2 }, { row: 5, col: 2 });
  state = applyMove(state, { row: 2, col: 6 }, { row: 3, col: 6 });
  state = applyMove(state, { row: 6, col: 3 }, { row: 5, col: 3 });
  return applyMove(state, { row: 2, col: 5 }, { row: 3, col: 5 });
}

interface SuccessfulTransition {
  ok: true;
  session: GameRecordSession;
  boardState: BoardState;
}

function requireTransition(result: GameRecordSessionTransition): SuccessfulTransition {
  expect(result.ok).toBe(true);
  expect(result.boardState).not.toBeNull();
  if (!result.ok || !result.boardState) throw new Error('expected a successful session transition');
  return { ok: true, session: result.session, boardState: result.boardState };
}

describe('GameRecordSession', () => {
  it('本譜から空のセッションを開始し、入力本譜と可変参照を共有しない', () => {
    const mainline = createFourMoveState();
    const session = createGameRecordSession(mainline);

    expect(session.selection).toEqual({ kind: 'mainline' });
    expect(session.branches).toEqual([]);
    expect(session.mainline).toEqual(mainline);
    session.mainline.squares[5][2].piece = null;
    session.mainline.history[0].notation = '変更済み';
    expect(mainline.squares[5][2].piece).not.toBeNull();
    expect(mainline.history[0].notation).toBe('▲7六歩');
  });

  it('分岐元ごとに安定した連番と表示名を作成し、作成順が混在しても既存名を変更しない', () => {
    const mainline = createFourMoveState();
    const first = requireTransition(
      addGameRecordSessionBranch(createGameRecordSession(mainline), mainline, 2)
    );
    const backToMainline = requireTransition(
      switchGameRecordSessionToMainline(first.session, first.boardState)
    );
    const second = requireTransition(
      addGameRecordSessionBranch(backToMainline.session, backToMainline.boardState, 3)
    );
    const backAgain = requireTransition(
      switchGameRecordSessionToMainline(second.session, second.boardState)
    );
    const third = requireTransition(
      addGameRecordSessionBranch(backAgain.session, backAgain.boardState, 2)
    );

    expect(third.session.branches.map((branch) => [branch.originHistoryIndex, branch.originSequence, branch.displayName]))
      .toEqual([
        [2, 1, '第2手後からの分岐 1'],
        [3, 1, '第3手後からの分岐 1'],
        [2, 2, '第2手後からの分岐 2'],
      ]);
    expect(third.session.branches.every((branch) => branch.state.recordId)).toBe(true);
  });

  it('現在選択中の本譜または分岐の最新状態を格納できる', () => {
    const mainline = createFourMoveState();
    const mainlineContinued = applyMove(mainline, { row: 6, col: 1 }, { row: 5, col: 1 });
    const storedMainline = storeGameRecordSessionState(
      createGameRecordSession(mainline),
      mainlineContinued
    );
    expect(storedMainline.mainline.history).toHaveLength(5);
    expect(mainline.history).toHaveLength(4);

    const started = requireTransition(addGameRecordSessionBranch(storedMainline, mainlineContinued, 2));
    const branchContinued = applyMove(started.boardState, { row: 6, col: 3 }, { row: 5, col: 3 });
    const storedBranch = storeGameRecordSessionState(started.session, branchContinued);
    expect(storedBranch.branches[0].state.history.at(-1)?.notation).toBe('▲6六歩');
    expect(started.session.branches[0].state.history).toHaveLength(2);
  });

  it('本譜と兄弟分岐を切り替え、切り替え直前の状態を独立して保持する', () => {
    const mainline = createFourMoveState();
    const first = requireTransition(
      addGameRecordSessionBranch(createGameRecordSession(mainline), mainline, 2)
    );
    const firstContinued = applyMove(first.boardState, { row: 6, col: 3 }, { row: 5, col: 3 });
    const onMainline = requireTransition(
      switchGameRecordSessionToMainline(first.session, firstContinued)
    );
    const second = requireTransition(
      addGameRecordSessionBranch(onMainline.session, onMainline.boardState, 2)
    );
    const secondContinued = applyMove(second.boardState, { row: 6, col: 1 }, { row: 5, col: 1 });
    const firstRecordId = first.session.branches[0].state.recordId!;
    const returnedFirst = requireTransition(
      switchGameRecordSessionToBranch(second.session, secondContinued, firstRecordId)
    );

    expect(returnedFirst.boardState.history.at(-1)?.notation).toBe('▲6六歩');
    expect(returnedFirst.session.mainline.history).toHaveLength(4);
    const secondRecordId = second.session.branches[1].state.recordId!;
    const returnedSecond = requireTransition(
      switchGameRecordSessionToBranch(returnedFirst.session, returnedFirst.boardState, secondRecordId)
    );
    expect(returnedSecond.boardState.history.at(-1)?.notation).toBe('▲8六歩');

    const sameTarget = switchGameRecordSessionToBranch(
      returnedSecond.session,
      returnedSecond.boardState,
      secondRecordId
    );
    const missingTarget = switchGameRecordSessionToBranch(
      returnedSecond.session,
      returnedSecond.boardState,
      'unknown-record'
    );
    expect(sameTarget).toMatchObject({ ok: false, session: returnedSecond.session, boardState: null });
    expect(missingTarget).toMatchObject({ ok: false, session: returnedSecond.session, boardState: null });
  });

  it('格納・復元・戻り値のいずれも本譜と分岐の可変参照を共有しない', () => {
    const mainline = createFourMoveState();
    const started = requireTransition(
      addGameRecordSessionBranch(createGameRecordSession(mainline), mainline, 0)
    );
    const branch = started.boardState;
    branch.squares[6][2].piece = null;
    branch.branchFrom!.ply = 99;
    expect(started.session.mainline.squares[5][2].piece).not.toBeNull();
    expect(started.session.branches[0].state.branchFrom?.ply).toBe(0);

    const stored = storeGameRecordSessionState(started.session, branch);
    const restoredMainline = requireTransition(switchGameRecordSessionToMainline(stored, branch));
    restoredMainline.boardState.history[0].notation = '本譜の変更';
    expect(stored.mainline.history[0].notation).toBe('▲7六歩');
    const restoredBranch = requireTransition(
      switchGameRecordSessionToBranch(
        restoredMainline.session,
        restoredMainline.boardState,
        started.session.branches[0].state.recordId!
      )
    );
    restoredBranch.boardState.branchFrom!.ply = 123;
    expect(restoredMainline.session.branches[0].state.branchFrom?.ply).toBe(99);
  });

  it('セッションを破棄すると分岐は残らない', () => {
    expect(discardGameRecordSession()).toBeNull();
  });
});
