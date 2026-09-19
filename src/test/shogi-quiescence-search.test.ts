import { describe, expect, it, vi } from 'vitest';
import {
  analyzeAlphaBetaSearch,
  analyzeQuiescenceSearch,
  cloneBoardSquares,
  cloneBoardState,
  DEFAULT_MATERIAL_VALUE_TABLE,
  evaluateSearchPositionBreakdown,
  executeLegalAction,
  getLegalActions,
  isPlayerInCheck,
  type LegalAction,
  type SearchEvaluationConfig,
} from '../domain/shogi';
import * as staticExchangeApi from '../domain/shogi/staticExchangeEvaluation';
import { createInitialBoardState, type BoardState, type Piece, type PieceType, type Player } from '../types/shogi';

function piece(id: string, type: PieceType, player: Player): Piece {
  return { id, type, player };
}

function position(
  pieces: readonly { row: number; col: number; piece: Piece }[],
  turn: Player = 'sente',
  overrides: Partial<BoardState> = {}
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) for (const square of row) square.piece = null;
  for (const entry of pieces) squares[entry.row][entry.col].piece = { ...entry.piece };
  return { ...initial, squares, senteHand: [], goteHand: [], turn, ...overrides };
}

const KINGS = [
  { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
  { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
] as const;

const MATERIAL_ONLY: SearchEvaluationConfig = {
  materialValueTable: DEFAULT_MATERIAL_VALUE_TABLE,
  coefficients: { material: 1, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0 },
};

function captureTrap(): BoardState {
  return position([
    ...KINGS,
    { row: 5, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
    { row: 4, col: 4, piece: piece('gote-pawn', 'pawn', 'gote') },
    { row: 3, col: 4, piece: piece('gote-recapturing-pawn', 'pawn', 'gote') },
  ]);
}

function findAction(state: BoardState, predicate: (action: LegalAction) => boolean): LegalAction {
  const action = getLegalActions(state).find(predicate);
  if (!action) throw new Error('Fixture requires the named legal action.');
  return action;
}

function replay(state: BoardState, variation: readonly LegalAction[]): BoardState {
  return variation.reduce((current, action) => {
    const execution = executeLegalAction(cloneBoardState(current), action);
    if (execution.type !== 'applied') throw new Error('Quiescence PV must be replayable.');
    return execution.state;
  }, state);
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

describe('静止探索の純粋関数基盤', () => {
  it('深さ0では既存の静的評価・内訳を返し、着手を生成しない', () => {
    const state = captureTrap();
    const expected = evaluateSearchPositionBreakdown(state, 'sente', MATERIAL_ONLY);
    const result = analyzeQuiescenceSearch(state, 'sente', 0, MATERIAL_ONLY);
    expect(result).toMatchObject({ selectedEvaluation: expected.total, evaluationBreakdown: expected, principalVariation: [], visitedPositionCount: 0, cutoffCount: 0, skippedActionCount: 0 });
  });

  it('駒取りも王手もない静かな局面ではstand-patを維持する', () => {
    const state = position(KINGS);
    const result = analyzeQuiescenceSearch(state, 'sente', 3, MATERIAL_ONLY);
    expect(result.selectedEvaluation).toBe(evaluateSearchPositionBreakdown(state, 'sente', MATERIAL_ONLY).total);
    expect(result.principalVariation).toEqual([]);
    expect(result.visitedPositionCount).toBe(0);
  });

  it('取り返される損な駒取りしかないときはstand-patを選ぶ', () => {
    const state = captureTrap();
    const result = analyzeQuiescenceSearch(state, 'sente', 2, MATERIAL_ONLY);
    expect(result.selectedEvaluation).toBe(evaluateSearchPositionBreakdown(state, 'sente', MATERIAL_ONLY).total);
    expect(result.principalVariation).toEqual([]);
  });

  it('取り返されない明確な駒取りを採用する', () => {
    const state = position([
      ...KINGS,
      { row: 5, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 4, col: 4, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);
    const result = analyzeQuiescenceSearch(state, 'sente', 1, MATERIAL_ONLY);
    expect(result.selectedEvaluation).toBeGreaterThan(0);
    expect(result.principalVariation).toEqual([findAction(state, (action) => action.kind === 'move' && action.from.row === 5 && action.to.row === 4 && action.to.col === 4)]);
  });

  it('交換の取り返しまで読むと、浅い駒得ではなくその葉の評価・内訳を返す', () => {
    const state = captureTrap();
    const shallow = analyzeQuiescenceSearch(state, 'sente', 1, MATERIAL_ONLY);
    const deep = analyzeQuiescenceSearch(state, 'sente', 2, MATERIAL_ONLY);
    expect(shallow.selectedEvaluation).toBeGreaterThan(0);
    expect(deep.selectedEvaluation).toBe(evaluateSearchPositionBreakdown(state, 'sente', MATERIAL_ONLY).total);
    expect(deep.evaluationBreakdown.total).toBe(deep.selectedEvaluation);
  });

  it('固定した評価視点で先手番を最大化し、後手番を最小化する', () => {
    const maximizing = position([
      ...KINGS,
      { row: 5, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 4, col: 4, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);
    const minimizing = position([
      ...KINGS,
      { row: 3, col: 4, piece: piece('gote-rook', 'rook', 'gote') },
      { row: 4, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') },
    ], 'gote');
    expect(analyzeQuiescenceSearch(maximizing, 'sente', 1, MATERIAL_ONLY).selectedEvaluation).toBeGreaterThan(0);
    expect(analyzeQuiescenceSearch(minimizing, 'sente', 1, MATERIAL_ONLY).selectedEvaluation).toBeLessThan(0);
  });

  it('王手中はstand-patを使わず、玉移動・合駒・駒打ちを含む全合法回避を探索する', () => {
    const state = position([
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
      { row: 4, col: 4, piece: piece('gote-checking-rook', 'rook', 'gote') },
    ], 'sente', { senteHand: [piece('sente-hand-gold', 'gold', 'sente')] });
    const actions = getLegalActions(state);
    expect(isPlayerInCheck(state, 'sente')).toBe(true);
    expect(actions.some((action) => action.kind === 'drop')).toBe(true);
    expect(actions.some((action) => action.kind === 'move' && action.pieceType === 'king')).toBe(true);
    const result = analyzeQuiescenceSearch(state, 'sente', 1, MATERIAL_ONLY);
    expect(result.visitedPositionCount).toBe(actions.length);
    expect(result.principalVariation).toHaveLength(1);
    expect(actions).toContainEqual(result.principalVariation[0]);
  });

  it('終局局面は既存の終局評価を返し、追加着手を探索しない', () => {
    const state = position(KINGS, 'sente', { status: 'ended', result: { winner: 'sente', loser: 'gote', endReason: 'resignation' } });
    const result = analyzeQuiescenceSearch(state, 'sente', 3, MATERIAL_ONLY);
    expect(result).toMatchObject({ selectedEvaluation: Number.POSITIVE_INFINITY, principalVariation: [], visitedPositionCount: 0 });
    expect(result.evaluationBreakdown).toMatchObject({ total: Number.POSITIVE_INFINITY, terminal: 'win' });
  });

  it('主変化と再帰は最大戦術深さを超えない', () => {
    const state = captureTrap();
    for (const depth of [0, 1, 2]) {
      const result = analyzeQuiescenceSearch(state, 'sente', depth, MATERIAL_ONLY);
      expect(result.principalVariation.length).toBeLessThanOrEqual(depth);
      expect(evaluateSearchPositionBreakdown(replay(state, result.principalVariation), 'sente', MATERIAL_ONLY).total)
        .toBe(result.selectedEvaluation);
    }
  });

  it('stand-patと同値の駒取りは不要な主変化にしない', () => {
    const zeroPawnTable = {
      unpromoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.unpromoted, pawn: 0 },
      promoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.promoted, pawn: 0 },
    };
    const state = position([
      ...KINGS,
      { row: 5, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 4, col: 4, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);
    const result = analyzeQuiescenceSearch(state, 'sente', 1, { ...MATERIAL_ONLY, materialValueTable: zeroPawnTable });
    expect(result.principalVariation).toEqual([]);
  });

  it('αβカットオフでは未実行候補を数え、切った候補をPVに含めない', () => {
    const state = position([
      ...KINGS,
      { row: 5, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 4, col: 4, piece: piece('gote-pawn-a', 'pawn', 'gote') },
      { row: 5, col: 5, piece: piece('gote-pawn-b', 'pawn', 'gote') },
      { row: 3, col: 5, piece: piece('gote-rook', 'rook', 'gote') },
    ]);
    const result = analyzeQuiescenceSearch(state, 'sente', 2, MATERIAL_ONLY);
    expect(result).toMatchObject({ visitedPositionCount: 2, cutoffCount: 1, skippedActionCount: 1 });
    expect(result.principalVariation.length).toBeLessThanOrEqual(2);
  });

  it('凍結した入力・設定を変更せず、繰り返して同じ結果を返す', () => {
    const state = freezeDeep(captureTrap());
    const evaluation = freezeDeep(structuredClone(MATERIAL_ONLY));
    const first = analyzeQuiescenceSearch(state, 'sente', 2, evaluation);
    const second = analyzeQuiescenceSearch(state, 'sente', 2, evaluation);
    expect(second).toEqual(first);
  });

  it('中断確認の例外をそのまま伝播し、不完全なPVへ変換しない', () => {
    const interruption = new Error('stop quiescence');
    expect(() => analyzeQuiescenceSearch(captureTrap(), 'sente', 2, MATERIAL_ONLY, () => { throw interruption; })).toThrow(interruption);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])('不正な最大戦術深さ %p を拒否する', (depth) => {
    expect(() => analyzeQuiescenceSearch(position(KINGS), 'sente', depth, MATERIAL_ONLY)).toThrow(/non-negative integer/);
  });

  it('SEE準備・SEE評価を呼ばず、既存αβの代表結果も変えない', () => {
    const state = captureTrap();
    const before = analyzeAlphaBetaSearch(state, 2, MATERIAL_ONLY, () => 0);
    const prepare = vi.spyOn(staticExchangeApi, 'prepareStaticExchangeEvaluation');
    const evaluate = vi.spyOn(staticExchangeApi, 'evaluateStaticExchange');
    analyzeQuiescenceSearch(state, 'sente', 2, MATERIAL_ONLY);
    const after = analyzeAlphaBetaSearch(state, 2, MATERIAL_ONLY, () => 0);
    expect(prepare).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
    expect(after).toEqual(before);
  });
});
