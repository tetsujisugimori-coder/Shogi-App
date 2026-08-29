import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import * as shogiDomain from '../domain/shogi';
import {
  cloneBoardSquares,
  executeMove,
  executeResignation,
} from '../domain/shogi';
import type {
  BoardState,
  BoardStatus,
  GameResult,
  Piece,
  Player,
} from '../types/shogi';
import { createInitialBoardState } from '../types/shogi';

interface Placement {
  row: number;
  col: number;
  piece: Piece;
}

function createPosition(turn: Player, placements: Placement[]): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) {
    for (const square of row) square.piece = null;
  }
  for (const placement of placements) {
    squares[placement.row][placement.col].piece = { ...placement.piece };
  }
  return {
    ...initial,
    squares,
    turn,
  };
}

function createPromotionChoicePosition(): BoardState {
  return createPosition('sente', [
    { row: 8, col: 8, piece: { id: 'sente-king', type: 'king', player: 'sente' } },
    { row: 0, col: 0, piece: { id: 'gote-king', type: 'king', player: 'gote' } },
    { row: 3, col: 4, piece: { id: 'promotable-rook', type: 'rook', player: 'sente' } },
  ]);
}

describe('投了ドメインAPI', () => {
  it('初期局面では現在の先手を投了者、後手を勝者として終局する', () => {
    const state = createInitialBoardState();
    const execution = executeResignation(state);
    expect(execution.type).toBe('applied');
    if (execution.type !== 'applied') return;

    expect(execution.state).not.toBe(state);
    expect(execution.state.status).toBe('ended');
    expect(execution.state.result).toEqual({
      winner: 'gote',
      loser: 'sente',
      endReason: 'resignation',
      details: '先手が投了',
    });
    expect(execution.result).toBe(execution.state.result);
  });

  it('後手番では現在の後手を投了者、先手を勝者として終局する', () => {
    const state = createInitialBoardState();
    state.turn = 'gote';
    const execution = executeResignation(state);
    expect(execution.type).toBe('applied');
    if (execution.type !== 'applied') return;
    expect(execution.result).toMatchObject({
      winner: 'sente',
      loser: 'gote',
      endReason: 'resignation',
      details: '後手が投了',
    });
    expect(execution.state.turn).toBe('gote');
  });

  it('王手中の手番側も投了できる', () => {
    const state = createInitialBoardState();
    state.status = 'check';
    state.turn = 'gote';
    const execution = executeResignation(state);
    expect(execution.type).toBe('applied');
    if (execution.type !== 'applied') return;
    expect(execution.state).toMatchObject({
      status: 'ended',
      result: { winner: 'sente', loser: 'gote', endReason: 'resignation' },
    });
  });

  it('盤面・持ち駒・手番・手数・着手履歴・反則履歴・局面履歴を変更も複製もしない', () => {
    const firstMove = executeMove(
      createInitialBoardState(),
      { row: 6, col: 2 },
      { row: 5, col: 2 }
    );
    expect(firstMove.type).toBe('applied');
    if (firstMove.type !== 'applied') return;
    const state = firstMove.state;
    const snapshot = JSON.stringify(state);
    const references = {
      squares: state.squares,
      boardPiece: state.squares[5][2].piece,
      senteHand: state.senteHand,
      goteHand: state.goteHand,
      history: state.history,
      lastMove: state.lastMove,
      foulHistory: state.foulHistory,
      positionHistory: state.positionHistory,
    };

    const execution = executeResignation(state);
    expect(execution.type).toBe('applied');
    if (execution.type !== 'applied') return;
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(execution.state.squares).toBe(references.squares);
    expect(execution.state.squares[5][2].piece).toBe(references.boardPiece);
    expect(execution.state.senteHand).toBe(references.senteHand);
    expect(execution.state.goteHand).toBe(references.goteHand);
    expect(execution.state.turn).toBe(state.turn);
    expect(execution.state.moveNumber).toBe(state.moveNumber);
    expect(execution.state.history).toBe(references.history);
    expect(execution.state.lastMove).toBe(references.lastMove);
    expect(execution.state.foulHistory).toBe(references.foulHistory);
    expect(execution.state.positionHistory).toBe(references.positionHistory);
    expect(execution.state.history).toHaveLength(1);
    expect(execution.state.foulHistory).toEqual([]);
  });

  it.each([
    {
      winner: 'sente', loser: 'gote', endReason: 'checkmate',
    } satisfies GameResult,
    {
      winner: 'gote', loser: 'sente', endReason: 'foul_loss', foulReason: 'nifu',
    } satisfies GameResult,
    {
      winner: null, loser: null, endReason: 'repetition',
    } satisfies GameResult,
    {
      winner: 'gote', loser: 'sente', endReason: 'foul_loss',
      foulReason: 'perpetual_check_repetition',
    } satisfies GameResult,
    {
      winner: 'sente', loser: 'gote', endReason: 'resignation',
    } satisfies GameResult,
  ])('終局済みの$endReason結果を再投了で上書きしない', (existingResult) => {
    const state: BoardState = {
      ...createInitialBoardState(),
      status: 'ended',
      result: existingResult,
    };
    const execution = executeResignation(state);
    expect(execution).toEqual({
      type: 'rejected',
      state,
      reason: 'game_already_ended',
      message: '対局は既に終局しています。',
    });
    expect(execution.state).toBe(state);
    expect(execution.state.result).toBe(existingResult);
  });

  it.each(['preparation', 'blunder', 'evaluating'] as const)(
    '%s状態では投了を明示的に拒否する',
    (status: BoardStatus) => {
      const state: BoardState = { ...createInitialBoardState(), status };
      const execution = executeResignation(state);
      expect(execution).toMatchObject({
        type: 'rejected',
        state,
        reason: 'resignation_not_available',
      });
      expect(execution.state).toBe(state);
    }
  );

  it('ドメイン公開APIからexecuteResignationを利用できる', () => {
    expect(typeof shogiDomain.executeResignation).toBe('function');
    expect(shogiDomain.executeResignation).toBe(executeResignation);
  });
});

describe('投了確認UIと終局表示', () => {
  it('対局中に投了ボタンを表示し、確認前には終局しない', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    const resignButton = screen.getByRole('button', { name: '投了' });
    expect(resignButton).toBeEnabled();
    await user.click(resignButton);
    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
    expect(document.getElementById('shogi-match-table')).toHaveAttribute('data-board-status', 'active');
  });

  it.each([
    ['sente', '先手が投了すると、後手の勝ちで対局を終了します。'],
    ['gote', '後手が投了すると、先手の勝ちで対局を終了します。'],
  ] as const)('現在の%s手番に応じた確認内容を表示する', async (turn, description) => {
    const user = userEvent.setup();
    const state = createInitialBoardState();
    state.turn = turn;
    render(<ShogiResearchScreen initialState={state} />);
    await user.click(screen.getByRole('button', { name: '投了' }));

    const dialog = screen.getByRole('dialog', { name: '投了しますか？' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'resignation-dialog-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'resignation-dialog-description');
    expect(within(dialog).getByText(description)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toHaveFocus();
  });

  it('キャンセルすると対局を継続し、投了ボタンへフォーカスを戻す', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    const resignButton = screen.getByRole('button', { name: '投了' });
    await user.click(resignButton);
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
    expect(resignButton).toHaveFocus();
  });

  it('Escapeでキャンセルし、投了ボタンへフォーカスを戻す', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    const resignButton = screen.getByRole('button', { name: '投了' });
    await user.click(resignButton);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(resignButton).toHaveFocus();
  });

  it('背景クリックは投了を確定せずダイアログを閉じる', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    await user.click(screen.getByRole('button', { name: '投了' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
  });

  it('TabとShift+Tabでフォーカスをダイアログ内に循環させる', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    await user.click(screen.getByRole('button', { name: '投了' }));
    const cancelButton = screen.getByRole('button', { name: 'キャンセル' });
    const confirmButton = screen.getByRole('button', { name: '投了する' });
    expect(cancelButton).toHaveFocus();
    await user.tab();
    expect(confirmButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancelButton).toHaveFocus();
  });

  it.each([
    ['sente', '終局 / 後手勝ち（先手投了）'],
    ['gote', '終局 / 先手勝ち（後手投了）'],
  ] as const)('%sが投了すると正しい勝敗を表示する', async (turn, expectedStatus) => {
    const user = userEvent.setup();
    const state = createInitialBoardState();
    state.turn = turn;
    render(<ShogiResearchScreen initialState={state} />);
    await user.click(screen.getByRole('button', { name: '投了' }));
    await user.click(screen.getByRole('button', { name: '投了する' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(expectedStatus);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('王手中でも投了ボタンを利用して終局できる', async () => {
    const user = userEvent.setup();
    const state = createInitialBoardState();
    state.status = 'check';
    state.turn = 'gote';
    render(<ShogiResearchScreen initialState={state} />);
    expect(screen.getByRole('status')).toHaveTextContent('王手 / 後手番');
    await user.click(screen.getByRole('button', { name: '投了' }));
    await user.click(screen.getByRole('button', { name: '投了する' }));
    expect(screen.getByRole('status')).toHaveTextContent('終局 / 先手勝ち（後手投了）');
  });

  it('投了終局後は選択・候補を消し、盤・駒台・投了ボタンを無効化する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    await user.click(document.querySelector('[data-coordinate="7七"]') as HTMLElement);
    expect(document.querySelector('[data-selected="true"]')).toBeInTheDocument();
    expect(document.querySelector('[data-candidate="true"]')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '投了' }));
    await user.click(screen.getByRole('button', { name: '投了する' }));

    expect(document.querySelector('[data-selected="true"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-candidate="true"]')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'false');
    expect(document.getElementById('piece-stand-gote')).toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('button', { name: '投了' })).toBeDisabled();
  });

  it('確認ダイアログ中は盤面操作を適用せず、投了ボタンと駒台も無効化する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    const source = document.querySelector('[data-coordinate="7七"]') as HTMLElement;
    const destination = document.querySelector('[data-coordinate="7六"]') as HTMLElement;
    await user.click(source);
    expect(destination).toHaveAttribute('data-candidate', 'true');
    await user.click(screen.getByRole('button', { name: '投了' }));
    expect(screen.getByRole('button', { name: '投了' })).toBeDisabled();
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'false');
    await user.click(destination);
    expect(screen.getByRole('dialog', { name: '投了しますか？' })).toBeInTheDocument();
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
    expect(source).toHaveTextContent('歩兵');
    expect(destination).not.toHaveTextContent('歩兵');
  });

  it('成り選択中は投了ボタンを無効化し、投了確認と競合しない', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createPromotionChoicePosition()} />);
    await user.click(document.querySelector('[data-coordinate="5四"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="5三"]') as HTMLElement);
    expect(screen.getByRole('dialog', { name: '成り選択' })).toBeInTheDocument();
    const resignButton = screen.getByRole('button', { name: '投了' });
    expect(resignButton).toBeDisabled();
    await user.click(resignButton);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: '投了しますか？' })).not.toBeInTheDocument();
  });

  it.each([
    [{ winner: 'sente', loser: 'gote', endReason: 'checkmate' } satisfies GameResult,
      '終局 / 先手勝ち（詰み）'],
    [{ winner: 'gote', loser: 'sente', endReason: 'foul_loss', foulReason: 'nifu' } satisfies GameResult,
      '終局 / 後手勝ち（先手反則負け）'],
    [{ winner: null, loser: null, endReason: 'repetition' } satisfies GameResult,
      '終局 / 千日手（無勝負）'],
    [{ winner: 'gote', loser: 'sente', endReason: 'foul_loss', foulReason: 'perpetual_check_repetition' } satisfies GameResult,
      '終局 / 先手反則負け（連続王手の千日手）'],
  ] as const)('既存終局結果「%s」の表示を維持する', (result, expectedStatus) => {
    const state: BoardState = {
      ...createInitialBoardState(),
      status: 'ended',
      result,
    };
    render(<ShogiResearchScreen initialState={state} />);
    expect(screen.getByRole('status')).toHaveTextContent(expectedStatus);
    expect(screen.getByRole('button', { name: '投了' })).toBeDisabled();
  });

  it.each(['preparation', 'blunder', 'evaluating'] as const)(
    '%s状態では投了ボタンを無効化する',
    (status) => {
      const state: BoardState = { ...createInitialBoardState(), status };
      render(<ShogiResearchScreen initialState={state} />);
      expect(screen.getByRole('button', { name: '投了' })).toBeDisabled();
    }
  );

  it('フッターで投了による終局処理への対応を案内する', () => {
    render(<ShogiResearchScreen />);
    expect(screen.getByText(/投了による終局処理に対応/)).toBeInTheDocument();
  });
});
