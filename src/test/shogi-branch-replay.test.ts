import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import {
  createBranchFromReplayPosition,
  createKifText,
  createShogiGameRecordV1,
  executeDrop,
  executeMove,
  importShogiGameRecord,
  executeResignation,
  restoreBoardStateAtHistoryIndex,
  restoreMainlineFromBranch,
  serializeShogiGameRecordV1,
} from '../domain/shogi';
import { createInitialBoardState, type BoardState } from '../types/shogi';

function applyMove(
  state: BoardState,
  from: { row: number; col: number },
  to: { row: number; col: number },
  promotion?: 'promote' | 'decline'
): BoardState {
  const execution = executeMove(state, from, to, { promotion });
  expect(execution.type).toBe('applied');
  if (execution.type !== 'applied') throw new Error('fixture move failed');
  return execution.state;
}

function createFourMoveState(): BoardState {
  let state = createInitialBoardState();
  state = applyMove(state, { row: 6, col: 2 }, { row: 5, col: 2 }); // ▲7六歩
  state = applyMove(state, { row: 2, col: 6 }, { row: 3, col: 6 }); // △3四歩
  state = applyMove(state, { row: 6, col: 3 }, { row: 5, col: 3 }); // ▲6六歩
  return applyMove(state, { row: 2, col: 5 }, { row: 3, col: 5 }); // △4四歩
}

function createPromotionAndDropState(): BoardState {
  let state = createInitialBoardState();
  state = applyMove(state, { row: 6, col: 2 }, { row: 5, col: 2 });
  state = applyMove(state, { row: 2, col: 6 }, { row: 3, col: 6 });
  state = applyMove(state, { row: 7, col: 1 }, { row: 1, col: 7 }, 'promote');
  state = applyMove(state, { row: 2, col: 0 }, { row: 3, col: 0 });
  const drop = executeDrop(state, 'gote-bishop-2', { row: 4, col: 4 });
  expect(drop.type).toBe('applied');
  if (drop.type !== 'applied') throw new Error('fixture drop failed');
  return drop.state;
}

describe('過去局面からの一本道ブランチ', () => {
  it('0手目・中間手・最終手を完全な独立状態として復元し、範囲外を拒否する', () => {
    const mainline = createPromotionAndDropState();
    const initial = restoreBoardStateAtHistoryIndex(mainline, 0);
    const middle = restoreBoardStateAtHistoryIndex(mainline, 3);
    const final = restoreBoardStateAtHistoryIndex(mainline, mainline.history.length);

    expect(initial).toMatchObject({ moveNumber: 1, turn: 'sente', history: [], senteHand: [], goteHand: [] });
    expect(initial?.squares[6][2].piece).toMatchObject({ type: 'pawn', player: 'sente' });
    expect(middle).toMatchObject({ moveNumber: 4, turn: 'gote' });
    expect(middle?.squares[1][7].piece).toMatchObject({ type: 'bishop', isPromoted: true });
    expect(middle?.senteHand).toEqual([{ id: 'gote-bishop-2', type: 'bishop', player: 'sente', isPromoted: false }]);
    expect(final).toMatchObject({ moveNumber: 6, turn: 'gote' });
    expect(final?.squares[4][4].piece).toMatchObject({ id: 'gote-bishop-2', type: 'bishop', player: 'sente' });
    expect(restoreBoardStateAtHistoryIndex(mainline, -1)).toBeNull();
    expect(restoreBoardStateAtHistoryIndex(mainline, mainline.history.length + 1)).toBeNull();

    if (!middle) return;
    middle.squares[1][7].piece = null;
    middle.senteHand[0].id = 'changed';
    expect(mainline.squares[1][7].piece?.isPromoted).toBe(true);
    expect(mainline.positionSnapshots?.[3].senteHand[0].id).toBe('gote-bishop-2');
  });

  it('着手外で終局した最終手数は終局状態を含めて復元する', () => {
    const resignation = executeResignation(createInitialBoardState());
    expect(resignation.type).toBe('applied');
    if (resignation.type !== 'applied') return;

    const restored = restoreBoardStateAtHistoryIndex(
      resignation.state,
      resignation.state.history.length
    );
    expect(restored).toMatchObject({ status: 'ended', result: resignation.state.result });
  });

  it('初期局面から独立した通常の対局状態を開始できる', () => {
    const mainline = applyMove(createInitialBoardState(), { row: 6, col: 2 }, { row: 5, col: 2 });
    const started = createBranchFromReplayPosition(mainline, 0);

    expect(started).not.toBeNull();
    if (!started) return;
    expect(createBranchFromReplayPosition(started.state, 0)).toBeNull();
    expect(started.state.history).toEqual([]);
    expect(started.state.positionHistory).toHaveLength(1);
    expect(started.state.positionSnapshots?.map((snapshot) => snapshot.historyIndex)).toEqual([0]);
    expect(started.state.turn).toBe('sente');

    const continued = applyMove(started.state, { row: 6, col: 3 }, { row: 5, col: 3 });
    expect(continued.history.map((move) => move.notation)).toEqual(['▲6六歩']);
    expect(started.branch.mainline.history.map((move) => move.notation)).toEqual(['▲7六歩']);
  });

  it('分岐元までの履歴・局面履歴・再生スナップショットだけを保持する', () => {
    const mainline = createFourMoveState();
    const started = createBranchFromReplayPosition(mainline, 2);

    expect(started).not.toBeNull();
    if (!started) return;
    expect(started.state.history.map((move) => move.notation)).toEqual(['▲7六歩', '△3四歩']);
    expect(started.state.positionHistory).toEqual(mainline.positionHistory?.slice(0, 3));
    expect(started.state.positionSnapshots?.map((snapshot) => snapshot.historyIndex)).toEqual([0, 1, 2]);
    expect(started.state.history).not.toContainEqual(mainline.history[2]);
    expect(started.state.positionHistory).not.toContainEqual(mainline.positionHistory?.[3]);
  });

  it('分岐側の通常移動・駒打ちを本譜へ波及させない', () => {
    const mainline = createFourMoveState();
    const before = structuredClone(mainline);
    const started = createBranchFromReplayPosition(mainline, 2);
    expect(started).not.toBeNull();
    if (!started) return;

    let branch = applyMove(started.state, { row: 6, col: 3 }, { row: 5, col: 3 });
    branch.goteHand = [{ id: 'branch-gold', type: 'gold', player: 'gote' }];
    const dropped = executeDrop(branch, 'branch-gold', { row: 4, col: 4 });
    expect(dropped.type).toBe('applied');
    if (dropped.type !== 'applied') return;
    expect(dropped.state.history).toHaveLength(4);
    expect(mainline.history).toHaveLength(4);
    expect(started.branch.mainline.history).toHaveLength(4);
    expect(started.branch.mainline.goteHand).toEqual(mainline.goteHand);
    expect(mainline.squares[4][4].piece).toBeNull();
    expect(mainline).toEqual(before);
  });

  it('親棋譜IDがない状態は安全に分岐開始を拒否する', () => {
    const mainline = createFourMoveState();
    delete mainline.recordId;
    expect(createBranchFromReplayPosition(mainline, 2)).toBeNull();
  });

  it('終局済み本譜の途中局面では未来の終局結果を引き継がない', () => {
    const mainline = createFourMoveState();
    mainline.status = 'ended';
    mainline.result = { endReason: 'resignation', winner: 'gote', loser: 'sente' };
    const started = createBranchFromReplayPosition(mainline, 2);

    expect(started).not.toBeNull();
    if (!started) return;
    expect(started.state.status).toBe('active');
    expect(started.state.result).toBeNull();
    expect(started.branch.mainline.result).toEqual(mainline.result);
  });

  it('本譜へ戻ると完全な独立コピーを復元し、現在局面からは分岐しない', () => {
    const mainline = createFourMoveState();
    const started = createBranchFromReplayPosition(mainline, 2);
    expect(started).not.toBeNull();
    expect(createBranchFromReplayPosition(mainline, mainline.history.length)).toBeNull();
    if (!started) return;

    const restored = restoreMainlineFromBranch(started.branch);
    restored.squares[5][2].piece = null;
    restored.history[0].notation = '変更済み';
    expect(started.branch.mainline.squares[5][2].piece).not.toBeNull();
    expect(started.branch.mainline.history[0].notation).toBe('▲7六歩');
    expect(restored.history.map((move) => move.notation)).toEqual(['変更済み', '△3四歩', '▲6六歩', '△4四歩']);
  });

  it('ブランチ棋譜は現在の一本道としてJSONとKIFへ保存できる', () => {
    const started = createBranchFromReplayPosition(createFourMoveState(), 2);
    expect(started).not.toBeNull();
    if (!started) return;
    const branch = applyMove(started.state, { row: 6, col: 3 }, { row: 5, col: 3 });

    const record = createShogiGameRecordV1(branch, new Date('2026-09-03T00:00:00.000Z'));
    expect(record.history)
      .toHaveLength(3);
    expect(record.branchFrom).toEqual({ recordId: started.branch.mainline.recordId, ply: 2 });
    expect(createKifText(branch)).toContain('   3 ６六歩(67)');
  });

  it('分岐元IDと手数をJSONへ保存・再読み込みし、旧JSONも読み込める', () => {
    const mainline = createFourMoveState();
    const started = createBranchFromReplayPosition(mainline, 2);
    expect(started).not.toBeNull();
    if (!started) return;
    const continued = applyMove(started.state, { row: 6, col: 3 }, { row: 5, col: 3 });
    const json = serializeShogiGameRecordV1(continued, new Date('2026-09-03T00:00:00.000Z'));
    const restored = importShogiGameRecord(json);

    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.state.branchFrom).toEqual({ recordId: mainline.recordId, ply: 2 });
      expect(restored.state.recordId).toBe(continued.recordId);
      expect(createBranchFromReplayPosition(restored.state, 0)).toBeNull();
    }

    const reloadedMainline = importShogiGameRecord(
      serializeShogiGameRecordV1(mainline, new Date('2026-09-03T00:00:00.000Z'))
    );
    expect(reloadedMainline.ok).toBe(true);
    if (reloadedMainline.ok) {
      expect(reloadedMainline.state.branchFrom).toBeUndefined();
      expect(createBranchFromReplayPosition(reloadedMainline.state, 2)).not.toBeNull();
    }

    const oldRecord = createShogiGameRecordV1(mainline, new Date('2026-09-03T00:00:00.000Z'));
    const { recordId: _recordId, branchFrom: _branchFrom, ...oldJson } = oldRecord;
    const oldImported = importShogiGameRecord(JSON.stringify(oldJson));
    expect(oldImported.ok).toBe(true);
    if (oldImported.ok) {
      expect(oldImported.state.branchFrom).toBeUndefined();
      expect(oldImported.state.recordId).toMatch(/^shogi-game-/);
    }
  });
});

describe('過去局面からの指し直しUI', () => {
  it('確認、キャンセル、Escape、背景クリックでは本譜と閲覧位置を変更しない', async () => {
    const user = userEvent.setup();
    render(React.createElement(ShogiResearchScreen, { initialState: createFourMoveState() }));
    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    const start = screen.getByRole('button', { name: 'ここから指し直す' });
    expect(start).toBeEnabled();
    await user.click(start);
    expect(screen.getByRole('dialog', { name: 'ここから指し直しますか？' })).toHaveTextContent(
      '第2手後の局面から指し直します。本譜は変更されません。'
    );

    await user.keyboard('{Escape}');
    expect(start).toHaveFocus();
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '4');
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-replay-history-index', '2');

    await user.click(start);
    const dialog = screen.getByRole('dialog');
    expect(fireEvent.mouseDown(dialog.parentElement!)).toBe(false);
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '4');
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-replay-history-index', '2');
  });

  it('途中局面から通常手を指し、本譜へ戻ると元の棋譜を正確に復元する', async () => {
    const user = userEvent.setup();
    render(React.createElement(ShogiResearchScreen, { initialState: createFourMoveState() }));
    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));

    const root = document.getElementById('shogi-research-screen')!;
    expect(root).toHaveAttribute('data-history-count', '2');
    expect(root).toHaveAttribute('data-branch-origin-history-index', '2');
    expect(screen.getByText('検討手順: 第2手後からの分岐 1')).toHaveAttribute('role', 'status');
    await user.click(document.querySelector('[data-coordinate="6七"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="6六"]') as HTMLElement);
    expect(root).toHaveAttribute('data-history-count', '3');
    expect(root).toHaveAttribute('data-last-move', '▲6六歩');

    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    expect(root).toHaveAttribute('data-history-count', '4');
    expect(root).toHaveAttribute('data-last-move', '△4四歩');
    expect(root).toHaveAttribute('data-branch-origin-history-index', '');
    expect(screen.queryByRole('button', { name: '本譜へ戻る' })).not.toBeInTheDocument();
  });

  it('検討手順中の過去局面は閲覧できるが、二重の指し直しで本譜バックアップを上書きしない', async () => {
    const user = userEvent.setup();
    const mainline = createFourMoveState();
    mainline.status = 'ended';
    mainline.result = { endReason: 'resignation', winner: 'gote', loser: 'sente' };
    mainline.moveLimitJishogi = {
      kind: 'awaiting_continuous_check_end',
      checkingPlayer: 'sente',
    };
    render(React.createElement(ShogiResearchScreen, { initialState: mainline }));

    const root = document.getElementById('shogi-research-screen')!;
    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    await user.click(document.querySelector('[data-coordinate="6七"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="6六"]') as HTMLElement);
    expect(root).toHaveAttribute('data-history-count', '3');

    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    expect(root).toHaveAttribute('data-replay-history-index', '2');
    const nestedStart = screen.getByRole('button', { name: 'ここから指し直す' });
    expect(nestedStart).toBeDisabled();
    await user.click(nestedStart);
    expect(screen.queryByRole('dialog', { name: 'ここから指し直しますか？' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    expect(root).toHaveAttribute('data-history-count', '4');
    expect(root).toHaveAttribute('data-last-move', '△4四歩');
    expect(root).toHaveAttribute('data-result', 'resignation');
    expect(root).toHaveAttribute('data-position-history-count', '5');
    expect(root).toHaveAttribute('data-position-snapshot-count', '5');
    expect(root).toHaveAttribute('data-move-limit-jishogi', 'awaiting_continuous_check_end');
    expect(root).toHaveAttribute('data-branch-origin-history-index', '');
    expect(document.querySelector('[data-coordinate="4四"]')).toHaveAttribute(
      'aria-label',
      '4筋 4段、後手の歩兵'
    );
  });

  it('同じ本譜から作った兄弟分岐をセッション内に保持し、独立した続きへ切り替えられる', async () => {
    const user = userEvent.setup();
    render(React.createElement(ShogiResearchScreen, { initialState: createFourMoveState() }));
    const root = document.getElementById('shogi-research-screen')!;

    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    await user.click(document.querySelector('[data-coordinate="6七"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="6六"]') as HTMLElement);
    expect(root).toHaveAttribute('data-last-move', '▲6六歩');

    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    expect(root).toHaveAttribute('data-history-count', '4');
    expect(root).toHaveAttribute('data-session-branch-count', '1');
    expect(screen.getByRole('button', { name: '本譜' })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    await user.click(document.querySelector('[data-coordinate="2七"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="2六"]') as HTMLElement);
    expect(root).toHaveAttribute('data-last-move', '▲2六歩');
    expect(root).toHaveAttribute('data-session-branch-count', '2');

    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    await user.click(screen.getByRole('button', { name: '第2手後からの分岐 1' }));
    expect(root).toHaveAttribute('data-history-count', '3');
    expect(root).toHaveAttribute('data-last-move', '▲6六歩');
    await user.click(document.querySelector('[data-coordinate="4三"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="4四"]') as HTMLElement);
    expect(root).toHaveAttribute('data-last-move', '△4四歩');

    await user.click(screen.getByRole('button', { name: '第2手後からの分岐 2' }));
    expect(root).toHaveAttribute('data-history-count', '3');
    expect(root).toHaveAttribute('data-last-move', '▲2六歩');
    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    expect(root).toHaveAttribute('data-last-move', '△4四歩');

    await user.click(screen.getByRole('button', { name: '第2手後からの分岐 1' }));
    expect(root).toHaveAttribute('data-history-count', '4');
    expect(root).toHaveAttribute('data-last-move', '△4四歩');
    expect(screen.getByRole('button', { name: '第2手後からの分岐 1' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('JSONでは本譜と兄弟分岐をセッション全体で、KIFでは選択中の一本道だけを書き出す', async () => {
    const user = userEvent.setup();
    render(React.createElement(ShogiResearchScreen, { initialState: createFourMoveState() }));
    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    await user.click(document.querySelector('[data-coordinate="6七"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="6六"]') as HTMLElement);
    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));

    const blobs: Blob[] = [];
    const originalCreateElement = document.createElement.bind(document);
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:session-${blobs.length}`;
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'a') vi.spyOn(element as HTMLAnchorElement, 'click').mockImplementation(() => {});
      return element;
    });

    try {
      await user.click(screen.getByRole('button', { name: '対局記録を保存' }));
      const mainlineSession = JSON.parse(await blobs[0].text());
      expect(mainlineSession.format).toBe('shogi-app-game-record-session');
      expect(mainlineSession.mainline.history).toHaveLength(4);
      expect(mainlineSession.mainline.branchFrom).toBeUndefined();
      expect(mainlineSession.branches).toHaveLength(1);

      await user.click(screen.getByRole('button', { name: '第2手後からの分岐 1' }));
      await user.click(screen.getByRole('button', { name: '対局記録を保存' }));
      const branchSession = JSON.parse(await blobs[1].text());
      expect(branchSession.mainline.history).toHaveLength(4);
      expect(branchSession.branches[0].record.history).toHaveLength(3);
      expect(branchSession.branches[0].record.recordId).not.toBe(branchSession.mainline.recordId);
      expect(branchSession.branches[0].record.branchFrom).toEqual({ recordId: branchSession.mainline.recordId, ply: 2 });
      expect(branchSession.selectedRecordId).toBe(branchSession.branches[0].record.recordId);

      await user.click(screen.getByRole('button', { name: 'KIF棋譜を保存' }));
      expect(await blobs[2].text()).toContain('   3 ６六歩(67)');
      expect(await blobs[2].text()).not.toContain('branchFrom');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('再読み込みした分岐JSONでは本譜へ戻れず、過去局面からの指し直しも開始できない', async () => {
    const user = userEvent.setup();
    const mainline = createFourMoveState();
    const started = createBranchFromReplayPosition(mainline, 2);
    expect(started).not.toBeNull();
    if (!started) return;

    render(React.createElement(ShogiResearchScreen, { initialState: mainline }));
    const input = document.getElementById('shogi-game-record-file-input');
    expect(input).toBeInstanceOf(HTMLInputElement);
    await user.upload(
      input as HTMLInputElement,
      new File(
        [serializeShogiGameRecordV1(started.state, new Date('2026-09-03T00:00:00.000Z'))],
        'branch.json',
        { type: 'application/json' }
      )
    );
    await user.click(await screen.findByRole('button', { name: '読み込む' }));

    const root = document.getElementById('shogi-research-screen')!;
    expect(root).toHaveAttribute('data-history-count', '2');
    expect(screen.queryByRole('button', { name: '本譜へ戻る' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /1手目 ▲7六歩の局面を表示/ }));
    const nestedStart = screen.getByRole('button', { name: 'ここから指し直す' });
    expect(nestedStart).toBeDisabled();
    await user.click(nestedStart);
    expect(screen.queryByRole('dialog', { name: 'ここから指し直しますか？' })).not.toBeInTheDocument();
    expect(root).toHaveAttribute('data-history-count', '2');
    expect(root).toHaveAttribute('data-branch-origin-history-index', '');
  });

  it('JSON読み込みは確定時だけセッション内の検討手順を破棄する', async () => {
    const user = userEvent.setup();
    const mainline = createFourMoveState();
    render(React.createElement(ShogiResearchScreen, { initialState: mainline }));
    const root = document.getElementById('shogi-research-screen')!;

    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    expect(root).toHaveAttribute('data-session-branch-count', '1');

    const jsonInput = document.getElementById('shogi-game-record-file-input') as HTMLInputElement;
    await user.upload(
      jsonInput,
      new File([serializeShogiGameRecordV1(mainline, new Date('2026-09-03T00:00:00.000Z'))], 'mainline.json', {
        type: 'application/json',
      })
    );
    await user.click(await screen.findByRole('button', { name: 'キャンセル' }));
    expect(root).toHaveAttribute('data-session-branch-count', '1');

    await user.upload(jsonInput, new File(['not-json'], 'broken.json', { type: 'application/json' }));
    await screen.findByRole('alert');
    expect(root).toHaveAttribute('data-session-branch-count', '1');

    await user.upload(
      jsonInput,
      new File([serializeShogiGameRecordV1(mainline, new Date('2026-09-03T00:00:00.000Z'))], 'mainline.json', {
        type: 'application/json',
      })
    );
    await user.click(await screen.findByRole('button', { name: '読み込む' }));
    expect(root).toHaveAttribute('data-session-branch-count', '0');
  });

  it('KIF読み込みは確定時だけセッション内の検討手順を破棄する', async () => {
    const user = userEvent.setup();
    const mainline = createFourMoveState();
    render(React.createElement(ShogiResearchScreen, { initialState: mainline }));
    const root = document.getElementById('shogi-research-screen')!;
    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    expect(root).toHaveAttribute('data-session-branch-count', '1');

    const kifInput = document.getElementById('shogi-kif-file-input') as HTMLInputElement;
    await user.upload(kifInput, new File([createKifText(mainline)], 'mainline.kif', { type: 'text/plain' }));
    await user.click(await screen.findByRole('button', { name: 'キャンセル' }));
    expect(root).toHaveAttribute('data-session-branch-count', '1');
    await user.upload(kifInput, new File(['broken'], 'broken.kif', { type: 'text/plain' }));
    await screen.findByRole('alert');
    expect(root).toHaveAttribute('data-session-branch-count', '1');
    await user.upload(kifInput, new File([createKifText(mainline)], 'mainline.kif', { type: 'text/plain' }));
    await user.click(await screen.findByRole('button', { name: '読み込む' }));
    expect(root).toHaveAttribute('data-session-branch-count', '0');
  });

  it('初期局面からも開始でき、新しい対局の確定時だけセッション内の検討手順を破棄する', async () => {
    const user = userEvent.setup();
    render(React.createElement(ShogiResearchScreen, { initialState: createFourMoveState() }));
    await user.click(screen.getByRole('button', { name: '初期局面' }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('初期局面から指し直します。本譜は変更されません。');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    const root = document.getElementById('shogi-research-screen')!;
    expect(root).toHaveAttribute('data-branch-origin-history-index', '0');
    expect(root).toHaveAttribute('data-history-count', '0');
    expect(root).toHaveAttribute('data-session-branch-count', '1');
    expect(screen.getByRole('button', { name: '初期局面からの分岐 1' })).toHaveAttribute(
      'aria-current',
      'page'
    );

    await user.click(screen.getByRole('button', { name: '新しい対局' }));
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(root).toHaveAttribute('data-session-branch-count', '1');
    await user.click(screen.getByRole('button', { name: '新しい対局' }));
    await user.click(screen.getByRole('button', { name: '新しい対局を始める' }));
    expect(root).toHaveAttribute('data-branch-origin-history-index', '');
    expect(root).toHaveAttribute('data-session-branch-count', '0');
    expect(screen.queryByRole('button', { name: '本譜へ戻る' })).not.toBeInTheDocument();
  });

  it('分岐元ごとの表示名を保持し、別の手数では連番を1から開始する', async () => {
    const user = userEvent.setup();
    render(React.createElement(ShogiResearchScreen, { initialState: createFourMoveState() }));

    await user.click(screen.getByRole('button', { name: '初期局面' }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));

    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));

    expect(screen.getByRole('button', { name: '初期局面からの分岐 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第2手後からの分岐 1' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});
