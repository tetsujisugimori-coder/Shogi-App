import { describe, expect, it } from 'vitest';
import {
  cloneBoardSquares,
  countSquareAttackersBy,
  createAttackCountMaps,
  DEFAULT_KING_SAFETY_EVALUATION_WEIGHTS,
  evaluateKingSafety,
  getLegalMoves,
  isKingInCheck,
  simulateMoveSquares,
  validateMove,
  type KingSafetyEvaluationWeights,
} from '../domain/shogi';
import {
  createInitialBoardState,
  type BoardState,
  type Piece,
  type PieceType,
  type Player,
} from '../types/shogi';

function piece(id: string, type: PieceType, player: Player): Piece {
  return { id, type, player };
}

function createState(
  boardPieces: Array<{ row: number; col: number; piece: Piece }>,
  overrides: Partial<BoardState> = {}
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) for (const square of row) square.piece = null;
  for (const item of boardPieces) squares[item.row][item.col].piece = { ...item.piece };
  return { ...initial, squares, ...overrides };
}

const KINGS = [
  { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
  { row: 0, col: 4, piece: piece('gote-king', 'king', 'gote') },
] as const;

describe('玉安全度評価', () => {
  it('事前生成した利きマップを渡しても、単独生成時と同じ評価を返し入力を変更しない', () => {
    const state = createState([
      ...KINGS,
      { row: 7, col: 3, piece: piece('gote-pawn', 'pawn', 'gote') },
      { row: 7, col: 2, piece: piece('sente-bishop', 'bishop', 'sente') },
    ]);
    const stateSnapshot = JSON.stringify(state);
    const maps = createAttackCountMaps(state.squares);
    const mapsSnapshot = JSON.stringify(maps);

    expect(evaluateKingSafety(state, 'sente')).toBe(evaluateKingSafety(
      state,
      'sente',
      DEFAULT_KING_SAFETY_EVALUATION_WEIGHTS,
      maps
    ));
    expect(evaluateKingSafety(state, 'gote')).toBe(evaluateKingSafety(
      state,
      'gote',
      DEFAULT_KING_SAFETY_EVALUATION_WEIGHTS,
      maps
    ));
    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(maps)).toBe(mapsSnapshot);
  });

  it('初期局面は先後対称で、どちらの視点でも0を返す', () => {
    const state = createInitialBoardState();

    expect(evaluateKingSafety(state, 'sente')).toBe(0);
    expect(evaluateKingSafety(state, 'gote')).toBe(0);
  });

  it('玉周辺への敵の利きは、その玉側の評価を悪化させる', () => {
    const safe = createState([...KINGS]);
    const exposed = createState([
      ...KINGS,
      { row: 7, col: 3, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);

    expect(evaluateKingSafety(safe, 'sente')).toBe(0);
    expect(evaluateKingSafety(exposed, 'sente')).toBe(-1);
  });

  it('自玉以外の守り駒は、敵の利く隣接マスの危険度を減らす', () => {
    const exposed = createState([
      ...KINGS,
      { row: 7, col: 3, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);
    const defended = createState([
      ...KINGS,
      { row: 7, col: 3, piece: piece('gote-pawn', 'pawn', 'gote') },
      { row: 7, col: 2, piece: piece('sente-bishop', 'bishop', 'sente') },
    ]);

    expect(evaluateKingSafety(defended, 'sente')).toBeGreaterThan(evaluateKingSafety(exposed, 'sente'));
    expect(evaluateKingSafety(defended, 'sente')).toBe(0);
  });

  it('裸の玉自身の利きだけでは隣接マスの攻撃を相殺しない', () => {
    const exposed = createState([
      ...KINGS,
      { row: 7, col: 3, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);

    expect(evaluateKingSafety(exposed, 'sente')).toBe(-1);
    expect(evaluateKingSafety(exposed, 'gote')).toBe(1);
  });

  it('玉位置への敵の利きは味方の守りがあっても王手圧力として残る', () => {
    const checked = createState([
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 0, piece: piece('gote-king', 'king', 'gote') },
      { row: 6, col: 3, piece: piece('gote-knight', 'knight', 'gote') },
    ]);
    const friendlyDefense = createState([
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 0, piece: piece('gote-king', 'king', 'gote') },
      { row: 6, col: 3, piece: piece('gote-knight', 'knight', 'gote') },
      { row: 7, col: 3, piece: piece('sente-bishop', 'bishop', 'sente') },
    ]);

    expect(isKingInCheck(checked.squares, 'sente')).toBe(true);
    expect(evaluateKingSafety(checked, 'sente')).toBe(-10);
    expect(evaluateKingSafety(friendlyDefense, 'sente')).toBe(-10);
  });

  it('玉位置への同数の利きは隣接マスへの利きより重い', () => {
    const adjacentAttack = createState([
      ...KINGS,
      { row: 7, col: 3, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);
    const kingSquareAttack = createState([
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 0, piece: piece('gote-king', 'king', 'gote') },
      { row: 6, col: 3, piece: piece('gote-knight', 'knight', 'gote') },
    ]);

    expect(evaluateKingSafety(kingSquareAttack, 'sente')).toBeLessThan(
      evaluateKingSafety(adjacentAttack, 'sente')
    );
  });

  it('180度反転して先後を入れ替えた対称局面は対応する評価を返す', () => {
    const sentePosition = createState([
      ...KINGS,
      { row: 7, col: 3, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);
    const gotePosition = createState([
      { row: 0, col: 4, piece: piece('gote-king', 'king', 'gote') },
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 1, col: 5, piece: piece('sente-pawn', 'pawn', 'sente') },
    ]);

    expect(evaluateKingSafety(sentePosition, 'sente')).toBe(-1);
    expect(evaluateKingSafety(gotePosition, 'gote')).toBe(-1);
  });

  it('端と隅の玉は盤外を評価対象に含めずに評価できる', () => {
    const corner = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 0, piece: piece('gote-king', 'king', 'gote') },
      { row: 7, col: 7, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);

    expect(evaluateKingSafety(corner, 'sente')).toBe(-1);
  });

  it('ピンされた駒の生の利きもPR #84と同じ意味で反映する', () => {
    const pinnedGold = createState([
      { row: 0, col: 4, piece: piece('gote-rook', 'rook', 'gote') },
      { row: 5, col: 3, piece: piece('gote-king', 'king', 'gote') },
      // 金が斜めへ動くと、飛車から先手玉までの筋が開く。
      { row: 7, col: 4, piece: piece('pinned-sente-gold', 'gold', 'sente') },
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
    ], { turn: 'sente' });
    const pinnedGoldFrom = { row: 7, col: 4 };
    const goteKingNeighbor = { row: 6, col: 3 };
    const controlPawn = createState([
      { row: 0, col: 4, piece: piece('gote-rook', 'rook', 'gote') },
      { row: 5, col: 3, piece: piece('gote-king', 'king', 'gote') },
      { row: 7, col: 4, piece: piece('control-sente-pawn', 'pawn', 'sente') },
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
    ], { turn: 'sente' });

    expect(isKingInCheck(pinnedGold.squares, 'sente')).toBe(false);
    expect(validateMove(pinnedGold, pinnedGoldFrom, goteKingNeighbor)).toMatchObject({
      isValid: false,
      reason: 'self_check_unresolved',
    });
    expect(getLegalMoves(pinnedGold.squares, pinnedGoldFrom, 'sente')).not.toContainEqual(goteKingNeighbor);
    expect(isKingInCheck(simulateMoveSquares(pinnedGold.squares, pinnedGoldFrom, goteKingNeighbor), 'sente')).toBe(true);

    expect(countSquareAttackersBy(pinnedGold.squares, goteKingNeighbor, 'sente')).toBe(1);
    expect(countSquareAttackersBy(controlPawn.squares, goteKingNeighbor, 'sente')).toBe(0);
    expect(evaluateKingSafety(pinnedGold, 'sente')).toBe(
      evaluateKingSafety(controlPawn, 'sente') + 1
    );
  });

  it('どちらかの玉がない人工局面は終局と推測せず0を返す', () => {
    const missingKing = createState([
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 7, col: 3, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);

    expect(evaluateKingSafety(missingKing, 'sente')).toBe(0);
    expect(evaluateKingSafety(missingKing, 'gote')).toBe(0);
  });

  it('反復実行時に局面・重みを変更せず、視点を反転すると符号も反転する', () => {
    const state = createState([
      ...KINGS,
      { row: 7, col: 3, piece: piece('gote-pawn', 'pawn', 'gote') },
    ], { turn: 'gote' });
    const weights: KingSafetyEvaluationWeights = {
      kingSquareAttack: DEFAULT_KING_SAFETY_EVALUATION_WEIGHTS.kingSquareAttack,
      uncoveredAdjacentAttack: DEFAULT_KING_SAFETY_EVALUATION_WEIGHTS.uncoveredAdjacentAttack,
    };
    const stateSnapshot = JSON.stringify(state);
    const weightsSnapshot = JSON.stringify(weights);

    const sente = evaluateKingSafety(state, 'sente', weights);
    expect(evaluateKingSafety(state, 'sente', weights)).toBe(sente);
    expect(evaluateKingSafety(state, 'gote', weights)).toBe(-sente);
    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(weights)).toBe(weightsSnapshot);
  });
});
