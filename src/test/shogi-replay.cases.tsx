import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import {
  executeDrop,
  executeMove,
  executeResignation,
  getPositionSnapshot,
  normalizePositionSnapshots,
} from '../domain/shogi';
import { createInitialBoardState, type BoardState, type Piece } from '../types/shogi';

function applyMove(
  state: BoardState,
  from: { row: number; col: number },
  to: { row: number; col: number }
): BoardState {
  const result = executeMove(state, from, to);
  expect(result.type).toBe('applied');
  return result.state;
}

function createPromotionState(row: number, col: number): BoardState {
  const state = createInitialBoardState();
  const pawn = state.squares[6][col].piece;
  expect(pawn).not.toBeNull();
  state.squares[6][col].piece = null;
  state.squares[row][col].piece = pawn;
  state.positionSnapshots = undefined;
  return state;
}

describe('局面再生ドメイン', () => {
  it('初期局面を独立したスナップショットとして保持する', () => {
    const state = createInitialBoardState();
    const snapshot = getPositionSnapshot(state, 0);

    expect(state.positionSnapshots).toHaveLength(1);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.historyIndex).toBe(0);
    expect(snapshot?.squares.flat().filter((square) => square.piece)).toHaveLength(40);
    expect(snapshot?.senteHand).toEqual([]);
    expect(snapshot?.goteHand).toEqual([]);
    expect(snapshot?.turn).toBe('sente');
    expect(snapshot?.moveNumber).toBe(1);
    expect(snapshot?.lastMove).toBeNull();
  });

  it('連続した合法手の確定後に各局面を1件ずつ記録する', () => {
    const initial = createInitialBoardState();
    const afterFirst = applyMove(initial, { row: 6, col: 2 }, { row: 5, col: 2 });
    const afterSecond = applyMove(afterFirst, { row: 2, col: 6 }, { row: 3, col: 6 });

    expect(afterSecond.positionSnapshots).toHaveLength(3);
    expect(afterSecond.positionSnapshots?.map((snapshot) => snapshot.historyIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(getPositionSnapshot(afterSecond, 1)?.squares[5][2].piece?.id).toBe(
      'sente-pawn-7'
    );
    expect(getPositionSnapshot(afterSecond, 1)?.turn).toBe('gote');
    expect(getPositionSnapshot(afterSecond, 1)?.moveNumber).toBe(2);
    expect(getPositionSnapshot(afterSecond, 2)?.lastMove?.notation).toBe('△3四歩');
  });

  it('駒取りでは成りを解除した駒を持ち駒に保存する', () => {
    const state = createInitialBoardState();
    const captured = state.squares[2][4].piece;
    expect(captured).not.toBeNull();
    if (!captured) throw new Error('captured piece fixture is missing');
    state.squares[2][4].piece = null;
    state.squares[5][4].piece = { ...captured, isPromoted: true };
    state.positionSnapshots = undefined;

    const result = executeMove(state, { row: 6, col: 4 }, { row: 5, col: 4 });
    expect(result.type).toBe('applied');
    const before = getPositionSnapshot(result.state, 0);
    const after = getPositionSnapshot(result.state, 1);
    expect(before?.squares[5][4].piece?.isPromoted).toBe(true);
    expect(after?.squares[5][4].piece?.player).toBe('sente');
    expect(after?.senteHand).toContainEqual(
      expect.objectContaining({ type: 'pawn', player: 'sente', isPromoted: false })
    );
  });

  it.each([
    ['promote', true],
    ['decline', false],
  ] as const)('%sを選んだ局面の成り状態を保存する', (promotion, promoted) => {
    const state = createPromotionState(3, 4);
    const result = executeMove(
      state,
      { row: 3, col: 4 },
      { row: 2, col: 4 },
      { promotion }
    );
    expect(result.type).toBe('applied');
    const isPromoted =
      getPositionSnapshot(result.state, 1)?.squares[2][4].piece?.isPromoted === true;
    expect(isPromoted).toBe(promoted);
  });

  it('必須成りの確定局面を保存する', () => {
    const state = createPromotionState(1, 0);
    const result = executeMove(
      state,
      { row: 1, col: 0 },
      { row: 0, col: 0 },
      { promotion: 'promote' }
    );
    expect(result.type).toBe('applied');
    expect(getPositionSnapshot(result.state, 1)?.squares[0][0].piece?.isPromoted).toBe(true);
  });

  it('指定した持ち駒だけを減らし、駒打ち局面を保存する', () => {
    const state = createInitialBoardState();
    const pawn: Piece = { id: 'replay-pawn', type: 'pawn', player: 'sente' };
    const gold: Piece = { id: 'replay-gold', type: 'gold', player: 'sente' };
    state.senteHand = [pawn, gold];
    state.positionSnapshots = undefined;

    const result = executeDrop(state, gold.id, { row: 4, col: 4 });
    expect(result.type).toBe('applied');
    const snapshot = getPositionSnapshot(result.state, 1);
    expect(snapshot?.senteHand.map((piece) => piece.id)).toEqual([pawn.id]);
    expect(snapshot?.squares[4][4].piece).toEqual(expect.objectContaining(gold));
    expect(snapshot?.lastMove).toEqual(expect.objectContaining({ kind: 'drop', pieceId: gold.id }));
  });

  it('後続手とスナップショットの変更が相互の盤・駒台・直前手へ波及しない', () => {
    const initial = createInitialBoardState();
    const afterFirst = applyMove(initial, { row: 6, col: 2 }, { row: 5, col: 2 });
    const firstSnapshot = getPositionSnapshot(afterFirst, 1);
    const afterSecond = applyMove(afterFirst, { row: 2, col: 6 }, { row: 3, col: 6 });

    expect(firstSnapshot?.squares[2][6].piece?.id).toBe('gote-pawn-3');
    expect(firstSnapshot?.squares).not.toBe(afterSecond.squares);
    expect(firstSnapshot?.squares[5]).not.toBe(afterSecond.squares[5]);
    expect(firstSnapshot?.squares[5][2].piece).not.toBe(afterSecond.squares[5][2].piece);
    expect(firstSnapshot?.senteHand).not.toBe(afterSecond.senteHand);
    expect(firstSnapshot?.lastMove).not.toBe(afterSecond.lastMove);

    if (firstSnapshot) firstSnapshot.squares[5][2].piece = null;
    expect(afterSecond.squares[5][2].piece?.id).toBe('sente-pawn-7');
  });

  it('不正手・反則負け・投了ではスナップショットを追加しない', () => {
    const state = createInitialBoardState();
    const assist = executeMove(state, { row: 6, col: 2 }, { row: 4, col: 2 });
    const strict = executeMove(
      state,
      { row: 6, col: 2 },
      { row: 4, col: 2 },
      { mode: 'strict', proposer: 'shogi_engine' }
    );
    const resigned = executeResignation(state);

    expect(assist.state.positionSnapshots).toHaveLength(1);
    expect(strict.state.positionSnapshots).toHaveLength(1);
    expect(resigned.state.positionSnapshots).toHaveLength(1);
  });

  it('履歴があっても欠落・不整合な過去局面を捏造せず現在だけを基準化する', () => {
    const state = createInitialBoardState();
    state.history = [
      {
        kind: 'move',
        moveNumber: 42,
        player: 'sente',
        from: { row: 6, col: 2 },
        to: { row: 5, col: 2 },
        pieceType: 'pawn',
        capturedPieceType: null,
        promotion: 'none',
        notation: '外部棋譜',
      },
    ];
    state.positionSnapshots = undefined;
    const normalized = normalizePositionSnapshots(state);

    expect(normalized.positionSnapshots).toHaveLength(1);
    expect(normalized.positionSnapshots?.[0].historyIndex).toBe(1);
    expect(getPositionSnapshot(normalized, 0)).toBeNull();
    expect(normalized.history).toEqual(state.history);
  });
});

describe('局面再生UI', () => {
  it('棋譜行、初期局面、前後移動、現在局面復帰を読み取り専用で切り替える', async () => {
    const user = userEvent.setup();
    const afterFirst = applyMove(
      createInitialBoardState(),
      { row: 6, col: 2 },
      { row: 5, col: 2 }
    );
    const state = applyMove(afterFirst, { row: 2, col: 6 }, { row: 3, col: 6 });
    render(<ShogiResearchScreen initialState={state} />);

    const historyPanel = screen.getByRole('complementary', { name: '棋譜パネル' });
    await user.click(within(historyPanel).getByRole('button', { name: '初期局面' }));
    expect(screen.getByRole('status')).toHaveTextContent('初期局面を閲覧中 / 次は先手番');
    expect(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'true');
    expect(screen.getByRole('button', { name: '前の手' })).toBeDisabled();
    expect(screen.getByRole('gridcell', { name: '7筋 7段、先手の歩兵' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '次の手' }));
    expect(screen.getByRole('status')).toHaveTextContent('1手目終了局面を閲覧中');
    expect(screen.getByRole('listitem', { name: /1手目 ▲7六歩 現在表示中/ })).toHaveAttribute(
      'aria-current',
      'step'
    );
    expect(screen.getByRole('gridcell', { name: '7筋 6段、先手の歩兵' })).toHaveAttribute(
      'data-last-move',
      'dest'
    );

    await user.click(screen.getByRole('button', { name: '次の手' }));
    expect(screen.getByRole('status')).toHaveTextContent('2手目終了局面を閲覧中');
    expect(screen.getByRole('button', { name: '次の手' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '前の手' }));
    expect(screen.getByRole('status')).toHaveTextContent('1手目終了局面を閲覧中');

    expect(screen.getByRole('button', { name: '投了' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '入玉宣言' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '持将棋を提案' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '新しい対局' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '現在局面へ戻る' }));
    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
    expect(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'false');
    expect(screen.getByRole('button', { name: '投了' })).toBeEnabled();
  });

  it('再生データがない外部棋譜行を表示したまま選択不可にする', () => {
    const state = createInitialBoardState();
    state.history = [
      {
        kind: 'move',
        moveNumber: 9,
        player: 'sente',
        from: { row: 6, col: 2 },
        to: { row: 5, col: 2 },
        pieceType: 'pawn',
        capturedPieceType: null,
        promotion: 'none',
        notation: '▲外部棋譜',
      },
      {
        kind: 'move',
        moveNumber: 10,
        player: 'gote',
        from: { row: 2, col: 6 },
        to: { row: 3, col: 6 },
        pieceType: 'pawn',
        capturedPieceType: null,
        promotion: 'none',
        notation: '△外部棋譜',
      },
    ];
    state.positionSnapshots = undefined;
    render(<ShogiResearchScreen initialState={state} />);

    expect(screen.getByRole('listitem', { name: /9手目 ▲外部棋譜 再生不可/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /9手目 ▲外部棋譜の局面を表示（再生データなし）/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '初期局面' })).toBeDisabled();
  });

  it('ダイアログ中は背後の棋譜行から再生を開始できない', async () => {
    const user = userEvent.setup();
    const state = applyMove(
      createInitialBoardState(),
      { row: 6, col: 2 },
      { row: 5, col: 2 }
    );
    render(<ShogiResearchScreen initialState={state} />);

    await user.click(screen.getByRole('button', { name: '投了' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1手目 ▲7六歩の局面を表示/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '初期局面' })).toBeDisabled();
  });
});
