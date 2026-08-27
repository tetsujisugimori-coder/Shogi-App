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
  getLegalMoves,
  isKingInCheck,
  simulateDropSquares,
  validateDrop,
} from '../domain/shogi';
import {
  BoardState,
  Piece,
  PieceType,
  Player,
  createInitialBoardState,
} from '../types/shogi';

function createDropState(
  hand: Piece[],
  turn: Player = 'sente',
  boardPieces: Array<{ row: number; col: number; piece: Piece }> = []
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) {
    for (const square of row) square.piece = null;
  }
  for (const item of boardPieces) squares[item.row][item.col].piece = { ...item.piece };
  return {
    ...initial,
    squares,
    turn,
    senteHand: turn === 'sente' ? hand : [],
    goteHand: turn === 'gote' ? hand : [],
  };
}

const senteKing: Piece = { id: 'king-s', type: 'king', player: 'sente' };
const goteKing: Piece = { id: 'king-g', type: 'king', player: 'gote' };

function createPawnDropMateState(droppingPlayer: Player = 'sente') {
  const pawn: Piece = {
    id: `${droppingPlayer}-mate-pawn`,
    type: 'pawn',
    player: droppingPlayer,
  };
  const isSente = droppingPlayer === 'sente';
  const to = { row: isSente ? 1 : 7, col: 4 };
  const state = createDropState([pawn], droppingPlayer, isSente
    ? [
        { row: 8, col: 4, piece: senteKing },
        { row: 0, col: 4, piece: goteKing },
        { row: 2, col: 4, piece: { id: 'sente-pawn-guard', type: 'gold', player: 'sente' } },
        { row: 0, col: 3, piece: { id: 'gote-left-blocker', type: 'lance', player: 'gote' } },
        { row: 0, col: 5, piece: { id: 'gote-right-blocker', type: 'lance', player: 'gote' } },
        { row: 1, col: 3, piece: { id: 'gote-left-front-blocker', type: 'pawn', player: 'gote' } },
        { row: 1, col: 5, piece: { id: 'gote-right-front-blocker', type: 'pawn', player: 'gote' } },
      ]
    : [
        { row: 8, col: 4, piece: senteKing },
        { row: 0, col: 4, piece: goteKing },
        { row: 6, col: 4, piece: { id: 'gote-pawn-guard', type: 'gold', player: 'gote' } },
        { row: 8, col: 3, piece: { id: 'sente-left-blocker', type: 'lance', player: 'sente' } },
        { row: 8, col: 5, piece: { id: 'sente-right-blocker', type: 'lance', player: 'sente' } },
        { row: 7, col: 3, piece: { id: 'sente-left-front-blocker', type: 'pawn', player: 'sente' } },
        { row: 7, col: 5, piece: { id: 'sente-right-front-blocker', type: 'pawn', player: 'sente' } },
      ]);
  return { state, pawn, to, respondingPlayer: isSente ? 'gote' as const : 'sente' as const };
}

function expectNoLegalBoardMoveResponses(
  squares: BoardState['squares'],
  respondingPlayer: Player
) {
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      if (squares[row][col].piece?.player === respondingPlayer) {
        expect(getLegalMoves(squares, { row, col }, respondingPlayer)).toEqual([]);
      }
    }
  }
}

describe('駒打ちドメイン', () => {
  it.each(['pawn', 'lance', 'knight', 'silver', 'gold', 'bishop', 'rook'] as const)(
    '先手が持ち駒の%sを合法な空きマスへ打てる',
    (type) => {
      const piece: Piece = { id: `s-${type}`, type, player: 'sente' };
      const state = createDropState([piece]);
      const result = executeDrop(state, piece.id, { row: 4, col: 4 });

      expect(result.type).toBe('applied');
      if (result.type !== 'applied') return;
      expect(result.state.squares[4][4].piece).toEqual({ ...piece, isPromoted: false });
      expect(result.state.senteHand).toHaveLength(0);
      expect(state.squares[4][4].piece).toBeNull();
      expect(state.senteHand).toEqual([piece]);
    }
  );

  it('後手も持ち駒を打ち、手番・手数・履歴を進める', () => {
    const piece: Piece = { id: 'g-bishop', type: 'bishop', player: 'gote' };
    const state = createDropState([piece], 'gote');
    const result = executeDrop(state, piece.id, { row: 3, col: 5 });

    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.turn).toBe('sente');
    expect(result.state.moveNumber).toBe(2);
    expect(result.move).toMatchObject({
      kind: 'drop',
      from: null,
      to: { row: 3, col: 5 },
      pieceId: piece.id,
      pieceType: 'bishop',
      capturedPieceType: null,
      promotion: 'none',
      notation: '△4四角打',
    });
    expect(result.state.lastMove).toEqual(result.move);
  });

  it('指定IDの1枚だけを消費し、同種の別IDを残す', () => {
    const first: Piece = { id: 'pawn-first', type: 'pawn', player: 'sente' };
    const selected: Piece = { id: 'pawn-selected', type: 'pawn', player: 'sente' };
    const state = createDropState([first, selected]);
    const originalSquares = state.squares;
    const originalHand = state.senteHand;
    const result = executeDrop(state, selected.id, { row: 4, col: 4 });

    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.senteHand).toEqual([first]);
    expect(result.state.squares[4][4].piece?.id).toBe(selected.id);
    expect(result.state.squares).not.toBe(originalSquares);
    expect(result.state.senteHand).not.toBe(originalHand);
    expect(state.senteHand).toEqual([first, selected]);
  });

  it('仮想盤面は元盤面と駒を変更せず未成で配置する', () => {
    const piece: Piece = { id: 'sim-pawn', type: 'pawn', player: 'sente' };
    const state = createDropState([piece]);
    const simulated = simulateDropSquares(state.squares, piece, { row: 4, col: 4 });
    expect(simulated).not.toBe(state.squares);
    expect(simulated[4][4].piece).toEqual({ ...piece, isPromoted: false });
    expect(state.squares[4][4].piece).toBeNull();
  });

  it.each([
    ['盤外', 'pawn', { row: -1, col: 4 }, 'out_of_bounds'],
    ['存在しないID', 'pawn', { row: 4, col: 4 }, 'hand_piece_not_found'],
    ['王将', 'king', { row: 4, col: 4 }, 'undroppable_piece'],
  ] as const)('%sを拒否する', (_label, type, to, reason) => {
    const piece: Piece = { id: type === 'pawn' ? 'existing-pawn' : 'king-in-hand', type, player: 'sente' };
    const state = createDropState([piece]);
    const id = reason === 'hand_piece_not_found' ? 'missing' : piece.id;
    const validation = validateDrop(state, id, to);
    expect(validation).toMatchObject({ isValid: false, reason });
  });

  it('相手の持ち駒、不正な所有者、成った持ち駒、occupied squareを区別して拒否する', () => {
    const opponent: Piece = { id: 'opponent-gold', type: 'gold', player: 'gote' };
    const wrongOwner: Piece = { id: 'wrong-owner', type: 'silver', player: 'gote' };
    const promoted: Piece = { id: 'promoted-hand', type: 'pawn', player: 'sente', isPromoted: true };
    const state = createDropState([wrongOwner, promoted], 'sente', [
      { row: 4, col: 4, piece: { id: 'occupied', type: 'gold', player: 'sente' } },
    ]);
    state.goteHand = [opponent];

    expect(validateDrop(state, opponent.id, { row: 3, col: 3 })).toMatchObject({ reason: 'not_own_hand_piece' });
    expect(validateDrop(state, wrongOwner.id, { row: 3, col: 3 })).toMatchObject({ reason: 'not_own_hand_piece' });
    expect(validateDrop(state, promoted.id, { row: 3, col: 3 })).toMatchObject({ reason: 'invalid_hand_piece_state' });
    expect(validateDrop(state, promoted.id, { row: 4, col: 4 })).toMatchObject({ reason: 'invalid_hand_piece_state' });

    const goldState = { ...state, senteHand: [{ id: 'gold', type: 'gold', player: 'sente' } as Piece] };
    expect(validateDrop(goldState, 'gold', { row: 4, col: 4 })).toMatchObject({ reason: 'occupied_drop_square' });
  });

  it.each([
    ['先手歩0', 'sente', 'pawn', 0, false],
    ['先手歩1', 'sente', 'pawn', 1, true],
    ['先手香0', 'sente', 'lance', 0, false],
    ['先手香1', 'sente', 'lance', 1, true],
    ['先手桂0', 'sente', 'knight', 0, false],
    ['先手桂1', 'sente', 'knight', 1, false],
    ['先手桂2', 'sente', 'knight', 2, true],
    ['後手歩8', 'gote', 'pawn', 8, false],
    ['後手歩7', 'gote', 'pawn', 7, true],
    ['後手香8', 'gote', 'lance', 8, false],
    ['後手香7', 'gote', 'lance', 7, true],
    ['後手桂8', 'gote', 'knight', 8, false],
    ['後手桂7', 'gote', 'knight', 7, false],
    ['後手桂6', 'gote', 'knight', 6, true],
  ] as const)('行き所境界: %s', (_label, player, type, row, legal) => {
    const piece: Piece = { id: `${player}-${type}`, type, player };
    const state = createDropState([piece], player);
    const validation = validateDrop(state, piece.id, { row, col: 4 });
    expect(validation.isValid).toBe(legal);
    if (legal) {
      expect(getLegalDropSquares(state, piece.id)).toContainEqual({ row, col: 4 });
    } else {
      expect(getLegalDropSquares(state, piece.id)).not.toContainEqual({ row, col: 4 });
    }
  });

  it('二歩となる同じ筋を拒否し候補から除外する', () => {
    const handPawn: Piece = { id: 'drop-pawn', type: 'pawn', player: 'sente' };
    const state = createDropState([handPawn], 'sente', [
      { row: 5, col: 3, piece: { id: 'board-pawn', type: 'pawn', player: 'sente' } },
    ]);
    expect(validateDrop(state, handPawn.id, { row: 4, col: 3 })).toMatchObject({ reason: 'nifu' });
    expect(getLegalDropSquares(state, handPawn.id)).not.toContainEqual({ row: 4, col: 3 });
    expect(getLegalDropSquares(state, handPawn.id)).toContainEqual({ row: 4, col: 4 });
  });

  it.each([
    ['と金', { id: 'promoted-pawn', type: 'pawn', player: 'sente', isPromoted: true } as Piece],
    ['相手の歩', { id: 'opponent-pawn', type: 'pawn', player: 'gote' } as Piece],
  ])('%sは二歩判定で数えない', (_label, boardPiece) => {
    const handPawn: Piece = { id: 'drop-pawn', type: 'pawn', player: 'sente' };
    const state = createDropState([handPawn], 'sente', [{ row: 5, col: 3, piece: boardPiece }]);
    expect(validateDrop(state, handPawn.id, { row: 4, col: 3 })).toEqual({ isValid: true });
  });

  it('後手の未成歩にも二歩を適用し、駒台の歩が複数あるだけでは二歩にしない', () => {
    const pawn1: Piece = { id: 'g-pawn-1', type: 'pawn', player: 'gote' };
    const pawn2: Piece = { id: 'g-pawn-2', type: 'pawn', player: 'gote' };
    const state = createDropState([pawn1, pawn2], 'gote');
    expect(validateDrop(state, pawn1.id, { row: 4, col: 2 })).toEqual({ isValid: true });
    state.squares[3][2].piece = { id: 'g-board-pawn', type: 'pawn', player: 'gote' };
    expect(validateDrop(state, pawn1.id, { row: 4, col: 2 })).toMatchObject({ reason: 'nifu' });
  });

  it('先手5二歩打が完全な詰みになる場合はpawn_drop_mateで拒否する', () => {
    const { state, pawn, to, respondingPlayer } = createPawnDropMateState('sente');
    const simulated = simulateDropSquares(state.squares, pawn, to);

    expect(isKingInCheck(state.squares, respondingPlayer)).toBe(false);
    expect(isKingInCheck(simulated, respondingPlayer)).toBe(true);
    expectNoLegalBoardMoveResponses(simulated, respondingPlayer);
    expect(validateDrop(state, pawn.id, to)).toEqual({
      isValid: false,
      reason: 'pawn_drop_mate',
      message: '歩を打って相手玉を詰ませる打ち歩詰めは禁止されています。',
    });
  });

  it('後手5八歩打でも対称に打ち歩詰めを拒否する', () => {
    const { state, pawn, to, respondingPlayer } = createPawnDropMateState('gote');
    const simulated = simulateDropSquares(state.squares, pawn, to);

    expect(isKingInCheck(simulated, respondingPlayer)).toBe(true);
    expectNoLegalBoardMoveResponses(simulated, respondingPlayer);
    expect(validateDrop(state, pawn.id, to)).toMatchObject({
      isValid: false,
      reason: 'pawn_drop_mate',
    });
  });

  it('玉に逃げられるマスが一つでもあれば歩打ちは合法になる', () => {
    const { state, pawn, to } = createPawnDropMateState('sente');
    state.squares[0][3].piece = null;
    const simulated = simulateDropSquares(state.squares, pawn, to);

    expect(getLegalMoves(simulated, { row: 0, col: 4 }, 'gote')).toContainEqual({ row: 0, col: 3 });
    expect(validateDrop(state, pawn.id, to)).toEqual({ isValid: true });
    expect(getLegalDropSquares(state, pawn.id)).toContainEqual(to);
    expect(executeDrop(state, pawn.id, to).type).toBe('applied');
  });

  it('玉が打たれた歩を安全に取れる場合は歩打ちを許可する', () => {
    const { state, pawn, to } = createPawnDropMateState('sente');
    state.squares[2][4].piece = null;
    const simulated = simulateDropSquares(state.squares, pawn, to);

    expect(getLegalMoves(simulated, { row: 0, col: 4 }, 'gote')).toContainEqual(to);
    expect(validateDrop(state, pawn.id, to)).toEqual({ isValid: true });
  });

  it('玉以外の相手駒が打たれた歩を合法的に取れる場合は歩打ちを許可する', () => {
    const { state, pawn, to } = createPawnDropMateState('sente');
    state.squares[0][3].piece = { id: 'gote-capturing-gold', type: 'gold', player: 'gote' };
    const simulated = simulateDropSquares(state.squares, pawn, to);

    expect(getLegalMoves(simulated, { row: 0, col: 3 }, 'gote')).toContainEqual(to);
    expect(validateDrop(state, pawn.id, to)).toEqual({ isValid: true });
  });

  it('歩打ちが王手でなければ相手の盤上合法手の有無にかかわらず打ち歩詰めにしない', () => {
    const { state, pawn } = createPawnDropMateState('sente');
    const to = { row: 4, col: 4 };
    const simulated = simulateDropSquares(state.squares, pawn, to);

    expect(isKingInCheck(simulated, 'gote')).toBe(false);
    expect(validateDrop(state, pawn.id, to)).toEqual({ isValid: true });
  });

  it('歩以外の駒を打って詰みの形になってもpawn_drop_mateにしない', () => {
    const { state, to } = createPawnDropMateState('sente');
    const lance: Piece = { id: 'sente-mating-lance', type: 'lance', player: 'sente' };
    state.senteHand = [lance];
    const simulated = simulateDropSquares(state.squares, lance, to);

    expect(isKingInCheck(simulated, 'gote')).toBe(true);
    expectNoLegalBoardMoveResponses(simulated, 'gote');
    expect(validateDrop(state, lance.id, to)).toEqual({ isValid: true });
  });

  it('盤上の歩を進めて詰ませる突き歩詰めは歩打ち判定の対象にしない', () => {
    const state = createDropState([], 'sente', [
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
      { row: 2, col: 4, piece: { id: 'moving-pawn', type: 'pawn', player: 'sente' } },
      { row: 3, col: 4, piece: { id: 'pawn-guard-rook', type: 'rook', player: 'sente' } },
      { row: 0, col: 3, piece: { id: 'gote-left-blocker', type: 'lance', player: 'gote' } },
      { row: 0, col: 5, piece: { id: 'gote-right-blocker', type: 'lance', player: 'gote' } },
      { row: 1, col: 3, piece: { id: 'gote-left-front-blocker', type: 'pawn', player: 'gote' } },
      { row: 1, col: 5, piece: { id: 'gote-right-front-blocker', type: 'pawn', player: 'gote' } },
    ]);
    const result = executeMove(state, { row: 2, col: 4 }, { row: 1, col: 4 }, {
      promotion: 'decline',
    });

    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(isKingInCheck(result.state.squares, 'gote')).toBe(true);
    expectNoLegalBoardMoveResponses(result.state.squares, 'gote');
  });

  it('二歩にも打ち歩詰めにもなる入力では先にnifuを返す', () => {
    const { state, pawn, to } = createPawnDropMateState('sente');
    state.squares[2][4].piece = { id: 'sente-nifu-guard', type: 'pawn', player: 'sente' };

    expect(validateDrop(state, pawn.id, to)).toMatchObject({ isValid: false, reason: 'nifu' });
  });

  it('自玉の王手を放置する歩打ちは打ち歩詰めより先にself_check_unresolvedを返す', () => {
    const { state, pawn, to } = createPawnDropMateState('sente');
    state.squares[8][4].piece = null;
    state.squares[8][8].piece = { ...senteKing };
    state.squares[3][8].piece = { id: 'gote-checking-rook', type: 'rook', player: 'gote' };

    expect(isKingInCheck(state.squares, 'sente')).toBe(true);
    expect(validateDrop(state, pawn.id, to)).toMatchObject({
      isValid: false,
      reason: 'self_check_unresolved',
    });
  });

  it('ピンされた相手駒による見かけ上の歩取りを合法な応手として数えない', () => {
    const { state, pawn, to } = createPawnDropMateState('sente');
    state.squares[0][3].piece = { id: 'pinned-gote-gold', type: 'gold', player: 'gote' };
    state.squares[0][0].piece = { id: 'pinning-sente-rook', type: 'rook', player: 'sente' };
    const simulated = simulateDropSquares(state.squares, pawn, to);

    expect(getLegalMoves(simulated, { row: 0, col: 3 }, 'gote')).not.toContainEqual(to);
    expectNoLegalBoardMoveResponses(simulated, 'gote');
    expect(validateDrop(state, pawn.id, to)).toMatchObject({ reason: 'pawn_drop_mate' });
  });

  it('打ち歩詰めマスを候補から除外し、判定中も元のstate・盤面・持ち駒を変更しない', () => {
    const { state, pawn, to } = createPawnDropMateState('sente');
    const snapshot = JSON.stringify(state);
    const originalSquares = state.squares;
    const originalHand = state.senteHand;
    const originalHandPiece = state.senteHand[0];
    const originalBoardPiece = state.squares[2][4].piece;

    expect(getLegalDropSquares(state, pawn.id)).not.toContainEqual(to);
    expect(validateDrop(state, pawn.id, to)).toMatchObject({ reason: 'pawn_drop_mate' });
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(state.squares).toBe(originalSquares);
    expect(state.senteHand).toBe(originalHand);
    expect(state.senteHand[0]).toBe(originalHandPiece);
    expect(state.squares[2][4].piece).toBe(originalBoardPiece);
  });

  it.each([
    ['飛車', { row: 0, col: 4, piece: { id: 'checking-rook', type: 'rook', player: 'gote' } as Piece }, { row: 4, col: 4 }],
    ['角', { row: 4, col: 0, piece: { id: 'checking-bishop', type: 'bishop', player: 'gote' } as Piece }, { row: 6, col: 2 }],
    ['香', { row: 4, col: 4, piece: { id: 'checking-lance', type: 'lance', player: 'gote' } as Piece }, { row: 6, col: 4 }],
  ] as const)('%sの直線王手へ合駒でき、無関係な駒打ちは拒否する', (_label, checker, block) => {
    const gold: Piece = { id: 'blocking-gold', type: 'gold', player: 'sente' };
    const state = createDropState([gold], 'sente', [
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 8, piece: goteKing },
      checker,
    ]);
    expect(isKingInCheck(state.squares, 'sente')).toBe(true);
    expect(getLegalDropSquares(state, gold.id)).toContainEqual(block);
    expect(validateDrop(state, gold.id, { row: 4, col: 7 })).toMatchObject({ reason: 'self_check_unresolved' });
    const result = executeDrop(state, gold.id, block);
    expect(result.type).toBe('applied');
    if (result.type === 'applied') expect(isKingInCheck(result.state.squares, 'sente')).toBe(false);
  });

  it('候補生成と実行は同じ局面で整合し、終局・相手ID・不存在IDは空候補になる', () => {
    const gold: Piece = { id: 'gold', type: 'gold', player: 'sente' };
    const state = createDropState([gold]);
    for (const to of getLegalDropSquares(state, gold.id)) {
      expect(executeDrop(state, gold.id, to).type).toBe('applied');
    }
    expect(executeDrop(state, gold.id, { row: -1, col: 0 }).type).toBe('rejected');
    const opponent: Piece = { id: 'g-gold', type: 'gold', player: 'gote' };
    const mixed = { ...state, goteHand: [opponent] };
    expect(getLegalDropSquares(mixed, opponent.id)).toEqual([]);
    expect(getLegalDropSquares(mixed, 'missing')).toEqual([]);
    expect(getLegalDropSquares({ ...mixed, status: 'ended' }, gold.id)).toEqual([]);
  });

  it('assist方式は同じstate参照で拒否し、何も変更しない', () => {
    const pawn: Piece = { id: 'pawn', type: 'pawn', player: 'sente' };
    const state = createDropState([pawn], 'sente', [
      { row: 5, col: 4, piece: { id: 'board-pawn', type: 'pawn', player: 'sente' } },
    ]);
    const result = executeDrop(state, pawn.id, { row: 4, col: 4 }, { mode: 'assist' });
    expect(result).toMatchObject({ type: 'rejected', state, reason: 'nifu' });
    expect(result.state).toBe(state);
    expect(state.status).toBe('active');
    expect(state.foulHistory).toEqual([]);
  });

  it('assist方式は打ち歩詰めを同じstate参照で拒否し全内容を維持する', () => {
    const { state, pawn, to } = createPawnDropMateState('sente');
    const snapshot = JSON.stringify(state);
    const result = executeDrop(state, pawn.id, to, { mode: 'assist' });

    expect(result).toMatchObject({ type: 'rejected', reason: 'pawn_drop_mate' });
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('strict方式は駒打ち反則履歴だけを追加して正しい反則負けにする', () => {
    const pawn: Piece = { id: 'pawn', type: 'pawn', player: 'sente' };
    const state = createDropState([pawn], 'sente', [
      { row: 5, col: 4, piece: { id: 'board-pawn', type: 'pawn', player: 'sente' } },
    ]);
    const result = executeDrop(state, pawn.id, { row: 4, col: 4 }, {
      proposer: 'shogi_engine',
      engineName: 'DropEngine',
    });
    expect(result.type).toBe('foul_loss');
    if (result.type !== 'foul_loss') return;
    expect(result.result).toMatchObject({ winner: 'gote', loser: 'sente', foulReason: 'nifu' });
    expect(result.foul).toMatchObject({
      kind: 'drop',
      from: null,
      to: { row: 4, col: 4 },
      pieceId: pawn.id,
      pieceType: 'pawn',
      proposer: 'shogi_engine',
      engineName: 'DropEngine',
    });
    expect(result.state.squares).toBe(state.squares);
    expect(result.state.senteHand).toBe(state.senteHand);
    expect(result.state.turn).toBe(state.turn);
    expect(result.state.moveNumber).toBe(state.moveNumber);
    expect(result.state.history).toBe(state.history);
    expect(result.state.lastMove).toBe(state.lastMove);
  });

  it('strict方式は打ち歩詰めを詳細記録して提案者側の反則負けにする', () => {
    const { state, pawn, to } = createPawnDropMateState('sente');
    const result = executeDrop(state, pawn.id, to, {
      mode: 'strict',
      proposer: 'shogi_engine',
      engineName: 'PawnMateEngine',
    });

    expect(result.type).toBe('foul_loss');
    if (result.type !== 'foul_loss') return;
    expect(result.result).toMatchObject({
      winner: 'gote',
      loser: 'sente',
      foulReason: 'pawn_drop_mate',
    });
    expect(result.foul).toMatchObject({
      kind: 'drop',
      from: null,
      to,
      pieceId: pawn.id,
      pieceType: 'pawn',
      reason: 'pawn_drop_mate',
      proposer: 'shogi_engine',
      engineName: 'PawnMateEngine',
    });
    expect(result.state.squares).toBe(state.squares);
    expect(result.state.senteHand).toBe(state.senteHand);
    expect(result.state.goteHand).toBe(state.goteHand);
    expect(result.state.turn).toBe(state.turn);
    expect(result.state.moveNumber).toBe(state.moveNumber);
    expect(result.state.history).toBe(state.history);
    expect(result.state.lastMove).toBe(state.lastMove);
    expect(result.state.status).toBe('ended');
    expect(result.state.foulHistory).toEqual([result.foul]);
  });

  it('strict方式で不存在IDはpieceType:null、相手IDは実在駒種を記録する', () => {
    const state = createDropState([]);
    state.goteHand = [{ id: 'g-rook', type: 'rook', player: 'gote' }];
    const missing = executeDrop(state, 'missing', { row: 4, col: 4 }, { proposer: 'local_ai' });
    const opponent = executeDrop(state, 'g-rook', { row: 4, col: 4 }, { proposer: 'local_ai' });
    expect(missing.type).toBe('foul_loss');
    expect(opponent.type).toBe('foul_loss');
    if (missing.type === 'foul_loss') expect(missing.foul.pieceType).toBeNull();
    if (opponent.type === 'foul_loss') expect(opponent.foul.pieceType).toBe('rook');
  });

  it('終局後はstrict提案でも反則履歴を増やさずgame_already_endedで拒否する', () => {
    const pawn: Piece = { id: 'pawn', type: 'pawn', player: 'sente' };
    const state = { ...createDropState([pawn]), status: 'ended' as const };
    const result = executeDrop(state, pawn.id, { row: 4, col: 4 }, { proposer: 'local_ai' });
    expect(result).toMatchObject({ type: 'rejected', reason: 'game_already_ended', state });
    expect(result.state).toBe(state);
    expect(result.state.foulHistory).toEqual([]);
  });
});

describe('駒打ちUI・アクセシビリティ', () => {
  function createUiState(): BoardState {
    return createDropState(
      [
        { id: 'ui-pawn-1', type: 'pawn', player: 'sente' },
        { id: 'ui-pawn-2', type: 'pawn', player: 'sente' },
        { id: 'ui-gold', type: 'gold', player: 'sente' },
      ],
      'sente',
      [
        { row: 8, col: 4, piece: senteKing },
        { row: 0, col: 4, piece: goteKing },
        { row: 5, col: 2, piece: { id: 'board-pawn', type: 'pawn', player: 'sente' } },
        { row: 6, col: 6, piece: { id: 'board-gold', type: 'gold', player: 'sente' } },
        { row: 4, col: 5, piece: { id: 'occupied-gote', type: 'silver', player: 'gote' } },
      ]
    );
  }

  it('現在の手番側だけ操作可能で、同種駒もID別ボタンになる', () => {
    const state = createUiState();
    state.goteHand = [{ id: 'ui-gote-rook', type: 'rook', player: 'gote' }];
    render(<ShogiResearchScreen initialState={state} />);
    const first = document.querySelector('[data-hand-piece-id="ui-pawn-1"]');
    const second = document.querySelector('[data-hand-piece-id="ui-pawn-2"]');
    const opponent = document.querySelector('[data-hand-piece-id="ui-gote-rook"]');
    expect(first).toBeEnabled();
    expect(second).toBeEnabled();
    expect(opponent).toBeDisabled();
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'true');
    expect(document.getElementById('piece-stand-gote')).toHaveAttribute('data-active', 'false');
  });

  it('クリックで選択・再クリックで解除・別IDへ切り替えできる', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createUiState()} />);
    const first = document.querySelector('[data-hand-piece-id="ui-pawn-1"]') as HTMLButtonElement;
    const second = document.querySelector('[data-hand-piece-id="ui-pawn-2"]') as HTMLButtonElement;
    await user.click(first);
    expect(first).toHaveAttribute('aria-pressed', 'true');
    await user.click(first);
    expect(first).toHaveAttribute('aria-pressed', 'false');
    await user.click(first);
    await user.click(second);
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'true');
  });

  it('合法な空きマスだけを駒打ち候補にし、ARIAで「打てる」と案内する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createUiState()} />);
    await user.click(document.querySelector('[data-hand-piece-id="ui-pawn-1"]') as HTMLElement);
    const legal = document.querySelector('[data-coordinate="5五"]');
    const nifu = document.querySelector('[data-coordinate="7五"]');
    const dead = document.querySelector('[data-coordinate="5一"]');
    const occupied = document.querySelector('[data-coordinate="4五"]');
    expect(legal).toHaveAttribute('data-candidate-kind', 'drop');
    expect(legal).toHaveAttribute('aria-label', expect.stringContaining('歩兵を打てる'));
    expect(legal).not.toHaveAttribute('aria-label', expect.stringContaining('相手の駒を取る'));
    expect(nifu).not.toHaveAttribute('data-candidate');
    expect(dead).not.toHaveAttribute('data-candidate');
    expect(occupied).not.toHaveAttribute('data-candidate');
  });

  it('打ち歩詰めマスを強調せず「歩兵を打てる」というARIA案内も付けない', async () => {
    const user = userEvent.setup();
    const { state, pawn } = createPawnDropMateState('sente');
    render(<ShogiResearchScreen initialState={state} />);

    await user.click(document.querySelector(`[data-hand-piece-id="${pawn.id}"]`) as HTMLElement);
    const target = document.querySelector('[data-coordinate="5二"]');
    expect(target).not.toHaveAttribute('data-candidate');
    expect(target).not.toHaveAttribute('data-candidate-kind');
    expect(target).not.toHaveAttribute('aria-label', expect.stringContaining('歩兵を打てる'));
  });

  it('玉が逃げられる類似局面では同じ歩打ちを候補とARIAに表示する', async () => {
    const user = userEvent.setup();
    const { state, pawn } = createPawnDropMateState('sente');
    state.squares[0][3].piece = null;
    render(<ShogiResearchScreen initialState={state} />);

    await user.click(document.querySelector(`[data-hand-piece-id="${pawn.id}"]`) as HTMLElement);
    const target = document.querySelector('[data-coordinate="5二"]');
    expect(target).toHaveAttribute('data-candidate', 'true');
    expect(target).toHaveAttribute('data-candidate-kind', 'drop');
    expect(target).toHaveAttribute('aria-label', expect.stringContaining('歩兵を打てる'));
  });

  it('候補選択で駒打ちし、持ち駒・手番・履歴・直前着手を更新して着手先へフォーカスする', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createUiState()} />);
    await user.click(document.querySelector('[data-hand-piece-id="ui-gold"]') as HTMLElement);
    const target = document.querySelector('[data-coordinate="5五"]') as HTMLElement;
    await user.click(target);
    expect(target.querySelector('[data-piece-id="ui-gold"]')).toBeInTheDocument();
    expect(target).toHaveAttribute('data-last-move', 'dest');
    expect(document.querySelector('[data-last-move="source"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-hand-piece-id="ui-gold"]')).not.toBeInTheDocument();
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-turn', 'gote');
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '1');
    expect(target).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('盤上選択と持ち駒選択を相互排他的に切り替える', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createUiState()} />);
    const handButton = document.querySelector('[data-hand-piece-id="ui-gold"]') as HTMLButtonElement;
    const boardGold = document.querySelector('[data-coordinate="3七"]') as HTMLElement;
    await user.click(handButton);
    expect(handButton).toHaveAttribute('aria-pressed', 'true');
    await user.click(boardGold);
    expect(handButton).toHaveAttribute('aria-pressed', 'false');
    expect(boardGold).toHaveAttribute('data-selected', 'true');
    await user.click(handButton);
    expect(boardGold).not.toHaveAttribute('data-selected');
    expect(handButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('Escapeで選択解除しフォーカスを保持する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createUiState()} />);
    const button = document.querySelector('[data-hand-piece-id="ui-gold"]') as HTMLButtonElement;
    await user.click(button);
    expect(button).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveFocus();
  });

  it('EnterとSpaceで持ち駒を選択・解除できる', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createUiState()} />);
    const button = document.querySelector('[data-hand-piece-id="ui-gold"]') as HTMLButtonElement;
    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('終局後は両方の駒台を操作不可にする', () => {
    const state = createUiState();
    state.goteHand = [{ id: 'ui-gote-rook', type: 'rook', player: 'gote' }];
    state.status = 'ended';
    render(<ShogiResearchScreen initialState={state} />);
    expect(document.querySelector('[data-hand-piece-id="ui-pawn-1"]')).toBeDisabled();
    expect(document.querySelector('[data-hand-piece-id="ui-gote-rook"]')).toBeDisabled();
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'false');
    expect(document.getElementById('piece-stand-gote')).toHaveAttribute('data-active', 'false');
  });
});
