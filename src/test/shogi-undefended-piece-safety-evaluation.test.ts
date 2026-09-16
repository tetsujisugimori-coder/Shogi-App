import { describe, expect, it } from 'vitest';
import {
  cloneBoardSquares,
  createAttackCountMaps,
  DEFAULT_MATERIAL_VALUE_TABLE,
  evaluateSearchPosition,
  evaluateUndefendedPieceSafety,
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

const ZERO_PIECE_SQUARE_VALUE_TABLE: PieceSquareValueTable = {
  unpromoted: {
    pawn: zeroGrid, lance: zeroGrid, knight: zeroGrid, silver: zeroGrid,
    gold: zeroGrid, bishop: zeroGrid, rook: zeroGrid, king: zeroGrid,
  },
  promoted: {
    pawn: zeroGrid, lance: zeroGrid, knight: zeroGrid, silver: zeroGrid,
    bishop: zeroGrid, rook: zeroGrid,
  },
};

const ATTACKED_SENTE_ROOK = [
  { row: 4, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
  { row: 2, col: 3, piece: piece('gote-knight', 'knight', 'gote') },
] as const;

describe('守られていない駒の危険度評価', () => {
  it('事前生成した利きマップを渡しても、単独生成時と同じ評価を返し入力を変更しない', () => {
    const state = createState([...ATTACKED_SENTE_ROOK]);
    const stateSnapshot = JSON.stringify(state);
    const maps = createAttackCountMaps(state.squares);
    const mapsSnapshot = JSON.stringify(maps);

    expect(evaluateUndefendedPieceSafety(state, 'sente')).toBe(evaluateUndefendedPieceSafety(
      state,
      'sente',
      DEFAULT_MATERIAL_VALUE_TABLE,
      maps
    ));
    expect(evaluateUndefendedPieceSafety(state, 'gote')).toBe(evaluateUndefendedPieceSafety(
      state,
      'gote',
      DEFAULT_MATERIAL_VALUE_TABLE,
      maps
    ));
    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(maps)).toBe(mapsSnapshot);
  });

  it('敵に攻撃され味方に守られていない盤上の駒は、所有側の評価を既存価値の10%だけ下げる', () => {
    const exposed = createState([...ATTACKED_SENTE_ROOK]);

    expect(evaluateUndefendedPieceSafety(exposed, 'sente')).toBe(-100);
    expect(evaluateUndefendedPieceSafety(exposed, 'gote')).toBe(100);
  });

  it('同じ駒が味方に守られると危険度減点を適用しない', () => {
    const defended = createState([
      ...ATTACKED_SENTE_ROOK,
      // Sente gold attacks the rook square but not the attacking knight.
      { row: 5, col: 3, piece: piece('sente-gold', 'gold', 'sente') },
    ]);

    expect(evaluateUndefendedPieceSafety(defended, 'sente')).toBe(0);
  });

  it('敵に攻撃されていない盤上の駒には危険度減点を適用しない', () => {
    const safe = createState([
      { row: 4, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
    ]);

    expect(evaluateUndefendedPieceSafety(safe, 'sente')).toBe(0);
  });

  it('先後を入れ替えた180度対称局面では、同じ視点の符号が反転する', () => {
    const senteExposed = createState([...ATTACKED_SENTE_ROOK]);
    const goteExposed = createState([
      { row: 4, col: 4, piece: piece('gote-rook', 'rook', 'gote') },
      { row: 6, col: 5, piece: piece('sente-knight', 'knight', 'sente') },
    ]);

    expect(evaluateUndefendedPieceSafety(senteExposed, 'sente')).toBe(-100);
    expect(evaluateUndefendedPieceSafety(goteExposed, 'sente')).toBe(100);
    expect(evaluateUndefendedPieceSafety(goteExposed, 'gote')).toBe(-100);
  });

  it('玉は、駒価値表で非ゼロにしても今回の危険度評価の対象外とする', () => {
    const nonStandardKingValueTable: MaterialValueTable = {
      unpromoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.unpromoted, king: 500 },
      promoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.promoted },
    };
    const checkedKing = createState([
      { row: 4, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 2, col: 3, piece: piece('gote-knight', 'knight', 'gote') },
    ]);

    expect(evaluateUndefendedPieceSafety(checkedKing, 'sente', nonStandardKingValueTable)).toBe(0);
  });

  it('持ち駒は盤上のマスを持たないため危険度評価の対象外とする', () => {
    const handsOnly = createState([], [piece('sente-hand-rook', 'rook', 'sente')], [
      piece('gote-hand-bishop', 'bishop', 'gote'),
    ]);

    expect(evaluateUndefendedPieceSafety(handsOnly, 'sente')).toBe(0);
  });

  it('低価値の歩より高価値の飛車への危険度減点を大きくする', () => {
    const exposedRook = createState([...ATTACKED_SENTE_ROOK]);
    const exposedPawn = createState([
      { row: 4, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') },
      { row: 2, col: 3, piece: piece('gote-knight', 'knight', 'gote') },
    ]);

    expect(evaluateUndefendedPieceSafety(exposedRook, 'sente')).toBe(-100);
    expect(evaluateUndefendedPieceSafety(exposedPawn, 'sente')).toBe(-10);
  });

  it('探索用の静的評価に駒得・位置評価と合成し、入力局面と評価表を変更しない', () => {
    const exposed = createState([...ATTACKED_SENTE_ROOK]);
    const options = { pieceSquareValueTable: ZERO_PIECE_SQUARE_VALUE_TABLE };
    const stateSnapshot = JSON.stringify(exposed);
    const optionsSnapshot = JSON.stringify(options);

    // Material is rook (1000) minus knight (300); the undefended rook warning is -100.
    expect(evaluateSearchPosition(exposed, 'sente', options)).toBe(600);
    expect(evaluateSearchPosition(exposed, 'gote', options)).toBe(-600);
    expect(JSON.stringify(exposed)).toBe(stateSnapshot);
    expect(JSON.stringify(options)).toBe(optionsSnapshot);
  });
});
