import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import { cloneBoardSquares, executeMove } from '../domain/shogi';
import {
  createInitialBoardState,
  type BoardState,
  type GameResult,
  type Piece,
} from '../types/shogi';

function applyMove(
  state: BoardState,
  from: { row: number; col: number },
  to: { row: number; col: number },
  promotion?: 'promote' | 'decline'
): BoardState {
  const execution = executeMove(state, from, to, {
    mode: 'assist',
    proposer: 'human',
    promotion,
  });
  if (execution.type !== 'applied') {
    throw new Error(`テスト局面の着手に失敗しました: ${execution.type}`);
  }
  return execution.state;
}

function createCapturedGameState(): BoardState {
  let state = createInitialBoardState();
  state = applyMove(state, { row: 6, col: 2 }, { row: 5, col: 2 });
  state = applyMove(state, { row: 2, col: 6 }, { row: 3, col: 6 });
  state = applyMove(state, { row: 7, col: 1 }, { row: 1, col: 7 }, 'promote');
  return state;
}

function createPromotionChoicePosition(): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) {
    for (const square of row) square.piece = null;
  }
  squares[8][8].piece = { id: 'sente-king', type: 'king', player: 'sente' };
  squares[0][0].piece = { id: 'gote-king', type: 'king', player: 'gote' };
  squares[3][4].piece = { id: 'promotable-rook', type: 'rook', player: 'sente' };
  return { ...initial, squares };
}

function root(): HTMLElement {
  const element = document.getElementById('shogi-research-screen');
  if (!element) throw new Error('将棋研究画面が見つかりません。');
  return element;
}

function boardPieceIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#shogi-grid [data-piece-id]'))
    .map((element) => element.dataset.pieceId ?? '')
    .sort();
}

async function confirmNewGame(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '新しい対局' }));
  await user.click(screen.getByRole('button', { name: '新しい対局を始める' }));
}

const endedResults: GameResult[] = [
  { winner: 'sente', loser: 'gote', endReason: 'checkmate' },
  { winner: 'gote', loser: 'sente', endReason: 'resignation' },
  { winner: 'gote', loser: 'sente', endReason: 'foul_loss', foulReason: 'nifu' },
  { winner: null, loser: null, endReason: 'repetition' },
  { winner: null, loser: null, endReason: 'five_hundred_move_jishogi' },
  { winner: 'sente', loser: 'gote', endReason: 'entering_king_win' },
  { winner: null, loser: null, endReason: 'entering_king_draw' },
  { winner: 'gote', loser: 'sente', endReason: 'entering_king_declaration_failure' },
  {
    winner: null,
    loser: null,
    endReason: 'agreed_jishogi_draw',
    sentePoints: 24,
    gotePoints: 24,
  },
  {
    winner: 'gote',
    loser: 'sente',
    endReason: 'agreed_jishogi_point_loss',
    sentePoints: 23,
    gotePoints: 24,
  },
];

describe('新しい対局の確認と初期化', () => {
  it.each([
    ['active', '対局中 / 先手番'],
    ['check', '王手 / 先手番'],
    ['ended', '終局 / 先手勝ち（詰み）'],
  ] as const)('%s状態で新しい対局を開始できる', async (status, statusText) => {
    const user = userEvent.setup();
    const initial = createInitialBoardState();
    const state: BoardState = status === 'ended'
      ? {
          ...initial,
          status,
          result: { winner: 'sente', loser: 'gote', endReason: 'checkmate' },
        }
      : { ...initial, status };
    render(<ShogiResearchScreen initialState={state} />);

    expect(screen.getByRole('status')).toHaveTextContent(statusText);
    const button = screen.getByRole('button', { name: '新しい対局' });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(screen.getByRole('dialog', { name: '新しい対局を始めますか？' })).toBeInTheDocument();
  });

  it('確認を開いただけでは局面・持ち駒・手番・手数・全履歴・結果・選択・候補を変更しない', async () => {
    const user = userEvent.setup();
    const handPiece: Piece = { id: 'previous-hand-gold', type: 'gold', player: 'gote' };
    const state = applyMove(
      createInitialBoardState(),
      { row: 6, col: 2 },
      { row: 5, col: 2 }
    );
    state.goteHand = [handPiece];
    state.foulHistory = [{
      kind: 'move',
      moveNumber: 2,
      player: 'gote',
      from: { row: 2, col: 0 },
      to: { row: 4, col: 0 },
      pieceType: 'pawn',
      reason: 'invalid_piece_move',
      message: 'テスト用の反則履歴',
      proposer: 'human',
    }];
    state.result = { winner: 'sente', loser: 'gote', endReason: 'resignation' };
    state.moveLimitJishogi = {
      kind: 'awaiting_continuous_check_end',
      checkingPlayer: 'sente',
    };
    render(<ShogiResearchScreen initialState={state} />);
    await user.click(document.querySelector('[data-coordinate="9三"]') as HTMLElement);

    const before = {
      turn: root().dataset.turn,
      moveNumber: root().dataset.moveNumber,
      history: root().dataset.historyCount,
      foulHistory: root().dataset.foulHistoryCount,
      positions: root().dataset.positionHistoryCount,
      result: root().dataset.result,
      lastMove: root().dataset.lastMove,
      moveLimitJishogi: root().dataset.moveLimitJishogi,
      ids: boardPieceIds(),
    };
    expect(document.querySelector('[data-selected="true"]')).toBeInTheDocument();
    expect(document.querySelector('[data-candidate="true"]')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '新しい対局' }));

    expect(root().dataset.turn).toBe(before.turn);
    expect(root().dataset.moveNumber).toBe(before.moveNumber);
    expect(root().dataset.historyCount).toBe(before.history);
    expect(root().dataset.foulHistoryCount).toBe(before.foulHistory);
    expect(root().dataset.positionHistoryCount).toBe(before.positions);
    expect(root().dataset.result).toBe(before.result);
    expect(root().dataset.lastMove).toBe(before.lastMove);
    expect(root().dataset.moveLimitJishogi).toBe(before.moveLimitJishogi);
    expect(boardPieceIds()).toEqual(before.ids);
    expect(document.querySelector('[data-hand-piece-id="previous-hand-gold"]')).toBeInTheDocument();
    expect(document.querySelector('[data-selected="true"]')).toBeInTheDocument();
    expect(document.querySelector('[data-candidate="true"]')).toBeInTheDocument();
  });

  it('見出し・説明・ARIA関連付けを備え、キャンセルを初期フォーカスにする', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    await user.click(screen.getByRole('button', { name: '新しい対局' }));

    const dialog = screen.getByRole('dialog', { name: '新しい対局を始めますか？' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'new-game-dialog-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'new-game-dialog-description');
    expect(within(dialog).getByText('現在の盤面、持ち駒、棋譜、反則履歴、対局結果は破棄され、元に戻せません。')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: '新しい対局を始める' })).not.toHaveFocus();
  });

  it('TabとShift+Tabでフォーカスをダイアログ内に循環させる', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    await user.click(screen.getByRole('button', { name: '新しい対局' }));
    const cancel = screen.getByRole('button', { name: 'キャンセル' });
    const confirm = screen.getByRole('button', { name: '新しい対局を始める' });

    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
  });

  it.each(['button', 'escape', 'backdrop'] as const)(
    '%sによるキャンセルは局面と選択を維持し、起動ボタンへフォーカスを戻す',
    async (method) => {
      const user = userEvent.setup();
      render(<ShogiResearchScreen />);
      const source = document.querySelector('[data-coordinate="7七"]') as HTMLElement;
      await user.click(source);
      const newGameButton = screen.getByRole('button', { name: '新しい対局' });
      await user.click(newGameButton);
      const dialog = screen.getByRole('dialog');

      if (method === 'button') {
        await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
      } else if (method === 'escape') {
        await user.keyboard('{Escape}');
      } else {
        expect(fireEvent.mouseDown(dialog.parentElement!)).toBe(false);
      }

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(newGameButton).toHaveFocus();
      expect(source).toHaveAttribute('data-selected', 'true');
      expect(document.querySelector('[data-coordinate="7六"]')).toHaveAttribute('data-candidate', 'true');
      expect(root()).toHaveAttribute('data-turn', 'sente');
      expect(root()).toHaveAttribute('data-move-number', '1');
      expect(root()).toHaveAttribute('data-history-count', '0');
    }
  );

  it('1手進んだ局面から確定すると平手初期局面へ戻り、盤・駒台・キーボード操作を再開する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    await user.click(document.querySelector('[data-coordinate="7七"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="7六"]') as HTMLElement);
    expect(root()).toHaveAttribute('data-turn', 'gote');
    expect(root()).toHaveAttribute('data-move-number', '2');
    expect(root()).toHaveAttribute('data-history-count', '1');

    const newGameButton = screen.getByRole('button', { name: '新しい対局' });
    await confirmNewGame(user);

    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
    expect(root()).toHaveAttribute('data-turn', 'sente');
    expect(root()).toHaveAttribute('data-move-number', '1');
    expect(root()).toHaveAttribute('data-history-count', '0');
    expect(document.querySelector('[data-coordinate="7七"]')).toHaveTextContent('歩兵');
    expect(document.querySelector('[data-coordinate="7六"]')).not.toHaveTextContent('歩兵');
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'true');
    expect(document.getElementById('piece-stand-gote')).toHaveAttribute('data-active', 'false');
    expect(newGameButton).toHaveFocus();
  });

  it('捕獲・棋譜・反則・終局結果・局面履歴・500手待機・標準外表示を丸ごと初期化する', async () => {
    const user = userEvent.setup();
    const state = createCapturedGameState();
    state.status = 'ended';
    state.viewMode = 'analysis';
    state.result = { winner: 'sente', loser: 'gote', endReason: 'resignation' };
    state.foulHistory = [{
      kind: 'drop',
      moveNumber: state.moveNumber,
      player: 'gote',
      from: null,
      to: { row: 4, col: 4 },
      pieceType: 'pawn',
      pieceId: 'old-foul-pawn',
      reason: 'nifu',
      message: '二歩です。',
      proposer: 'human',
    }];
    state.moveLimitJishogi = {
      kind: 'awaiting_continuous_check_end',
      checkingPlayer: 'sente',
    };
    render(<ShogiResearchScreen initialState={state} />);

    expect(root()).toHaveAttribute('data-history-count', '3');
    expect(root()).toHaveAttribute('data-foul-history-count', '1');
    expect(root()).toHaveAttribute('data-sente-hand-count', '1');
    expect(root()).toHaveAttribute('data-result', 'resignation');
    expect(root()).toHaveAttribute('data-last-move', '▲2二角成');
    expect(root()).toHaveAttribute('data-move-limit-jishogi', 'awaiting_continuous_check_end');
    expect(document.getElementById('shogi-match-table')).toHaveAttribute('data-view', 'analysis');

    await confirmNewGame(user);

    expect(boardPieceIds()).toHaveLength(40);
    expect(new Set(boardPieceIds()).size).toBe(40);
    expect(root()).toHaveAttribute('data-sente-hand-count', '0');
    expect(root()).toHaveAttribute('data-gote-hand-count', '0');
    expect(root()).toHaveAttribute('data-history-count', '0');
    expect(root()).toHaveAttribute('data-foul-history-count', '0');
    expect(root()).toHaveAttribute('data-position-history-count', '1');
    expect(root()).toHaveAttribute('data-last-move', '');
    expect(root()).toHaveAttribute('data-result', '');
    expect(root()).toHaveAttribute('data-move-limit-jishogi', '');
    expect(document.getElementById('shogi-match-table')).toHaveAttribute('data-view', 'research');
    expect(document.querySelector('[role="gridcell"][data-last-move]')).not.toBeInTheDocument();
  });

  it.each(endedResults)('$endReasonの終局後から標準の新しい対局を始められる', async (result) => {
    const user = userEvent.setup();
    const state: BoardState = {
      ...createInitialBoardState(),
      status: 'ended',
      result,
    };
    render(<ShogiResearchScreen initialState={state} />);

    expect(screen.getByRole('button', { name: '新しい対局' })).toBeEnabled();
    await confirmNewGame(user);
    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
    expect(root()).toHaveAttribute('data-result', '');
    expect(root()).toHaveAttribute('data-position-history-count', '1');
  });

  it('任意initialStateではなく標準局面へ戻し、複数回でも駒IDと履歴を重複させない', async () => {
    const user = userEvent.setup();
    const custom = createInitialBoardState();
    custom.squares[6][0].piece = null;
    custom.senteHand = [{ id: 'custom-hand-rook', type: 'rook', player: 'sente' }];
    custom.turn = 'gote';
    custom.moveNumber = 42;
    custom.viewMode = 'spectator';
    render(<ShogiResearchScreen initialState={custom} />);

    await confirmNewGame(user);
    const firstResetIds = boardPieceIds();
    expect(firstResetIds).toHaveLength(40);
    expect(new Set(firstResetIds).size).toBe(40);
    expect(document.querySelector('[data-coordinate="9七"]')).toHaveTextContent('歩兵');

    await user.click(document.querySelector('[data-coordinate="7七"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="7六"]') as HTMLElement);
    await confirmNewGame(user);
    const secondResetIds = boardPieceIds();
    expect(secondResetIds).toEqual(firstResetIds);
    expect(new Set(secondResetIds).size).toBe(40);
    expect(root()).toHaveAttribute('data-history-count', '0');
    expect(root()).toHaveAttribute('data-position-history-count', '1');
  });

  it('新しい対局の確認中は盤・駒台・既存操作・重複実行を停止し、ダイアログを1件に保つ', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    const source = document.querySelector('[data-coordinate="7七"]') as HTMLElement;
    await user.click(source);
    await user.click(screen.getByRole('button', { name: '新しい対局' }));

    for (const name of ['入玉宣言', '持将棋を提案', '投了', '新しい対局']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(document.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'false');
    expect(document.getElementById('piece-stand-gote')).toHaveAttribute('data-active', 'false');
    await user.click(document.querySelector('[data-coordinate="7六"]') as HTMLElement);
    expect(root()).toHaveAttribute('data-history-count', '0');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(source).toHaveAttribute('data-selected', 'true');
  });

  it('投了・入玉宣言・持将棋の確認中は新しい対局を開始しない', async () => {
    const user = userEvent.setup();
    for (const existingAction of ['投了', '入玉宣言', '持将棋を提案']) {
      const rendered = render(<ShogiResearchScreen />);
      await user.click(screen.getByRole('button', { name: existingAction }));
      expect(screen.getByRole('button', { name: '新しい対局' })).toBeDisabled();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(screen.queryByRole('dialog', { name: '新しい対局を始めますか？' })).not.toBeInTheDocument();
      rendered.unmount();
    }
  });

  it('成り選択中は新しい対局を開始せず、確定時には盤上選択と候補を消す', async () => {
    const user = userEvent.setup();
    const rendered = render(<ShogiResearchScreen initialState={createPromotionChoicePosition()} />);
    await user.click(document.querySelector('[data-coordinate="5四"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="5三"]') as HTMLElement);
    expect(screen.getByRole('dialog', { name: '成り選択' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新しい対局' })).toBeDisabled();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    rendered.unmount();

    render(<ShogiResearchScreen />);
    await user.click(document.querySelector('[data-coordinate="7七"]') as HTMLElement);
    expect(document.querySelector('[data-selected="true"]')).toBeInTheDocument();
    expect(document.querySelector('[data-candidate="true"]')).toBeInTheDocument();
    await confirmNewGame(user);
    expect(document.querySelector('[data-selected="true"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-candidate="true"]')).not.toBeInTheDocument();
  });

  it('持ち駒選択はキャンセル時に維持し、確定時に持ち駒と選択を消す', async () => {
    const user = userEvent.setup();
    const state = createInitialBoardState();
    state.senteHand = [{ id: 'selected-hand-silver', type: 'silver', player: 'sente' }];
    render(<ShogiResearchScreen initialState={state} />);
    const handButton = document.querySelector('[data-hand-piece-id="selected-hand-silver"]') as HTMLButtonElement;
    await user.click(handButton);
    await user.click(screen.getByRole('button', { name: '新しい対局' }));
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(handButton).toHaveAttribute('aria-pressed', 'true');

    await confirmNewGame(user);
    expect(document.querySelector('[data-hand-piece-id="selected-hand-silver"]')).not.toBeInTheDocument();
    expect(root()).toHaveAttribute('data-sente-hand-count', '0');
    expect(document.querySelector('[aria-pressed="true"]')).not.toBeInTheDocument();
  });
});
