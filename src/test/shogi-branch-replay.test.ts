import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import {
  createBranchFromReplayPosition,
  createKifText,
  createShogiGameRecordV1,
  executeDrop,
  executeMove,
  restoreMainlineFromBranch,
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

describe('過去局面からの一本道ブランチ', () => {
  it('初期局面から独立した通常の対局状態を開始できる', () => {
    const mainline = applyMove(createInitialBoardState(), { row: 6, col: 2 }, { row: 5, col: 2 });
    const started = createBranchFromReplayPosition(mainline, 0);

    expect(started).not.toBeNull();
    if (!started) return;
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

    expect(createShogiGameRecordV1(branch, new Date('2026-09-03T00:00:00.000Z')).history)
      .toHaveLength(3);
    expect(createKifText(branch)).toContain('   3 ６六歩(67)');
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
    expect(screen.getByText('検討手順: 第2手後から指し直し')).toHaveAttribute('role', 'status');
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

  it('初期局面からも開始でき、新しい対局で本譜バックアップを破棄する', async () => {
    const user = userEvent.setup();
    render(React.createElement(ShogiResearchScreen, { initialState: createFourMoveState() }));
    await user.click(screen.getByRole('button', { name: '初期局面' }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('初期局面から指し直します。本譜は変更されません。');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    const root = document.getElementById('shogi-research-screen')!;
    expect(root).toHaveAttribute('data-branch-origin-history-index', '0');
    expect(root).toHaveAttribute('data-history-count', '0');

    await user.click(screen.getByRole('button', { name: '新しい対局' }));
    await user.click(screen.getByRole('button', { name: '新しい対局を始める' }));
    expect(root).toHaveAttribute('data-branch-origin-history-index', '');
    expect(screen.queryByRole('button', { name: '本譜へ戻る' })).not.toBeInTheDocument();
  });
});
