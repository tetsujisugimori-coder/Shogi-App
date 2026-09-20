import assert from 'node:assert/strict';
import type { BoardState } from '../../src/types/shogi';
import { createComparisonSnapshot } from '../../src/domain/shogi/evaluationPresetComparison';
import { analyzeQuiescenceComparison, QUIESCENCE_COMPARISON_DEPTH, QUIESCENCE_COMPARISON_SETTINGS,
  type QuiescenceComparisonResult, type QuiescenceComparisonSetting } from '../../src/domain/shogi/quiescenceComparison';
import { analyzeTimeLimitedQuiescenceComparison, TIME_LIMITED_QUIESCENCE_COMPARISON_MAX_DEPTH,
  TIME_LIMITED_QUIESCENCE_COMPARISON_MILLISECONDS, type TimeLimitedQuiescenceComparisonResult } from '../../src/domain/shogi/timeLimitedQuiescenceComparison';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch, areLegalActionsEqual,
  type AlphaBetaSearchResult } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import type { SearchClock } from '../../src/domain/shogi/twoPlyMinimaxAi';
import { validateQuiescenceComparison } from '../../src/application/quiescenceComparisonValidation';
import { validateTimeLimitedQuiescenceComparison } from '../../src/application/timeLimitedQuiescenceComparisonValidation';
import { validateAndFormatPrincipalVariation } from '../../src/application/searchPrincipalVariation';
import { formatSenteEvaluation } from '../../src/components/shogi/searchEvaluationDisplay';
import { QUIESCENCE_BENCHMARK_POSITIONS, type BenchmarkPosition } from './quiescencePositions';

export type BenchmarkMode = 'fixed' | 'timed';
type Result = QuiescenceComparisonResult | TimeLimitedQuiescenceComparisonResult;
export type BenchmarkCase = {
  position: BenchmarkPosition;
  mode: BenchmarkMode;
} & ({ ok: true; state: BoardState; results: readonly Result[] } | { ok: false; error: string });
export interface BenchmarkDependencies {
  clock?: SearchClock;
  fixedSearch?: typeof analyzeAlphaBetaSearch;
  timedSearch?: typeof analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch;
}

export const settingName = (setting: QuiescenceComparisonSetting) => setting === null ? '静止探索なし' : `追加${setting}手`;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** One position/mode is atomic, as in the existing comparison API. Failure does
 * not publish partial measurements; the suite continues with the next case. */
export function runBenchmarkCase(position: BenchmarkPosition, mode: BenchmarkMode, dependencies: BenchmarkDependencies = {}): BenchmarkCase {
  const context = `position=${position.id} mode=${mode}`;
  let stage = 'setting=all (局面生成)';
  try {
    const input = position.create();
    const before = structuredClone(input);
    const state = createComparisonSnapshot(input);
    const run = <T>(snapshot: BoardState, setting: number | undefined, search: () => T): T => {
      stage = `setting=${setting ?? 'disabled'} (${setting === undefined ? '静止探索なし' : `追加${setting}手`})`;
      const snapshotBefore = structuredClone(snapshot);
      try {
        return search();
      } finally {
        assert.deepStrictEqual(snapshot, snapshotBefore, '探索スナップショットが変更されました');
      }
    };
    try {
      if (mode === 'fixed') {
        const results = analyzeQuiescenceComparison(state, QUIESCENCE_COMPARISON_DEPTH, dependencies.clock,
          (...args) => run(args[0], args[4]?.quiescence?.maxTacticalDepth,
            () => (dependencies.fixedSearch ?? analyzeAlphaBetaSearch)(...args)));
        stage = 'setting=all (結果検証; 個別settingは詳細参照)';
        validateQuiescenceComparison(state, QUIESCENCE_COMPARISON_DEPTH, results);
        return { position, mode, ok: true, state, results };
      }
      const results = analyzeTimeLimitedQuiescenceComparison(state, TIME_LIMITED_QUIESCENCE_COMPARISON_MAX_DEPTH,
        TIME_LIMITED_QUIESCENCE_COMPARISON_MILLISECONDS, dependencies.clock,
        (...args) => run(args[0], args[5]?.quiescence?.maxTacticalDepth,
          () => (dependencies.timedSearch ?? analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch)(...args)));
      stage = 'setting=all (結果検証; 個別settingは詳細参照)';
      validateTimeLimitedQuiescenceComparison(state, TIME_LIMITED_QUIESCENCE_COMPARISON_MAX_DEPTH,
        TIME_LIMITED_QUIESCENCE_COMPARISON_MILLISECONDS, results);
      return { position, mode, ok: true, state, results };
    } finally {
      // Includes board, hands, move records, side to move, repetition/replay history.
      assert.deepStrictEqual(input, before, '入力局面が変更されました');
    }
  } catch (error) {
    if (error instanceof Error && 'comparisonSetting' in error && typeof error.comparisonSetting === 'string') {
      stage = `setting=${error.comparisonSetting} (結果検証)`;
    }
    return { position, mode, ok: false, error: `${context} ${stage}: ${message(error)}` };
  }
}

export function runBenchmarkSuite(modes: readonly BenchmarkMode[], dependencies: BenchmarkDependencies = {},
  positions = QUIESCENCE_BENCHMARK_POSITIONS, onCase?: (entry: BenchmarkCase) => void): BenchmarkCase[] {
  assert.equal(new Set(positions.map(p => p.id)).size, positions.length, '局面IDが重複しています');
  const cases: BenchmarkCase[] = [];
  for (const mode of modes) for (const position of positions) {
    const entry = runBenchmarkCase(position, mode, dependencies);
    cases.push(entry);
    onCase?.(entry);
  }
  return cases;
}

function stats(result: AlphaBetaSearchResult) {
  return [result.visitedPositionCount, result.cutoffCount, result.skippedActionCount,
    result.quiescenceLeafCount, result.quiescenceVisitedPositionCount, result.quiescenceCutoffCount, result.quiescenceSkippedActionCount];
}
function totalStats(result: Result): number[] {
  return 'iterations' in result
    ? [result.totalVisitedPositionCount, result.totalCutoffCount, result.totalSkippedActionCount,
      result.totalQuiescenceLeafCount, result.totalQuiescenceVisitedPositionCount, result.totalQuiescenceCutoffCount, result.totalQuiescenceSkippedActionCount]
    : stats(result);
}
function formatStats(values: readonly number[]): string {
  return `通常[訪問=${values[0]}, cutoff=${values[1]}, skip=${values[2]}] 静止[開始葉=${values[3]}, 訪問=${values[4]}, cutoff=${values[5]}, skip=${values[6]}]`;
}

export function formatBenchmarkCase(entry: BenchmarkCase): string {
  const lines = [`\n## ${entry.mode} / ${entry.position.id} / ${entry.position.name}`, entry.position.observation];
  if (!entry.ok) return [...lines, `ERROR: ${entry.error}`].join('\n');
  for (const result of entry.results) {
    const pv = result.selectedAction === null ? [] : validateAndFormatPrincipalVariation(entry.state, result,
      Math.max(result.depth, result.principalVariation.length), true);
    if (!pv) throw new Error(`position=${entry.position.id} mode=${entry.mode} setting=${result.quiescenceMaxTacticalDepth ?? 'disabled'}: PV表示検証失敗`);
    lines.push(`- ${settingName(result.quiescenceMaxTacticalDepth)}: 推奨手=${pv[0] ?? '手なし'}; 先手評価=${formatSenteEvaluation(result.selectedEvaluation ?? result.evaluationBreakdown.total, entry.state.turn)}; PV=${pv.join(' ') || '手順なし'}; 参考時間=${result.elapsedMilliseconds.toFixed(1)}ms`);
    if ('completedDepth' in result) {
      lines.push(`  完了深さ=${result.completedDepth}/${result.requestedMaxDepth}; 時間切れ=${result.timedOut ? 'あり' : 'なし'}`,
        `  最深完了反復: ${formatStats(stats(result))}`, `  全完了反復合計: ${formatStats(totalStats(result))}`);
    } else lines.push(`  通常探索深さ=${result.depth}; ${formatStats(stats(result))}`);
  }
  return lines.join('\n');
}

export function summarizeBenchmark(cases: readonly BenchmarkCase[], mode: BenchmarkMode) {
  const entries = cases.filter(entry => entry.mode === mode);
  const success = entries.filter(entry => entry.ok);
  const different = (left: Result, right: Result) => left.selectedAction === null || right.selectedAction === null
    ? left.selectedAction !== right.selectedAction : !areLegalActionsEqual(left.selectedAction, right.selectedAction);
  return {
    mode, positionCount: entries.length, successCount: success.length, errorCount: entries.length - success.length,
    // Timeouts retain a valid deepest completed iteration; they are not errors.
    maxDepthUnreachedCount: success.filter(entry => entry.results.some(r => 'timedOut' in r && r.timedOut)).length,
    changedOne: success.filter(entry => different(entry.results[0], entry.results[1])).length,
    changedTwo: success.filter(entry => different(entry.results[0], entry.results[2])).length,
    settings: QUIESCENCE_COMPARISON_SETTINGS.map((setting, index) => ({
      setting,
      depths: success.map(entry => {
        const result = entry.results[index];
        return `${entry.position.id}:${result.depth}/${'requestedMaxDepth' in result ? result.requestedMaxDepth : QUIESCENCE_COMPARISON_DEPTH}`;
      }),
      deepest: success.reduce((sum, entry) => stats(entry.results[index]).map((value, i) => sum[i] + value), Array<number>(7).fill(0)),
      totals: success.reduce((sum, entry) => totalStats(entry.results[index]).map((value, i) => sum[i] + value), Array<number>(7).fill(0)),
    })),
  };
}

export function formatBenchmarkSummary(cases: readonly BenchmarkCase[], mode: BenchmarkMode): string {
  const summary = summarizeBenchmark(cases, mode);
  return [`\n## ${mode} 集計（成功した3設定一組だけを集計）`,
    `成功=${summary.successCount}/${summary.positionCount}局面; エラー・比較未完了=${summary.errorCount}局面; 最大深さ未到達=${summary.maxDepthUnreachedCount}局面（時間切れはエラーと別）`,
    `推奨手変更: なし→追加1手=${summary.changedOne}/${summary.successCount}局面; なし→追加2手=${summary.changedTwo}/${summary.successCount}局面`,
    ...summary.settings.flatMap(s => [`${settingName(s.setting)} 完了深さ: ${s.depths.join(', ') || '該当なし'}`,
      `  最深完了分の局面合計: ${formatStats(s.deepest)}`, `  全完了反復の局面合計: ${formatStats(s.totals)}`]),
    '数値は棋力や設定の優劣を直接示さない。時間は環境依存の参考値でCI合否条件にしない。'].join('\n');
}

export function parseBenchmarkModes(args: readonly string[]): BenchmarkMode[] {
  if (args.length === 0 || (args.length === 1 && args[0] === 'both')) return ['fixed', 'timed'];
  if (args.length === 1 && (args[0] === 'fixed' || args[0] === 'timed')) return [args[0]];
  throw new Error('Usage: npm run measure:quiescence-suite -- [fixed|timed|both]');
}
