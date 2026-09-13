import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIECE_SQUARE_VALUE_TABLE,
  cloneBoardSquares,
  evaluateMaterial,
  evaluatePieceSquarePosition,
  evaluateSearchPosition,
  type MaterialValueTable,
  type PieceSquareGrid,
  type PieceSquareValueTable,
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

function createState(
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

const zeroGrid: PieceSquareGrid = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0));

function tableWith(values: Array<{ type: PieceType; row: number; col: number; value: number; promoted?: boolean }>): PieceSquareValueTable {
  const cloneGrid = (): number[][] => zeroGrid.map((row) => [...row]);
  const unpromoted = {
    pawn: cloneGrid(), lance: cloneGrid(), knight: cloneGrid(), silver: cloneGrid(),
    gold: cloneGrid(), bishop: cloneGrid(), rook: cloneGrid(), king: cloneGrid(),
  };
  const promoted = {
    pawn: cloneGrid(), lance: cloneGrid(), knight: cloneGrid(), silver: cloneGrid(),
    bishop: cloneGrid(), rook: cloneGrid(),
  };
  for (const entry of values) {
    const target = entry.promoted && entry.type !== 'gold' && entry.type !== 'king'
      ? promoted[entry.type]
      : unpromoted[entry.type];
    target[entry.row][entry.col] = entry.value;
  }
  return { unpromoted, promoted };
}

function materialTableWithPawnValue(pawn: number): MaterialValueTable {
  return {
    unpromoted: { pawn, lance: 0, knight: 0, silver: 0, gold: 0, bishop: 0, rook: 0, king: 0 },
    promoted: { pawn: 0, lance: 0, knight: 0, silver: 0, bishop: 0, rook: 0 },
  };
}

function searchEvaluationFixture(): BoardState {
  return createState([{ row: 5, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') }]);
}

describe('駒の位置評価', () => {
  it('空のSearchEvaluationOptionsは両方の既定表を使い、入力局面を変更しない', () => {
    const state = searchEvaluationFixture();
    const options = {};
    const stateSnapshot = JSON.stringify(state);
    const optionsSnapshot = JSON.stringify(options);

    expect(evaluateMaterial(state, 'sente')).toBe(100);
    expect(evaluatePieceSquarePosition(state, 'sente')).toBe(2);
    expect(evaluateSearchPosition(state, 'sente', options)).toBe(102);
    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(options)).toBe(optionsSnapshot);
  });

  it('旧形式MaterialValueTableを直接渡すと、既定位置表と合成する', () => {
    const state = searchEvaluationFixture();
    const materialValueTable = materialTableWithPawnValue(13);
    const stateSnapshot = JSON.stringify(state);
    const tableSnapshot = JSON.stringify(materialValueTable);

    expect(evaluateMaterial(state, 'sente', materialValueTable)).toBe(13);
    expect(evaluatePieceSquarePosition(state, 'sente')).toBe(2);
    expect(evaluateSearchPosition(state, 'sente', materialValueTable)).toBe(15);
    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(materialValueTable)).toBe(tableSnapshot);
  });

  it('materialValueTableだけの設定は既定位置表で補完する', () => {
    const state = searchEvaluationFixture();
    const materialValueTable = materialTableWithPawnValue(17);
    const options = { materialValueTable };
    const stateSnapshot = JSON.stringify(state);
    const materialSnapshot = JSON.stringify(materialValueTable);
    const optionsSnapshot = JSON.stringify(options);

    expect(evaluateMaterial(state, 'sente', materialValueTable)).toBe(17);
    expect(evaluatePieceSquarePosition(state, 'sente')).toBe(2);
    expect(evaluateSearchPosition(state, 'sente', options)).toBe(19);
    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(materialValueTable)).toBe(materialSnapshot);
    expect(JSON.stringify(options)).toBe(optionsSnapshot);
  });

  it('pieceSquareValueTableだけの設定は既定駒価値表で補完する', () => {
    const state = searchEvaluationFixture();
    const pieceSquareValueTable = tableWith([{ type: 'pawn', row: 5, col: 4, value: 7 }]);
    const options = { pieceSquareValueTable };
    const stateSnapshot = JSON.stringify(state);
    const tableSnapshot = JSON.stringify(pieceSquareValueTable);
    const optionsSnapshot = JSON.stringify(options);

    expect(evaluateMaterial(state, 'sente')).toBe(100);
    expect(evaluatePieceSquarePosition(state, 'sente', pieceSquareValueTable)).toBe(7);
    expect(evaluateSearchPosition(state, 'sente', options)).toBe(107);
    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(pieceSquareValueTable)).toBe(tableSnapshot);
    expect(JSON.stringify(options)).toBe(optionsSnapshot);
  });

  it('同じ駒の位置差を評価し、明示した視点で符号を反転する', () => {
    const table = tableWith([{ type: 'pawn', row: 5, col: 4, value: 7 }]);
    const advanced = createState([{ row: 5, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') }]);
    const homeward = createState([{ row: 6, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') }]);

    expect(evaluatePieceSquarePosition(advanced, 'sente', table)).toBe(7);
    expect(evaluatePieceSquarePosition(homeward, 'sente', table)).toBe(0);
    expect(evaluatePieceSquarePosition(advanced, 'gote', table)).toBe(-7);
  });

  it('後手はrowとcolをともに180度反転し、対称局面の評価も対称にする', () => {
    const table = tableWith([{ type: 'silver', row: 2, col: 1, value: 11 }]);
    const sente = createState([{ row: 2, col: 1, piece: piece('sente-silver', 'silver', 'sente') }]);
    const gote = createState([{ row: 6, col: 7, piece: piece('gote-silver', 'silver', 'gote') }]);
    const wrongColumn = createState([{ row: 6, col: 1, piece: piece('gote-silver', 'silver', 'gote') }]);

    expect(evaluatePieceSquarePosition(sente, 'sente', table)).toBe(11);
    expect(evaluatePieceSquarePosition(gote, 'gote', table)).toBe(11);
    expect(evaluatePieceSquarePosition(gote, 'sente', table)).toBe(-11);
    expect(evaluatePieceSquarePosition(wrongColumn, 'gote', table)).toBe(0);
  });

  it('成駒は未成駒と別の表を使い、持ち駒へ位置点を付けない', () => {
    const table = tableWith([
      { type: 'pawn', row: 4, col: 4, value: 3 },
      { type: 'pawn', row: 4, col: 4, value: 9, promoted: true },
    ]);
    const unpromoted = createState([{ row: 4, col: 4, piece: piece('pawn', 'pawn', 'sente') }]);
    const promoted = createState([{ row: 4, col: 4, piece: piece('tokin', 'pawn', 'sente', true) }]);
    const inHand = createState([], [piece('hand-tokin', 'pawn', 'sente', true)]);

    expect(evaluatePieceSquarePosition(unpromoted, 'sente', table)).toBe(3);
    expect(evaluatePieceSquarePosition(promoted, 'sente', table)).toBe(9);
    expect(evaluatePieceSquarePosition(inHand, 'sente', table)).toBe(0);
  });

  it('入力局面と表を変更せず、複数回の評価で同じ値を返す', () => {
    const state = createState([{ row: 4, col: 4, piece: piece('rook', 'rook', 'sente') }]);
    const table = tableWith([{ type: 'rook', row: 4, col: 4, value: 4 }]);
    const stateSnapshot = JSON.stringify(state);
    const tableSnapshot = JSON.stringify(table);

    expect(evaluatePieceSquarePosition(state, 'sente', table)).toBe(4);
    expect(evaluatePieceSquarePosition(state, 'sente', table)).toBe(4);
    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(table)).toBe(tableSnapshot);
  });

  it('初期局面は先後対称で、既定表では両視点とも0となる', () => {
    const state = createInitialBoardState();
    expect(evaluatePieceSquarePosition(state, 'sente')).toBe(0);
    expect(evaluatePieceSquarePosition(state, 'gote')).toBe(0);
    expect(JSON.stringify(DEFAULT_PIECE_SQUARE_VALUE_TABLE)).toContain('pawn');
  });

  it('非終局の合成評価は駒得と位置点を加算し、小さな位置差で駒得を逆転させない', () => {
    const table = tableWith([{ type: 'pawn', row: 5, col: 4, value: 99 }]);
    const state = createState([
      { row: 5, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') },
      { row: 4, col: 4, piece: piece('gote-pawn', 'pawn', 'gote') },
      { row: 4, col: 0, piece: piece('sente-extra-pawn', 'pawn', 'sente') },
    ]);
    const options = { pieceSquareValueTable: table };

    expect(evaluateMaterial(state, 'sente')).toBe(100);
    expect(evaluatePieceSquarePosition(state, 'sente', table)).toBe(99);
    expect(evaluateSearchPosition(state, 'sente', options)).toBe(199);
    expect(evaluateSearchPosition(state, 'gote', options)).toBe(-199);
  });

  it('終局では位置点より既存のInfinity契約を優先する', () => {
    const ended = createState([{ row: 4, col: 4, piece: piece('pawn', 'pawn', 'sente') }], [], [], {
      status: 'ended',
      result: { winner: 'sente', loser: 'gote', endReason: 'checkmate' },
    });
    expect(evaluateSearchPosition(ended, 'sente')).toBe(Number.POSITIVE_INFINITY);
    expect(evaluateSearchPosition(ended, 'gote')).toBe(Number.NEGATIVE_INFINITY);
  });
});
