import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import {
  cloneBoardSquares,
  executeDrop,
  executeMove,
  getLegalDropSquares,
  hasLegalBoardMove,
  hasLegalDrop,
  hasLegalResponse,
  isCheckmate,
  isPlayerInCheck,
  validateDrop,
} from '../domain/shogi';
import {
  BoardState,
  GameResult,
  Piece,
  Player,
  createInitialBoardState,
} from '../types/shogi';

interface Placement {
  row: number;
  col: number;
  piece: Piece;
}

const senteKing: Piece = { id: 'sente-king', type: 'king', player: 'sente' };
const goteKing: Piece = { id: 'gote-king', type: 'king', player: 'gote' };

function createPosition(
  turn: Player,
  placements: Placement[],
  hands: { sente?: Piece[]; gote?: Piece[] } = {}
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) {
    for (const square of row) square.piece = null;
  }
  for (const { row, col, piece } of placements) {
    squares[row][col].piece = { ...piece };
  }
  return {
    ...initial,
    squares,
    turn,
    senteHand: hands.sente?.map((piece) => ({ ...piece })) ?? [],
    goteHand: hands.gote?.map((piece) => ({ ...piece })) ?? [],
  };
}

function createSenteMatingMovePosition(): BoardState {
  return createPosition('sente', [
    { row: 8, col: 4, piece: senteKing },
    { row: 0, col: 4, piece: goteKing },
    { row: 2, col: 4, piece: { id: 'mating-rook', type: 'rook', player: 'sente' } },
    { row: 1, col: 4, piece: { id: 'captured-silver', type: 'silver', player: 'gote' } },
    { row: 2, col: 3, piece: { id: 'rook-defender', type: 'gold', player: 'sente' } },
    { row: 2, col: 1, piece: { id: 'left-escape-guard', type: 'bishop', player: 'sente' } },
    { row: 2, col: 7, piece: { id: 'right-escape-guard', type: 'bishop', player: 'sente' } },
  ]);
}

function createSenteRookDropMatePosition(): { state: BoardState; rook: Piece } {
  const rook: Piece = { id: 'mating-drop-rook', type: 'rook', player: 'sente' };
  return {
    rook,
    state: createPosition(
      'sente',
      [
        { row: 8, col: 4, piece: senteKing },
        { row: 0, col: 4, piece: goteKing },
        { row: 2, col: 3, piece: { id: 'drop-defender', type: 'gold', player: 'sente' } },
        { row: 2, col: 1, piece: { id: 'drop-left-guard', type: 'bishop', player: 'sente' } },
        { row: 2, col: 7, piece: { id: 'drop-right-guard', type: 'bishop', player: 'sente' } },
      ],
      { sente: [rook] }
    ),
  };
}

function createPushedPawnMatePosition(): BoardState {
  return createPosition('sente', [
    { row: 8, col: 4, piece: senteKing },
    { row: 0, col: 4, piece: goteKing },
    { row: 2, col: 4, piece: { id: 'mating-pawn', type: 'pawn', player: 'sente' } },
    { row: 3, col: 4, piece: { id: 'pawn-defender', type: 'rook', player: 'sente' } },
    { row: 0, col: 3, piece: { id: 'gote-left-blocker', type: 'lance', player: 'gote' } },
    { row: 0, col: 5, piece: { id: 'gote-right-blocker', type: 'lance', player: 'gote' } },
    { row: 1, col: 3, piece: { id: 'gote-left-front-blocker', type: 'pawn', player: 'gote' } },
    { row: 1, col: 5, piece: { id: 'gote-right-front-blocker', type: 'pawn', player: 'gote' } },
  ]);
}

function createPawnDropMatePosition(): { state: BoardState; pawn: Piece } {
  const pawn: Piece = { id: 'illegal-mating-pawn', type: 'pawn', player: 'sente' };
  return {
    pawn,
    state: createPosition(
      'sente',
      [
        { row: 8, col: 4, piece: senteKing },
        { row: 0, col: 4, piece: goteKing },
        { row: 2, col: 4, piece: { id: 'pawn-drop-defender', type: 'gold', player: 'sente' } },
        { row: 0, col: 3, piece: { id: 'drop-left-blocker', type: 'lance', player: 'gote' } },
        { row: 0, col: 5, piece: { id: 'drop-right-blocker', type: 'lance', player: 'gote' } },
        { row: 1, col: 3, piece: { id: 'drop-left-front-blocker', type: 'pawn', player: 'gote' } },
        { row: 1, col: 5, piece: { id: 'drop-right-front-blocker', type: 'pawn', player: 'gote' } },
      ],
      { sente: [pawn] }
    ),
  };
}

function expectCheckmateResult(state: BoardState, winner: Player, loser: Player) {
  expect(state.status).toBe('ended');
  expect(state.result).toEqual({ winner, loser, endReason: 'checkmate' });
}

describe('一般的な詰み判定と着手後の終局処理', () => {
  it('通常移動による詰みを終局として履歴・手番・手数・駒取りまで記録する', () => {
    const state = createSenteMatingMovePosition();
    const result = executeMove(state, { row: 2, col: 4 }, { row: 1, col: 4 }, {
      promotion: 'decline',
    });

    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expectCheckmateResult(result.state, 'sente', 'gote');
    expect(result.state.turn).toBe('gote');
    expect(result.state.moveNumber).toBe(2);
    expect(result.state.senteHand).toContainEqual(
      expect.objectContaining({ id: 'captured-silver', type: 'silver', player: 'sente' })
    );
    expect(result.state.history).toEqual([result.move]);
    expect(result.state.lastMove).toBe(result.move);
    expect(result.move).toMatchObject({
      kind: 'move',
      player: 'sente',
      moveNumber: 1,
      capturedPieceType: 'silver',
      promotion: 'decline',
      notation: '▲5二飛不成',
    });
    expect(result.state.foulHistory).toEqual([]);
  });

  it('成る通常移動による詰みを成駒と棋譜へ反映する', () => {
    const result = executeMove(
      createSenteMatingMovePosition(),
      { row: 2, col: 4 },
      { row: 1, col: 4 },
      { promotion: 'promote' }
    );
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expectCheckmateResult(result.state, 'sente', 'gote');
    expect(result.state.squares[1][4].piece?.isPromoted).toBe(true);
    expect(result.move.notation).toBe('▲5二飛成');
  });

  it('盤上の歩を進める突き歩詰めは合法なcheckmateになる', () => {
    const result = executeMove(
      createPushedPawnMatePosition(),
      { row: 2, col: 4 },
      { row: 1, col: 4 },
      { promotion: 'decline' }
    );
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expectCheckmateResult(result.state, 'sente', 'gote');
    expect(result.move.notation).toBe('▲5二歩不成');
  });

  it('歩以外の駒打ちによる詰みを合法なcheckmateにする', () => {
    const { state, rook } = createSenteRookDropMatePosition();
    const result = executeDrop(state, rook.id, { row: 1, col: 4 });
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expectCheckmateResult(result.state, 'sente', 'gote');
    expect(result.state.turn).toBe('gote');
    expect(result.state.moveNumber).toBe(2);
    expect(result.state.senteHand).toEqual([]);
    expect(result.state.history).toEqual([result.move]);
    expect(result.state.lastMove).toBe(result.move);
    expect(result.move.notation).toBe('▲5二飛打');
  });

  it('玉が逃げられる場合は詰みではなく王手状態にする', () => {
    const state = createSenteMatingMovePosition();
    state.squares[2][1].piece = null;
    const result = executeMove(state, { row: 2, col: 4 }, { row: 1, col: 4 }, {
      promotion: 'decline',
    });
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.status).toBe('check');
    expect(result.state.result).toBeNull();
    expect(hasLegalBoardMove(result.state, 'gote')).toBe(true);
  });

  it('玉が王手駒を安全に取れる場合は詰みにならない', () => {
    const state = createSenteMatingMovePosition();
    state.squares[2][3].piece = null;
    const result = executeMove(state, { row: 2, col: 4 }, { row: 1, col: 4 }, {
      promotion: 'decline',
    });
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.status).toBe('check');
    expect(hasLegalBoardMove(result.state, 'gote')).toBe(true);
  });

  it('玉以外の盤上駒が王手駒を取れる場合は詰みにならない', () => {
    const state = createSenteMatingMovePosition();
    state.squares[2][3].piece = null;
    state.squares[2][5].piece = { id: 'alternate-rook-defender', type: 'gold', player: 'sente' };
    state.squares[3][2].piece = { id: 'responding-bishop', type: 'bishop', player: 'gote' };
    const result = executeMove(state, { row: 2, col: 4 }, { row: 1, col: 4 }, {
      promotion: 'decline',
    });
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.status).toBe('check');
    expect(hasLegalBoardMove(result.state, 'gote')).toBe(true);
  });

  it('盤上の駒を動かして直線王手へ合駒できる場合は詰みにならない', () => {
    const state = createPosition('sente', [
      { row: 8, col: 8, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
      { row: 4, col: 3, piece: { id: 'checking-rook', type: 'rook', player: 'sente' } },
      { row: 2, col: 3, piece: { id: 'blocking-gold', type: 'gold', player: 'gote' } },
    ]);
    const result = executeMove(state, { row: 4, col: 3 }, { row: 4, col: 4 });
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.status).toBe('check');
    expect(hasLegalBoardMove(result.state, 'gote')).toBe(true);
    expect(isCheckmate(result.state, 'gote')).toBe(false);
  });

  it('持ち駒を打って直線王手へ合駒できる場合は詰みにならない', () => {
    const gold: Piece = { id: 'blocking-hand-gold', type: 'gold', player: 'gote' };
    const state = createPosition(
      'sente',
      [
        { row: 8, col: 8, piece: senteKing },
        { row: 0, col: 4, piece: goteKing },
        { row: 4, col: 3, piece: { id: 'drop-check-rook', type: 'rook', player: 'sente' } },
      ],
      { gote: [gold] }
    );
    const result = executeMove(state, { row: 4, col: 3 }, { row: 4, col: 4 });
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.status).toBe('check');
    expect(hasLegalDrop(result.state, 'gote')).toBe(true);
    expect(getLegalDropSquares(result.state, gold.id)).toContainEqual({ row: 2, col: 4 });
  });

  it.each([
    ['二歩の歩', { id: 'nifu-pawn', type: 'pawn', player: 'gote' } as Piece,
      { row: 0, col: 4, piece: { id: 'board-pawn', type: 'pawn', player: 'gote' } as Piece }],
    ['行き所のない桂', { id: 'dead-knight', type: 'knight', player: 'gote' } as Piece, null],
  ])('%sだけでは見かけ上の合駒を合法な応手に数えない', (_label, handPiece, extra) => {
    const placements: Placement[] = [
      { row: 0, col: 0, piece: senteKing },
      { row: 6, col: 4, piece: goteKing },
      { row: 8, col: 4, piece: { id: 'short-line-rook', type: 'rook', player: 'sente' } },
    ];
    if (extra) placements.push(extra);
    const state = createPosition('gote', placements, { gote: [handPiece] });
    expect(isPlayerInCheck(state, 'gote')).toBe(true);
    expect(hasLegalDrop(state, 'gote')).toBe(false);
  });

  it('ピンされた駒による見かけ上の王手駒捕獲を合法な応手に数えない', () => {
    const state = createPosition('gote', [
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
      { row: 1, col: 4, piece: { id: 'checking-pawn', type: 'pawn', player: 'sente' } },
      { row: 3, col: 4, piece: { id: 'checking-pawn-guard', type: 'rook', player: 'sente' } },
      { row: 0, col: 0, piece: { id: 'pinning-rook', type: 'rook', player: 'sente' } },
      { row: 0, col: 3, piece: { id: 'pinned-gold', type: 'gold', player: 'gote' } },
      { row: 0, col: 5, piece: { id: 'right-blocker', type: 'lance', player: 'gote' } },
      { row: 1, col: 3, piece: { id: 'left-front-blocker', type: 'pawn', player: 'gote' } },
      { row: 1, col: 5, piece: { id: 'right-front-blocker', type: 'pawn', player: 'gote' } },
    ]);
    expect(isCheckmate(state, 'gote')).toBe(true);
    expect(hasLegalBoardMove(state, 'gote')).toBe(false);
  });

  it('王手ではない局面は合法手がなくても詰みと判定しない', () => {
    const state = createPosition('sente', [
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
    ]);
    expect(isPlayerInCheck(state, 'sente')).toBe(false);
    expect(isCheckmate(state, 'sente')).toBe(false);
  });

  it('王手でない合法手の後はactive・result:nullに戻す', () => {
    const state = createInitialBoardState();
    state.status = 'check';
    state.result = { winner: 'gote', loser: 'sente', endReason: 'draw' };
    const result = executeMove(state, { row: 6, col: 2 }, { row: 5, col: 2 });
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.status).toBe('active');
    expect(result.state.result).toBeNull();
  });

  it('先後を反転した対称局面でも後手勝ちの詰みになる', () => {
    const state = createPosition('gote', [
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
      { row: 6, col: 4, piece: { id: 'gote-mating-rook', type: 'rook', player: 'gote' } },
      { row: 7, col: 4, piece: { id: 'captured-sente-silver', type: 'silver', player: 'sente' } },
      { row: 6, col: 3, piece: { id: 'gote-rook-defender', type: 'gold', player: 'gote' } },
      { row: 6, col: 1, piece: { id: 'sente-left-escape-guard', type: 'bishop', player: 'gote' } },
      { row: 6, col: 7, piece: { id: 'sente-right-escape-guard', type: 'bishop', player: 'gote' } },
    ]);
    const result = executeMove(state, { row: 6, col: 4 }, { row: 7, col: 4 }, {
      promotion: 'decline',
    });
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expectCheckmateResult(result.state, 'gote', 'sente');
  });

  it('詰み照会は入力state・盤面・持ち駒・駒オブジェクトを変更しない', () => {
    const { state, rook } = createSenteRookDropMatePosition();
    const applied = executeDrop(state, rook.id, { row: 1, col: 4 });
    expect(applied.type).toBe('applied');
    if (applied.type !== 'applied') return;
    const position = { ...applied.state, status: 'active' as const, result: null };
    const snapshot = JSON.stringify(position);
    const squares = position.squares;
    const senteHand = position.senteHand;
    const goteHand = position.goteHand;
    const boardPiece = position.squares[0][4].piece;
    expect(isCheckmate(position, 'gote')).toBe(true);
    expect(hasLegalResponse(position, 'gote')).toBe(false);
    expect(JSON.stringify(position)).toBe(snapshot);
    expect(position.squares).toBe(squares);
    expect(position.senteHand).toBe(senteHand);
    expect(position.goteHand).toBe(goteHand);
    expect(position.squares[0][4].piece).toBe(boardPiece);
  });

  it('assistとstrictの合法手は同じ詰み結果になる', () => {
    const assist = executeMove(
      createSenteMatingMovePosition(),
      { row: 2, col: 4 },
      { row: 1, col: 4 },
      { mode: 'assist', promotion: 'decline' }
    );
    const strict = executeMove(
      createSenteMatingMovePosition(),
      { row: 2, col: 4 },
      { row: 1, col: 4 },
      { mode: 'strict', proposer: 'shogi_engine', promotion: 'decline' }
    );
    expect(assist.type).toBe('applied');
    expect(strict.type).toBe('applied');
    if (assist.type !== 'applied' || strict.type !== 'applied') return;
    expect(assist.state.status).toBe('ended');
    expect(strict.state.status).toBe('ended');
    expect(strict.state.result).toEqual(assist.state.result);
  });

  it('詰み終局後の通常移動と駒打ちは同じstateをgame_already_endedで拒否する', () => {
    const { state, rook } = createSenteRookDropMatePosition();
    const mate = executeDrop(state, rook.id, { row: 1, col: 4 });
    expect(mate.type).toBe('applied');
    if (mate.type !== 'applied') return;
    const handPiece: Piece = { id: 'post-mate-gold', type: 'gold', player: 'gote' };
    const ended = { ...mate.state, goteHand: [handPiece] };
    const move = executeMove(ended, { row: 0, col: 4 }, { row: 0, col: 3 }, {
      mode: 'strict',
    });
    const drop = executeDrop(ended, handPiece.id, { row: 4, col: 4 }, { mode: 'strict' });
    expect(move).toMatchObject({ type: 'rejected', reason: 'game_already_ended', state: ended });
    expect(drop).toMatchObject({ type: 'rejected', reason: 'game_already_ended', state: ended });
    expect(move.state).toBe(ended);
    expect(drop.state).toBe(ended);
  });

  it('打ち歩詰めは着手前に拒否しcheckmateとして記録しない', () => {
    const { state, pawn } = createPawnDropMatePosition();
    const snapshot = JSON.stringify(state);
    expect(validateDrop(state, pawn.id, { row: 1, col: 4 })).toMatchObject({
      isValid: false,
      reason: 'pawn_drop_mate',
    });
    expect(getLegalDropSquares(state, pawn.id)).not.toContainEqual({ row: 1, col: 4 });
    const assist = executeDrop(state, pawn.id, { row: 1, col: 4 }, { mode: 'assist' });
    const strict = executeDrop(state, pawn.id, { row: 1, col: 4 }, { mode: 'strict' });
    expect(assist).toMatchObject({ type: 'rejected', reason: 'pawn_drop_mate', state });
    expect(assist.state).toBe(state);
    expect(strict.type).toBe('foul_loss');
    if (strict.type === 'foul_loss') {
      expect(strict.state.result).toMatchObject({
        endReason: 'foul_loss',
        foulReason: 'pawn_drop_mate',
      });
    }
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('打ち歩詰め局面と一般詰み照会を反復しても再帰ループしない', () => {
    const { state, pawn } = createPawnDropMatePosition();
    for (let index = 0; index < 20; index += 1) {
      expect(validateDrop(state, pawn.id, { row: 1, col: 4 })).toMatchObject({
        reason: 'pawn_drop_mate',
      });
      expect(isCheckmate(state, 'gote')).toBe(false);
    }
  });
});

describe('王手・詰みのUI表示と終局後の操作停止', () => {
  it.each([
    ['sente', '対局中 / 先手番'],
    ['gote', '対局中 / 後手番'],
  ] as const)('通常状態の%s手番を表示する', (turn, text) => {
    const state = createInitialBoardState();
    state.turn = turn;
    render(<ShogiResearchScreen initialState={state} />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent(text);
    expect(badge).toHaveAttribute('aria-live', 'polite');
  });

  it.each([
    ['sente', '王手 / 先手番'],
    ['gote', '王手 / 後手番'],
  ] as const)('王手を受けている次の%s手番を文字で表示する', (turn, text) => {
    const state = createInitialBoardState();
    state.turn = turn;
    state.status = 'check';
    render(<ShogiResearchScreen initialState={state} />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent(text);
    expect(badge).toHaveAttribute('aria-live', 'polite');
  });

  it.each([
    ['sente', 'gote', '終局 / 先手勝ち（詰み）'],
    ['gote', 'sente', '終局 / 後手勝ち（詰み）'],
  ] as const)('詰み終局の勝者を反則負けと区別して表示する', (winner, loser, text) => {
    const state = createInitialBoardState();
    state.status = 'ended';
    state.result = { winner, loser, endReason: 'checkmate' };
    render(<ShogiResearchScreen initialState={state} />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent(text);
    expect(badge).toHaveAttribute('aria-live', 'polite');
  });

  it('既存の反則負け表示を維持する', () => {
    const state = createInitialBoardState();
    const result: GameResult = {
      winner: 'gote',
      loser: 'sente',
      endReason: 'foul_loss',
      foulReason: 'nifu',
    };
    state.status = 'ended';
    state.result = result;
    render(<ShogiResearchScreen initialState={state} />);
    expect(screen.getByRole('status')).toHaveTextContent('終局 / 後手勝ち（先手反則負け）');
  });

  it('通常移動の詰みをUIへ反映し、選択・候補・成りダイアログを消して盤を無効化する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createSenteMatingMovePosition()} />);
    await user.click(document.querySelector('[data-coordinate="5三"]') as HTMLElement);
    expect(document.querySelector('[data-coordinate="5二"]')).toHaveAttribute('data-candidate', 'true');
    await user.click(document.querySelector('[data-coordinate="5二"]') as HTMLElement);
    await user.click(screen.getByRole('button', { name: '不成' }));

    expect(screen.getByRole('status')).toHaveTextContent('終局 / 先手勝ち（詰み）');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('[data-selected="true"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-candidate="true"]')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);
    expect(document.getElementById('shogi-match-table')).toHaveAttribute('data-board-status', 'ended');
  });

  it('駒打ちの詰みをUIへ反映し、終局後は駒台と盤から新しい着手を開始できない', async () => {
    const user = userEvent.setup();
    const { state, rook } = createSenteRookDropMatePosition();
    state.goteHand = [{ id: 'disabled-gote-gold', type: 'gold', player: 'gote' }];
    render(<ShogiResearchScreen initialState={state} />);
    await user.click(document.querySelector(`[data-hand-piece-id="${rook.id}"]`) as HTMLElement);
    const target = document.querySelector('[data-coordinate="5二"]') as HTMLElement;
    expect(target).toHaveAttribute('data-candidate-kind', 'drop');
    await user.click(target);

    expect(screen.getByRole('status')).toHaveTextContent('終局 / 先手勝ち（詰み）');
    expect(document.querySelector('[data-candidate="true"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-selected="true"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-hand-piece-id="disabled-gote-gold"]')).toBeDisabled();
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'false');
    expect(document.getElementById('piece-stand-gote')).toHaveAttribute('data-active', 'false');
    expect(document.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);
  });

  it('フッターで一般的な詰み判定と終局処理への対応を案内する', () => {
    render(<ShogiResearchScreen />);
    expect(screen.getByText(/王手表示・一般的な詰み判定・終局処理に対応/)).toBeInTheDocument();
  });
});
