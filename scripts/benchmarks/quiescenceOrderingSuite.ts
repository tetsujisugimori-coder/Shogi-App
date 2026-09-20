import assert from 'node:assert/strict';
import type { BoardState } from '../../src/types/shogi';
import { createComparisonSnapshot } from '../../src/domain/shogi/evaluationPresetComparison';
import { executeLegalAction, getLegalActions } from '../../src/domain/shogi/legalActions';
import { cloneBoardState } from '../../src/domain/shogi/replay';
import { evaluateSearchPositionBreakdown } from '../../src/domain/shogi/twoPlyMinimaxAi';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch,
  type AlphaBetaSearchResult, type TimeLimitedIterativeDeepeningAlphaBetaSearchResult } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import { validateAndFormatPrincipalVariation } from '../../src/application/searchPrincipalVariation';
import { formatSenteEvaluation } from '../../src/components/shogi/searchEvaluationDisplay';
import { QUIESCENCE_BENCHMARK_POSITIONS, type BenchmarkPosition } from './quiescencePositions';
import type { BenchmarkDependencies, BenchmarkMode } from './quiescenceSuite';

export const ORDERING_SETTINGS = [
  { maxTacticalDepth: 1, moveOrdering: 'original' },
  { maxTacticalDepth: 1, moveOrdering: 'material' },
  { maxTacticalDepth: 2, moveOrdering: 'original' },
  { maxTacticalDepth: 2, moveOrdering: 'material' },
] as const;
export type Setting = typeof ORDERING_SETTINGS[number];
export type SearchResult = AlphaBetaSearchResult | TimeLimitedIterativeDeepeningAlphaBetaSearchResult;
export type OrderingResult = { setting: Setting; search: SearchResult; pv: string[] };
export type OrderingCase = { position: BenchmarkPosition; mode: BenchmarkMode } & (
  { ok: true; turn: BoardState['turn']; results: OrderingResult[] } | { ok: false; error: string }
);
export const statisticKeys = [
  ['visitedPositionCount', 'totalVisitedPositionCount'], ['cutoffCount', 'totalCutoffCount'],
  ['skippedActionCount', 'totalSkippedActionCount'], ['quiescenceLeafCount', 'totalQuiescenceLeafCount'],
  ['quiescenceVisitedPositionCount', 'totalQuiescenceVisitedPositionCount'],
  ['quiescenceCutoffCount', 'totalQuiescenceCutoffCount'], ['quiescenceSkippedActionCount', 'totalQuiescenceSkippedActionCount'],
] as const;
const counts = (r: SearchResult, total = false) => statisticKeys.map(([key, sum]) => total && 'iterations' in r ? r[sum] : r[key]);
const formatCounts = (v: number[]) => `通常[訪問=${v[0]}, cutoff=${v[1]}, skip=${v[2]}] 静止[開始葉=${v[3]}, 訪問=${v[4]}, cutoff=${v[5]}, skip=${v[6]}]`;

/** Validate outside measured search time. Replay EVERY completed PV and compare
 * the actual leaf's complete evaluation breakdown, not just the terminal flag. */
function validatePass(state: BoardState, result: AlphaBetaSearchResult, depth: number, extension: number): string[] {
  assert.equal(result.depth, depth, '探索深さ');
  assert.ok(Number.isFinite(result.elapsedMilliseconds) && result.elapsedMilliseconds >= 0, '参考時間');
  assert.ok(counts(result).every(v => Number.isSafeInteger(v) && v >= 0), '探索統計');
  assert.equal(result.rootLegalActionCount, getLegalActions(state).length, 'root合法手数');
  assert.ok(result.quiescenceLeafCount <= result.visitedPositionCount, '静止開始葉数');
  assert.ok(result.principalVariation.length <= depth + extension, 'PV上限');
  let leaf = cloneBoardState(state);
  let pv: string[] = [];
  if (result.selectedAction === null) {
    assert.equal(result.rootLegalActionCount, 0, '合法手があるのに手なし');
    assert.equal(result.selectedEvaluation, null);
    assert.equal(result.principalVariation.length, 0);
    assert.ok(counts(result).every(v => v === 0));
  } else {
    const formatted = validateAndFormatPrincipalVariation(state, result, Math.max(depth, result.principalVariation.length), true);
    assert.ok(formatted, '推奨手/PVが不正');
    pv = formatted;
    for (const action of result.principalVariation) {
      const execution = executeLegalAction(leaf, action);
      assert.equal(execution.type, 'applied', 'PV実行');
      if (execution.type === 'applied') leaf = execution.state;
    }
    assert.equal(result.selectedEvaluation, result.evaluationBreakdown.total, '評価値と内訳');
  }
  assert.deepStrictEqual(result.evaluationBreakdown, evaluateSearchPositionBreakdown(leaf, state.turn), 'PV末端の評価内訳');
  return pv;
}

export function validateOrderingResult(state: BoardState, result: SearchResult, mode: BenchmarkMode, extension: number): string[] {
  if (mode === 'fixed') return validatePass(state, result, 3, extension);
  assert.ok('iterations' in result, '完了反復なし');
  assert.equal(result.requestedMaxDepth, 4);
  assert.ok(Number.isSafeInteger(result.completedDepth) && result.completedDepth >= 1 && result.completedDepth <= 4);
  assert.equal(result.timedOut, result.completedDepth < 4);
  assert.equal(result.iterations.length, result.completedDepth);
  result.iterations.forEach((pass, i) => validatePass(state, pass, i + 1, extension));
  const deepest = result.iterations[result.completedDepth - 1];
  const { elapsedMilliseconds: _elapsed, ...selected } = result;
  for (const [key, value] of Object.entries(deepest)) {
    if (key !== 'elapsedMilliseconds') assert.deepStrictEqual(selected[key as keyof typeof selected], value, `最深完了反復:${key}`);
  }
  for (const [key, total] of statisticKeys) {
    assert.equal(result[total], result.iterations.reduce((sum, pass) => sum + pass[key], 0), `完了反復合計:${total}`);
  }
  return validatePass(state, result, result.completedDepth, extension);
}

/** Shared single API call for both CLIs. Each invocation owns a new frozen
 * snapshot; the timed API creates its own deadline. Capture before validation
 * so the repeated runner can retain even invalid returned results. */
export function runOrderingTrial(input: BoardState, mode: BenchmarkMode, setting: Setting,
  dependencies: BenchmarkDependencies = {}, capture?: (search: SearchResult) => void): OrderingResult {
  const before = structuredClone(input);
  const snapshot = createComparisonSnapshot(input);
  const snapshotBefore = structuredClone(snapshot);
  try {
    const options = { moveOrdering: 'standard', quiescence: { ...setting } } as const;
    const search = mode === 'fixed'
      ? (dependencies.fixedSearch ?? analyzeAlphaBetaSearch)(snapshot, 3, undefined, dependencies.clock, options)
      : (dependencies.timedSearch ?? analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch)(snapshot, 4, 1000, undefined, dependencies.clock, options);
    capture?.(search);
    return { setting, search, pv: validateOrderingResult(snapshot, search, mode, setting.maxTacticalDepth) };
  } finally {
    assert.deepStrictEqual(snapshot, snapshotBefore, '探索スナップショットが変更されました');
    assert.deepStrictEqual(input, before, '入力局面が変更されました');
  }
}

/** A four-setting case is atomic; failed cases retain context but no aggregates. */
export function runOrderingCase(position: BenchmarkPosition, mode: BenchmarkMode, dependencies: BenchmarkDependencies = {}): OrderingCase {
  let stage = '局面生成';
  try {
    const input = position.create();
    const before = structuredClone(input);
    const results: OrderingResult[] = [];
    try {
      for (const setting of ORDERING_SETTINGS) {
        stage = `追加${setting.maxTacticalDepth}手 ordering=${setting.moveOrdering}`;
        results.push(runOrderingTrial(input, mode, setting, dependencies));
      }
      if (mode === 'fixed') for (const i of [0, 2]) {
        stage = `追加${results[i].setting.maxTacticalDepth}手 original→material 評価一致`;
        assert.equal(results[i].search.selectedEvaluation, results[i + 1].search.selectedEvaluation, '固定深さ評価が一致しません');
      }
      return { position, mode, ok: true, turn: input.turn, results };
    } finally {
      assert.deepStrictEqual(input, before, '入力局面が変更されました');
    }
  } catch (error) {
    return { position, mode, ok: false, error: `position=${position.id} mode=${mode} ${stage}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function runOrderingSuite(modes: readonly BenchmarkMode[], dependencies: BenchmarkDependencies = {},
  positions = QUIESCENCE_BENCHMARK_POSITIONS, onCase?: (entry: OrderingCase) => void): OrderingCase[] {
  assert.equal(new Set(positions.map(p => p.id)).size, positions.length, '局面ID重複');
  const cases: OrderingCase[] = [];
  for (const mode of modes) for (const position of positions) {
    const entry = runOrderingCase(position, mode, dependencies);
    cases.push(entry);
    onCase?.(entry);
  }
  return cases;
}

const evaluation = (entry: OrderingResult, turn: BoardState['turn']) => formatSenteEvaluation(entry.search.selectedEvaluation ?? entry.search.evaluationBreakdown.total, turn);
export function formatOrderingCase(entry: OrderingCase): string {
  const lines = [`\n## ${entry.mode} / ${entry.position.id} / ${entry.position.name}`];
  if (!entry.ok) return [...lines, `ERROR: ${entry.error}`].join('\n');
  const turn = entry.turn;
  for (const r of entry.results) {
    const s = r.search;
    lines.push(`追加${r.setting.maxTacticalDepth}手 ${r.setting.moveOrdering}: 推奨手=${r.pv[0] ?? '手なし'}; 先手評価=${evaluation(r, turn)}; PV=${r.pv.join(' ') || '手順なし'}; 完了深さ=${s.depth}; 参考時間=${s.elapsedMilliseconds.toFixed(1)}ms`,
      `  最深完了: ${formatCounts(counts(s))}`);
    if ('iterations' in s) lines.push(`  採用反復=${s.completedDepth}/${s.requestedMaxDepth}; 完了反復=[${s.iterations.map(p => p.depth)}]; 時間切れ=${s.timedOut}; 全完了合計: ${formatCounts(counts(s, true))}`);
  }
  for (const i of [0, 2]) {
    const a = entry.results[i], b = entry.results[i + 1];
    lines.push(`追加${a.setting.maxTacticalDepth}手 original→material: 推奨手=${a.pv[0] ?? '手なし'}→${b.pv[0] ?? '手なし'}; 評価=${evaluation(a, turn)}→${evaluation(b, turn)}; 完了深さ=${a.search.depth}→${b.search.depth}; PV=${a.pv.join(' ') || '手順なし'} → ${b.pv.join(' ') || '手順なし'}`);
  }
  return lines.join('\n');
}

export function summarizeOrdering(cases: readonly OrderingCase[], mode: BenchmarkMode) {
  const entries = cases.filter(c => c.mode === mode);
  const success = entries.filter(c => c.ok);
  return { mode, success: success.length, errors: entries.length - success.length,
    settings: ORDERING_SETTINGS.map((setting, i) => ({ setting,
      depths: success.map(c => `${c.position.id}:${c.results[i].search.depth}`),
      elapsed: success.reduce((sum, c) => sum + c.results[i].search.elapsedMilliseconds, 0),
      deepest: success.reduce((sum, c) => counts(c.results[i].search).map((v, j) => sum[j] + v), Array<number>(7).fill(0)),
      totals: success.reduce((sum, c) => counts(c.results[i].search, true).map((v, j) => sum[j] + v), Array<number>(7).fill(0)),
    })),
  };
}
export function formatOrderingSummary(cases: readonly OrderingCase[], mode: BenchmarkMode): string {
  const s = summarizeOrdering(cases, mode);
  return [`\n## ${mode} 集計: 成功=${s.success}局面/${s.success * 4}設定; エラー=${s.errors}局面（4設定一組で集計）`,
    ...s.settings.flatMap(r => [`追加${r.setting.maxTacticalDepth}手 ${r.setting.moveOrdering}: 深さ=${r.depths.join(',')}; 参考時間合計=${r.elapsed.toFixed(1)}ms`,
      `  最深完了合計: ${formatCounts(r.deepest)}`, `  全完了合計: ${formatCounts(r.totals)}`]),
  ].join('\n');
}
