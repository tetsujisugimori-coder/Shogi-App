import { describe, expect, it } from 'vitest';
import * as shogiDomain from '../domain/shogi';
import {
  DEFAULT_MATERIAL_VALUE_TABLE,
  cloneBoardSquares,
  evaluateMaterial,
  type MaterialValueTable,
} from '../domain/shogi';
import {
  createInitialBoardState,
  type BoardState,
  type Piece,
  type PieceType,
  type Player,
} from '../types/shogi';

function piece(id: string, type: PieceType, player: Player, isPromoted = false): Piece {
  return { id, type, player, ...(isPromoted ? { isPromoted: true } : {}) };
}

function createMaterialState(
  boardPieces: Array<{ row: number; col: number; piece: Piece }> = [],
  senteHand: Piece[] = [],
  goteHand: Piece[] = [],
  overrides: Partial<BoardState> = {}
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) for (const square of row) square.piece = null;
  for (const item of boardPieces) squares[item.row][item.col].piece = { ...item.piece };

  return {
    ...initial,
    squares,
    senteHand: senteHand.map((handPiece) => ({ ...handPiece })),
    goteHand: goteHand.map((handPiece) => ({ ...handPiece })),
    ...overrides,
  };
}

describe('駒得による局面評価', () => {
  it('平手初期局面は両視点で0であり、公開ドメインAPIからも利用できる', () => {
    const state = createInitialBoardState();

    expect(evaluateMaterial(state, 'sente')).toBe(0);
    expect(evaluateMaterial(state, 'gote')).toBe(0);
    expect(shogiDomain.evaluateMaterial).toBe(evaluateMaterial);
  });

  it('同じ入力では決定的で、盤面・持ち駒・履歴・評価表を変更しない', () => {
    const state = createMaterialState(
      [{ row: 4, col: 4, piece: piece('promoted-rook', 'rook', 'sente', true) }],
      [piece('sente-hand', 'pawn', 'sente')],
      [piece('gote-hand', 'silver', 'gote')]
    );
    const customTable: MaterialValueTable = {
      unpromoted: { pawn: 1, lance: 2, knight: 3, silver: 4, gold: 5, bishop: 6, rook: 7, king: 0 },
      promoted: { pawn: 8, lance: 9, knight: 10, silver: 11, bishop: 12, rook: 13 },
    };
    const stateSnapshot = JSON.stringify(state);
    const tableSnapshot = JSON.stringify(customTable);

    expect(evaluateMaterial(state, 'sente', customTable)).toBe(10);
    expect(evaluateMaterial(state, 'sente', customTable)).toBe(10);
    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(customTable)).toBe(tableSnapshot);
  });

  it('明示した視点で符号を反転し、手番には依存しない', () => {
    const state = createMaterialState([
      { row: 4, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 3, col: 4, piece: piece('gote-silver', 'silver', 'gote') },
    ]);
    const changedTurn = { ...state, turn: 'gote' as const };

    expect(evaluateMaterial(state, 'sente')).toBe(600);
    expect(evaluateMaterial(state, 'gote')).toBe(-600);
    expect(evaluateMaterial(changedTurn, 'sente')).toBe(600);
  });

  it.each([
    ['pawn', false, 100],
    ['lance', false, 300],
    ['knight', false, 300],
    ['silver', false, 400],
    ['gold', false, 500],
    ['bishop', false, 800],
    ['rook', false, 1000],
    ['king', false, 0],
    ['gold', true, 500],
    ['king', true, 0],
  ] as const)('盤上の未成%s（成り指定=%s）は%s点として評価する', (type, isPromoted, expected) => {
    const state = createMaterialState([
      { row: 4, col: 4, piece: piece('target', type, 'sente', isPromoted) },
    ]);

    expect(evaluateMaterial(state, 'sente')).toBe(expected);
    expect(evaluateMaterial(state, 'gote')).toBe(expected === 0 ? 0 : -expected);
  });

  it.each([
    ['pawn', 500],
    ['lance', 500],
    ['knight', 500],
    ['silver', 500],
    ['bishop', 1000],
    ['rook', 1200],
  ] as const)('盤上の成%sは対応する成駒価値%s点として評価する', (type, expected) => {
    const state = createMaterialState([
      { row: 4, col: 4, piece: piece('target', type, 'sente', true) },
    ]);

    expect(evaluateMaterial(state, 'sente')).toBe(expected);
  });

  it.each([
    ['pawn', 100],
    ['lance', 300],
    ['knight', 300],
    ['silver', 400],
    ['gold', 500],
    ['bishop', 800],
    ['rook', 1000],
  ] as const)('持ち駒%sは常に未成%s点として評価する', (type, expected) => {
    const state = createMaterialState([], [piece('hand-piece', type, 'sente', true)]);

    expect(evaluateMaterial(state, 'sente')).toBe(expected);
    expect(evaluateMaterial(state, 'gote')).toBe(-expected);
  });

  it('持ち駒の所有者・枚数を反映し、同じ未成駒を盤上へ打っても合計を変えない', () => {
    const handState = createMaterialState([], [
      piece('sente-pawn-a', 'pawn', 'sente'),
      piece('sente-pawn-b', 'pawn', 'sente'),
    ], [piece('gote-bishop', 'bishop', 'gote')]);
    const boardState = createMaterialState([
      { row: 4, col: 4, piece: piece('sente-pawn-a', 'pawn', 'sente') },
    ], [piece('sente-pawn-b', 'pawn', 'sente')], [piece('gote-bishop', 'bishop', 'gote')]);

    expect(evaluateMaterial(handState, 'sente')).toBe(-600);
    expect(evaluateMaterial(handState, 'gote')).toBe(600);
    expect(evaluateMaterial(boardState, 'sente')).toBe(evaluateMaterial(handState, 'sente'));
  });

  it('相手の歩を取って持ち駒にすると、駒得は200変化する', () => {
    const beforeCapture = createMaterialState([
      { row: 4, col: 4, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);
    const afterCapture = createMaterialState([], [piece('captured-pawn', 'pawn', 'sente')]);

    expect(evaluateMaterial(beforeCapture, 'sente')).toBe(-100);
    expect(evaluateMaterial(afterCapture, 'sente')).toBe(100);
    expect(evaluateMaterial(afterCapture, 'sente') - evaluateMaterial(beforeCapture, 'sente')).toBe(200);
  });

  it('成りは未成値との差分だけ評価を変え、成駒を取った持ち駒は未成値になる', () => {
    const unpromoted = createMaterialState([
      { row: 4, col: 4, piece: piece('pawn', 'pawn', 'sente') },
    ]);
    const promoted = createMaterialState([
      { row: 4, col: 4, piece: piece('pawn', 'pawn', 'sente', true) },
    ]);
    const capturedPromoted = createMaterialState([], [piece('captured-pawn', 'pawn', 'sente', true)]);

    expect(evaluateMaterial(promoted, 'sente') - evaluateMaterial(unpromoted, 'sente')).toBe(400);
    expect(evaluateMaterial(capturedPromoted, 'sente')).toBe(100);
  });

  it('終局結果・手番・手数・履歴情報を変えても、終局評価を混在させない', () => {
    const state = createMaterialState([
      { row: 4, col: 4, piece: piece('sente-bishop', 'bishop', 'sente') },
    ]);
    const unrelatedMove: BoardState['history'][number] = {
      kind: 'move', moveNumber: 42, player: 'gote', from: { row: 1, col: 1 }, to: { row: 2, col: 1 },
      pieceType: 'pawn', promotion: 'none', notation: '△8二歩', capturedPieceType: null,
    };
    const ended = {
      ...state,
      status: 'ended' as const,
      result: { winner: 'gote' as const, loser: 'sente' as const, endReason: 'resignation' as const },
      turn: 'gote' as const,
      moveNumber: 42,
      history: [unrelatedMove],
      lastMove: unrelatedMove,
      positionHistory: [{ key: 'unrelated', historyIndex: 1, movedBy: 'gote' as const, gaveCheck: true }],
    };

    expect(evaluateMaterial(ended, 'sente')).toBe(evaluateMaterial(state, 'sente'));
  });

  it('差し替えた評価表を使い、既定表を変えずに視点の符号反転を維持する', () => {
    const state = createMaterialState([
      { row: 4, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') },
      { row: 3, col: 4, piece: piece('gote-rook', 'rook', 'gote') },
    ]);
    const customTable: MaterialValueTable = {
      unpromoted: { pawn: 7, lance: 8, knight: 9, silver: 10, gold: 11, bishop: 12, rook: 23, king: 0 },
      promoted: { pawn: 13, lance: 14, knight: 15, silver: 16, bishop: 17, rook: 18 },
    };
    const defaultSnapshot = JSON.stringify(DEFAULT_MATERIAL_VALUE_TABLE);
    const customSnapshot = JSON.stringify(customTable);

    expect(evaluateMaterial(state, 'sente')).toBe(-900);
    expect(evaluateMaterial(state, 'sente', customTable)).toBe(-16);
    expect(evaluateMaterial(state, 'gote', customTable)).toBe(16);
    expect(JSON.stringify(DEFAULT_MATERIAL_VALUE_TABLE)).toBe(defaultSnapshot);
    expect(JSON.stringify(customTable)).toBe(customSnapshot);
  });
});
