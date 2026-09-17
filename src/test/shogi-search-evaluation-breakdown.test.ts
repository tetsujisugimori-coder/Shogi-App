import { describe, expect, it } from 'vitest';
import {
  analyzeAlphaBetaSearch,
  analyzeTwoPlyMinimaxSearch,
  cloneBoardSquares,
  cloneBoardState,
  executeLegalAction,
  getLegalActions,
  evaluateKingSafety,
  evaluateMaterial,
  evaluatePieceSquarePosition,
  evaluateSearchPosition,
  evaluateSearchPositionBreakdown,
  evaluateUndefendedPieceSafety,
  type MaterialValueTable,
  type PieceSquareValueTable,
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

function grid(value = 0): number[][] {
  return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => value));
}

const ZERO_PIECE_SQUARE_VALUE_TABLE: PieceSquareValueTable = {
  unpromoted: {
    pawn: grid(), lance: grid(), knight: grid(), silver: grid(), gold: grid(), bishop: grid(), rook: grid(), king: grid(),
  },
  promoted: { pawn: grid(), lance: grid(), knight: grid(), silver: grid(), bishop: grid(), rook: grid() },
};

const VALUE_TABLE: MaterialValueTable = {
  unpromoted: { pawn: 10, lance: 20, knight: 30, silver: 40, gold: 50, bishop: 80, rook: 100, king: 0 },
  promoted: { pawn: 50, lance: 50, knight: 50, silver: 50, bishop: 100, rook: 120 },
};

describe('探索局面評価の内訳', () => {
  it.each(['sente', 'gote'] as const)('2手読みは採用手への最悪応手の既存内訳をそのまま返す: %s', (turn) => {
    const state = createState([
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 4, piece: piece('gote-king', 'king', 'gote') },
      { row: 4, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 4, col: 5, piece: piece('gote-silver', 'silver', 'gote') },
    ], { turn });
    const snapshot = structuredClone(state);
    const result = analyzeTwoPlyMinimaxSearch(state);
    expect(result.selectedAction).not.toBeNull();
    const after = executeLegalAction(cloneBoardState(state), result.selectedAction!);
    if (after.type !== 'applied') throw new Error('Selected action must be legal.');
    const leaves = after.state.status === 'ended' ? [after.state] : getLegalActions(after.state).map((reply) => {
      const execution = executeLegalAction(cloneBoardState(after.state), reply);
      if (execution.type !== 'applied') throw new Error('Reply must be legal.');
      return execution.state;
    });
    const evaluations = leaves.map((leaf) => evaluateSearchPositionBreakdown(leaf, turn));
    const worst = evaluations.reduce((a, b) => b.total < a.total ? b : a);
    expect(result.evaluationBreakdown).toEqual(worst);
    expect(result.selectedEvaluation).toBe(worst.total);
    expect(worst.total).toBe(worst.material + worst.pieceSquare + worst.kingSafety + worst.undefendedPieceSafety);
    expect(state).toEqual(snapshot);
  });

  it('非終局の4項目、合計、既存数値API、および視点反転を同じ評価経路で返す', () => {
    const state = createState([
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 4, piece: piece('gote-king', 'king', 'gote') },
      { row: 4, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 4, col: 5, piece: piece('gote-silver', 'silver', 'gote') },
    ]);
    const evaluation = {
      materialValueTable: VALUE_TABLE,
      pieceSquareValueTable: ZERO_PIECE_SQUARE_VALUE_TABLE,
      kingSafetyWeights: { kingSquareAttack: 7, uncoveredAdjacentAttack: 2 },
    };
    const stateSnapshot = JSON.stringify(state);
    const evaluationSnapshot = JSON.stringify(evaluation);

    const sente = evaluateSearchPositionBreakdown(state, 'sente', evaluation);
    const gote = evaluateSearchPositionBreakdown(state, 'gote', evaluation);

    expect(sente).toEqual({
      material: evaluateMaterial(state, 'sente', VALUE_TABLE),
      pieceSquare: evaluatePieceSquarePosition(state, 'sente', ZERO_PIECE_SQUARE_VALUE_TABLE),
      kingSafety: evaluateKingSafety(state, 'sente', evaluation.kingSafetyWeights),
      undefendedPieceSafety: evaluateUndefendedPieceSafety(state, 'sente', VALUE_TABLE),
      total: evaluateSearchPosition(state, 'sente', evaluation),
      terminal: null,
    });
    expect(sente.total).toBe(
      sente.material + sente.pieceSquare + sente.kingSafety + sente.undefendedPieceSafety
    );
    expect(gote.total).toBe(-sente.total);
    expect(gote.material).toBe(-sente.material);
    // The independent evaluator normalizes a neutral positional result to 0,
    // rather than preserving a representational -0 from sign inversion.
    expect(gote.pieceSquare).toBe(0);
    expect(gote.kingSafety).toBe(-sente.kingSafety);
    expect(gote.undefendedPieceSafety).toBe(-sente.undefendedPieceSafety);
    expect(gote.terminal).toBeNull();
    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(evaluation)).toBe(evaluationSnapshot);
  });

  it('旧駒価値表、空・部分設定、カスタム位置表、玉安全度重み0を保持する', () => {
    const state = createState([
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 4, piece: piece('gote-king', 'king', 'gote') },
      { row: 7, col: 3, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);
    const customPositionTable: PieceSquareValueTable = {
      ...ZERO_PIECE_SQUARE_VALUE_TABLE,
      unpromoted: { ...ZERO_PIECE_SQUARE_VALUE_TABLE.unpromoted, pawn: grid(3) },
    };

    expect(evaluateSearchPositionBreakdown(state, 'sente', VALUE_TABLE).material).toBe(
      evaluateMaterial(state, 'sente', VALUE_TABLE)
    );
    expect(evaluateSearchPositionBreakdown(state, 'sente', {}).total).toBe(
      evaluateSearchPosition(state, 'sente', {})
    );
    expect(evaluateSearchPositionBreakdown(state, 'sente', { materialValueTable: VALUE_TABLE }).total).toBe(
      evaluateSearchPosition(state, 'sente', { materialValueTable: VALUE_TABLE })
    );
    expect(evaluateSearchPositionBreakdown(state, 'sente', { pieceSquareValueTable: customPositionTable }).pieceSquare).toBe(-3);
    expect(evaluateSearchPositionBreakdown(state, 'sente', {
      materialValueTable: VALUE_TABLE,
      pieceSquareValueTable: ZERO_PIECE_SQUARE_VALUE_TABLE,
      kingSafetyWeights: { kingSquareAttack: 0, uncoveredAdjacentAttack: 0 },
    }).kingSafety).toBe(0);
  });

  it('終局は有限項目を0にして結果を優先し、不整合は既存どおり例外にする', () => {
    const base = createState([{ row: 4, col: 4, piece: piece('rook', 'rook', 'sente') }]);
    const win = { ...base, status: 'ended' as const, result: { winner: 'sente' as const, loser: 'gote' as const, endReason: 'checkmate' as const } };
    const loss = { ...win, result: { winner: 'gote' as const, loser: 'sente' as const, endReason: 'resignation' as const } };
    const draw = { ...win, result: { winner: null, loser: null, endReason: 'repetition' as const } };

    expect(evaluateSearchPositionBreakdown(win, 'sente')).toEqual({ total: Infinity, material: 0, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0, terminal: 'win' });
    expect(evaluateSearchPositionBreakdown(loss, 'sente')).toEqual({ total: -Infinity, material: 0, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0, terminal: 'loss' });
    expect(evaluateSearchPositionBreakdown(draw, 'sente')).toEqual({ total: 0, material: 0, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0, terminal: 'draw' });
    expect(() => evaluateSearchPositionBreakdown({ ...base, status: 'ended', result: null }, 'sente')).toThrow(/result/);
    expect(() => evaluateSearchPositionBreakdown({
      ...win,
      result: { winner: 'sente', loser: 'sente', endReason: 'checkmate' },
    }, 'sente')).toThrow(/opposite/);
    expect(() => evaluateSearchPositionBreakdown({
      ...base,
      result: { winner: 'sente', loser: 'gote', endReason: 'checkmate' },
    }, 'sente')).toThrow(/Non-ended/);
    expect(evaluateSearchPositionBreakdown(win, 'gote')).toEqual(expect.objectContaining({ terminal: 'loss', total: -Infinity }));
  });

  it('対称な初期局面を中立にし、深さ0のαβ評価も内訳の合計を使う', () => {
    const state = createInitialBoardState();
    const breakdown = evaluateSearchPositionBreakdown(state, 'sente');

    expect(breakdown).toEqual({
      total: 0, material: 0, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0, terminal: null,
    });
    expect(analyzeAlphaBetaSearch(state, 0).selectedEvaluation).toBe(breakdown.total);
  });
});
