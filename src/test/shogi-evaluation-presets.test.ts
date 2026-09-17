import { describe, expect, it } from 'vitest';
import {
  analyzeAlphaBetaSearch, analyzeIterativeDeepeningAlphaBetaSearch,
  analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch, analyzeTwoPlyMinimaxSearch,
  evaluateSearchPosition, evaluateSearchPositionBreakdown,
  resolveSearchEvaluationPreset, SEARCH_EVALUATION_PRESET_IDS,
  SEARCH_EVALUATION_PRESETS, type SearchEvaluationCoefficients,
} from '../domain/shogi';
import { createInitialBoardState, type BoardState } from '../types/shogi';

/** Material imbalance, exposed gote king, and an undefended attacked silver. */
function experimentalPosition(): BoardState {
  const state = createInitialBoardState();
  for (const row of state.squares) for (const square of row) square.piece = null;
  state.squares[8][4].piece = { id: 'sk', type: 'king', player: 'sente' };
  state.squares[0][4].piece = { id: 'gk', type: 'king', player: 'gote' };
  state.squares[4][4].piece = { id: 'sr', type: 'rook', player: 'sente' };
  state.squares[4][5].piece = { id: 'gs', type: 'silver', player: 'gote' };
  return state;
}

const terms = ['material', 'pieceSquare', 'kingSafety', 'undefendedPieceSafety'] as const;

describe('評価プリセットと係数', () => {
  it('3プリセットを単一定義から解決し、structured cloneで値を維持する', () => {
    expect(SEARCH_EVALUATION_PRESET_IDS).toEqual(['standard', 'material-focused', 'king-safety-focused']);
    for (const id of SEARCH_EVALUATION_PRESET_IDS) {
      expect(resolveSearchEvaluationPreset(id).coefficients).toBe(SEARCH_EVALUATION_PRESETS[id]);
      expect(structuredClone(resolveSearchEvaluationPreset(id))).toEqual(resolveSearchEvaluationPreset(id));
    }
    expect(resolveSearchEvaluationPreset()).toEqual(resolveSearchEvaluationPreset('standard'));
  });

  it.each(['sente', 'gote'] as const)('標準の数値と内訳が省略時と完全一致する: %s', (perspective) => {
    for (const state of [createInitialBoardState(), experimentalPosition()]) {
      const snapshot = structuredClone(state);
      const standard = resolveSearchEvaluationPreset('standard');
      expect(evaluateSearchPositionBreakdown(state, perspective, standard)).toEqual(evaluateSearchPositionBreakdown(state, perspective));
      expect(evaluateSearchPosition(state, perspective, standard)).toBe(evaluateSearchPosition(state, perspective));
      expect(state).toEqual(snapshot);
    }
  });

  it('標準は選択手・PV・同点順・全探索統計を変えない', () => {
    const state = createInitialBoardState();
    const standard = resolveSearchEvaluationPreset('standard');
    const clock = () => 0;
    expect(analyzeAlphaBetaSearch(state, 3, standard, clock)).toEqual(analyzeAlphaBetaSearch(state, 3, undefined, clock));
    expect(analyzeTwoPlyMinimaxSearch(state, standard, clock)).toEqual(analyzeTwoPlyMinimaxSearch(state, undefined, clock));
    expect(analyzeIterativeDeepeningAlphaBetaSearch(state, 2, standard, clock)).toEqual(analyzeIterativeDeepeningAlphaBetaSearch(state, 2, undefined, clock));
    expect(analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 3, 1000, standard, clock))
      .toEqual(analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 3, 1000, undefined, clock));
  });

  it.each(terms)('0と小数の係数は対応する項目だけへ適用する: %s', (term) => {
    const state = experimentalPosition();
    const base = evaluateSearchPositionBreakdown(state, 'sente');
    expect(base[term]).not.toBe(0);
    for (const factor of [0, 0.5, 1.25, 2]) {
      const config = { coefficients: { ...SEARCH_EVALUATION_PRESETS.standard, [term]: factor } };
      const snapshot = structuredClone(config);
      const result = evaluateSearchPositionBreakdown(state, 'sente', config);
      for (const key of terms) expect(result[key]).toBe(base[key] * (key === term ? factor : 1));
      expect(result.total).toBe(terms.reduce((sum, key) => sum + result[key], 0));
      expect(evaluateSearchPosition(state, 'sente', config)).toBe(result.total);
      expect(config).toEqual(snapshot);
    }
  });

  it.each(terms)('不正係数を公開APIに混入させない: %s', (term) => {
    for (const value of [NaN, Infinity, -Infinity, -1, null, '1', undefined]) {
      const coefficients = { ...SEARCH_EVALUATION_PRESETS.standard, [term]: value } as SearchEvaluationCoefficients;
      expect(() => evaluateSearchPosition(experimentalPosition(), 'sente', { coefficients })).toThrow(/coefficients/);
      expect(() => analyzeAlphaBetaSearch(experimentalPosition(), 0, { coefficients })).toThrow(/coefficients/);
    }
  });

  it.each(SEARCH_EVALUATION_PRESET_IDS)('終局の勝ち・負け・引き分けへ係数を適用しない: %s', (id) => {
    const state = createInitialBoardState();
    for (const config of [resolveSearchEvaluationPreset(id), { coefficients: { material: 0, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0 } }]) {
      for (const [winner, loser, terminal, total] of [
        ['sente', 'gote', 'win', Infinity], ['gote', 'sente', 'loss', -Infinity], [null, null, 'draw', 0],
      ] as const) {
        const ended: BoardState = { ...state, status: 'ended', result: winner === null
          ? { winner: null, loser: null, endReason: 'repetition' }
          : { winner, loser, endReason: 'resignation' } };
        expect(evaluateSearchPositionBreakdown(ended, 'sente', config)).toEqual({
          total, terminal, material: 0, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0,
        });
      }
    }
  });

  it('駒得差と玉周辺の危険がある局面で意図した寄与が変化する', () => {
    const state = experimentalPosition();
    const base = evaluateSearchPositionBreakdown(state, 'sente');
    const material = evaluateSearchPositionBreakdown(state, 'sente', resolveSearchEvaluationPreset('material-focused'));
    const king = evaluateSearchPositionBreakdown(state, 'sente', resolveSearchEvaluationPreset('king-safety-focused'));
    expect(base.material).toBeGreaterThan(0);
    expect(base.kingSafety).toBeGreaterThan(0);
    expect(material.material).toBe(base.material * 1.25);
    expect(material.pieceSquare).toBe(base.pieceSquare * 0.5);
    expect(material.kingSafety).toBe(base.kingSafety * 0.5);
    expect(king.kingSafety).toBe(base.kingSafety * 2);
  });

  it.each(SEARCH_EVALUATION_PRESET_IDS)('先後の視点変換と4項目の合計を維持する: %s', (id) => {
    const state = experimentalPosition();
    const config = resolveSearchEvaluationPreset(id);
    const sente = evaluateSearchPositionBreakdown(state, 'sente', config);
    const gote = evaluateSearchPositionBreakdown(state, 'gote', config);
    for (const key of [...terms, 'total'] as const) expect(gote[key]).toBe(-sente[key]);
    expect(sente.total).toBe(terms.reduce((sum, key) => sum + sente[key], 0));
  });
});
