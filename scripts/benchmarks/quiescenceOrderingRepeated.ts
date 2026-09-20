import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import type { BoardState } from '../../src/types/shogi';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import { formatSenteEvaluation } from '../../src/components/shogi/searchEvaluationDisplay';
import { QUIESCENCE_BENCHMARK_POSITIONS, type BenchmarkPosition } from './quiescencePositions';
import { parseBenchmarkModes, type BenchmarkDependencies, type BenchmarkMode } from './quiescenceSuite';
import { runOrderingTrial, statisticKeys, type SearchResult, type Setting } from './quiescenceOrderingSuite';

export const WARMUP_COUNT = 3;
export const MEASUREMENT_COUNT = 8;
type Ordering = Setting['moveOrdering'];
type Phase = 'warmup' | 'measurement';
export interface RepeatedDependencies extends BenchmarkDependencies {
  /** Outer API timing, independent of the search's injected deadline clock. */
  measurementClock?: () => number;
}
export interface Trial {
  phase: Phase;
  trial: number;
  order: readonly Ordering[];
  orderIndex: number;
  ordering: Ordering;
  ok: boolean;
  search?: SearchResult;
  apiMilliseconds?: number;
  pv?: string[];
  error?: string;
}
export interface RepeatedCase {
  position: BenchmarkPosition;
  mode: BenchmarkMode;
  extension: 1 | 2;
  turn?: BoardState['turn'];
  ok: boolean;
  trials: Trial[];
  error?: string;
}

/** Zero-based position/depth indices balance the first setting across both
 * dimensions. Each phase restarts at trial 1; eight measurements give 4/4. */
export function trialOrder(positionIndex: number, extension: 1 | 2, trialIndex: number): readonly Ordering[] {
  return (positionIndex + extension - 1 + trialIndex) % 2 === 0
    ? ['original', 'material'] : ['material', 'original'];
}

export function parseRepeatedModes(args: readonly string[]): BenchmarkMode[] {
  try { return parseBenchmarkModes(args); }
  catch { throw new Error('Usage: npm run measure:quiescence-ordering-repeated -- [fixed|timed|both]'); }
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
// JSON has no non-finite numbers: preserve these explicitly instead of null.
export const rawJson = (value: unknown) => JSON.stringify(value, (_key, item: unknown) =>
  typeof item === 'number' && !Number.isFinite(item) ? String(item) : item);

function deterministicResult(search: SearchResult) {
  const { elapsedMilliseconds: _elapsed, ...result } = search;
  return result;
}

/** Atomic unit = position / fixed-or-timed / tactical depth. Stop a failed
 * unit, retain all attempted calls, and continue other independent units. */
export function runRepeatedCase(position: BenchmarkPosition, positionIndex: number, mode: BenchmarkMode,
  extension: 1 | 2, dependencies: RepeatedDependencies = {},
  onTrial?: (entry: RepeatedCase, trial: Trial) => void): RepeatedCase {
  const entry: RepeatedCase = { position, mode, extension, ok: false, trials: [] };
  const context = `position=${position.id} mode=${mode} extension=${extension}`;
  let stage = 'phase=setup trial=0 ordering=none';
  try {
    const input = position.create();
    entry.turn = input.turn;
    const baselines = new Map<Ordering, SearchResult>();
    for (const phase of ['warmup', 'measurement'] as const) {
      const repetitions = phase === 'warmup' ? WARMUP_COUNT : MEASUREMENT_COUNT;
      for (let i = 0; i < repetitions; i++) {
        const order = trialOrder(positionIndex, extension, i);
        const pair = new Map<Ordering, SearchResult>();
        for (const [orderIndex, ordering] of order.entries()) {
          stage = `phase=${phase} trial=${i + 1} ordering=${ordering}`;
          const trial: Trial = { phase, trial: i + 1, order, orderIndex, ordering, ok: false };
          entry.trials.push(trial);
          try {
            const apiClock = dependencies.measurementClock ?? (() => performance.now());
            // Timing wraps only the search function. Snapshot/validation and
            // output are outside it, including validation of warmup results.
            const timedCall = <T>(call: () => T): T => {
              const start = apiClock();
              try { return call(); }
              finally { trial.apiMilliseconds = apiClock() - start; }
            };
            const result = runOrderingTrial(input, mode, { maxTacticalDepth: extension, moveOrdering: ordering }, {
              ...dependencies,
              fixedSearch: (...args) => timedCall(() => (dependencies.fixedSearch ?? analyzeAlphaBetaSearch)(...args)),
              timedSearch: (...args) => timedCall(() => (dependencies.timedSearch ?? analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch)(...args)),
            }, search => { trial.search = structuredClone(search); });
            assert.ok(trial.apiMilliseconds !== undefined && Number.isFinite(trial.apiMilliseconds) && trial.apiMilliseconds >= 0, 'API参考時間');
            trial.pv = result.pv;
            pair.set(ordering, result.search);
            if (mode === 'fixed') {
              const baseline = baselines.get(ordering);
              if (baseline) assert.deepStrictEqual(deterministicResult(result.search), deterministicResult(baseline), '同じ順序モードの固定深さ結果が非決定的');
              else baselines.set(ordering, structuredClone(result.search));
              if (pair.size === 2) assert.equal(pair.get('original')!.selectedEvaluation,
                pair.get('material')!.selectedEvaluation, '固定深さ評価が一致しません');
            }
            trial.ok = true;
          } catch (error) {
            trial.error = `${context} ${stage}: ${message(error)}`;
            throw error;
          } finally {
            onTrial?.(entry, trial);
          }
        }
      }
    }
    entry.ok = true;
  } catch (error) { entry.error = `${context} ${stage}: ${message(error)}`; }
  return entry;
}

export function runRepeatedSuite(modes: readonly BenchmarkMode[], dependencies: RepeatedDependencies = {},
  positions = QUIESCENCE_BENCHMARK_POSITIONS, onCase?: (entry: RepeatedCase) => void,
  onTrial?: (entry: RepeatedCase, trial: Trial) => void): RepeatedCase[] {
  assert.equal(new Set(positions.map(p => p.id)).size, positions.length, '局面ID重複');
  const cases: RepeatedCase[] = [];
  for (const mode of modes) for (const [index, position] of positions.entries()) for (const extension of [1, 2] as const) {
    const entry = runRepeatedCase(position, index, mode, extension, dependencies, onTrial);
    cases.push(entry);
    onCase?.(entry);
  }
  return cases;
}

/** Sorted linear interpolation (R type 7): h=(n-1)*p, interpolate floor/ceil.
 * n=1 has identical quantiles; n=0 or non-finite samples are invalid. No trim. */
export function describeNumbers(values: readonly number[]) {
  assert.ok(values.length > 0 && values.every(Number.isFinite), '有限な標本が必要');
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p: number) => {
    const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] * (1 - (h - lo)) + sorted[hi] * (h - lo);
  };
  const q1 = quantile(0.25), q3 = quantile(0.75);
  return { count: values.length, median: quantile(0.5), q1, q3, iqr: q3 - q1, min: sorted[0], max: sorted.at(-1)! };
}

function frequencies(trials: Trial[], key: (trial: Trial) => string, label = key) {
  const counts = new Map<string, { value: string; label: string; count: number }>();
  for (const trial of trials) {
    const value = key(trial), entry = counts.get(value) ?? { value, label: label(trial), count: 0 };
    entry.count++;
    counts.set(value, entry);
  }
  return [...counts.values()];
}
function changeCounts(trials: Trial[]) {
  const first = trials[0].search!;
  return {
    selectedAction: trials.filter(t => !isDeepStrictEqual(t.search!.selectedAction, first.selectedAction)).length,
    evaluation: trials.filter(t => t.search!.selectedEvaluation !== first.selectedEvaluation).length,
    pv: trials.filter(t => !isDeepStrictEqual(t.search!.principalVariation, first.principalVariation)).length,
  };
}
export function summarizeRepeatedCase(entry: RepeatedCase) {
  if (!entry.ok) return null;
  assert.equal(entry.trials.length, (WARMUP_COUNT + MEASUREMENT_COUNT) * 2, '比較単位が未完了');
  const measurements = entry.trials.filter(t => t.phase === 'measurement');
  assert.equal(measurements.length, MEASUREMENT_COUNT * 2, '本測定が未完了');
  assert.ok(entry.trials.every(t => t.ok && t.search), '不正試行を集計できません');
  const settings = (['original', 'material'] as const).map(ordering => {
    const trials = measurements.filter(t => t.ordering === ordering);
    assert.equal(trials.length, MEASUREMENT_COUNT, '設定の本測定が未完了');
    assert.equal(entry.trials.filter(t => t.ordering === ordering && t.phase === 'warmup').length, WARMUP_COUNT, 'ウォームアップが未完了');
    const statistics = (total: boolean) => Object.fromEntries(statisticKeys.map(([key, sum]) => [key,
      describeNumbers(trials.map(t => total && 'iterations' in t.search! ? t.search[sum] : t.search![key]))]));
    return {
      ordering, count: trials.length, apiMilliseconds: describeNumbers(trials.map(t => t.apiMilliseconds!)),
      depthDistribution: frequencies(trials, t => String(t.search!.depth)),
      maxDepthReached: entry.mode === 'timed' ? trials.filter(t => t.search!.depth === 4).length : null,
      timedOut: entry.mode === 'timed' ? trials.filter(t => 'timedOut' in t.search! && t.search.timedOut).length : null,
      actions: frequencies(trials, t => rawJson(t.search!.selectedAction), t => t.pv?.[0] ?? '手なし'),
      evaluations: frequencies(trials, t => formatSenteEvaluation(t.search!.selectedEvaluation ?? t.search!.evaluationBreakdown.total, entry.turn!)),
      changesFromFirst: changeCounts(trials), deepest: statistics(false),
      completedTotals: entry.mode === 'timed' ? statistics(true) : null,
    };
  });
  const paired = { deeper: 0, same: 0, shallower: 0, selectedActionChanges: 0, evaluationChanges: 0, pvChanges: 0 };
  for (let i = 1; i <= MEASUREMENT_COUNT; i++) {
    const a = measurements.find(t => t.trial === i && t.ordering === 'original')!.search!;
    const b = measurements.find(t => t.trial === i && t.ordering === 'material')!.search!;
    paired[b.depth > a.depth ? 'deeper' : b.depth < a.depth ? 'shallower' : 'same']++;
    if (!isDeepStrictEqual(a.selectedAction, b.selectedAction)) paired.selectedActionChanges++;
    if (a.selectedEvaluation !== b.selectedEvaluation) paired.evaluationChanges++;
    if (!isDeepStrictEqual(a.principalVariation, b.principalVariation)) paired.pvChanges++;
  }
  const originalMedian = settings[0].apiMilliseconds.median;
  return { position: entry.position.id, mode: entry.mode, extension: entry.extension, settings, paired,
    materialMedianChangePercent: originalMedian === 0 ? null : (settings[1].apiMilliseconds.median / originalMedian - 1) * 100 };
}

export function formatRepeatedTrial(entry: RepeatedCase, trial: Trial) {
  return `TRIAL ${rawJson({ position: entry.position.id, mode: entry.mode, extension: entry.extension, ...trial,
    senteEvaluation: trial.ok && trial.search ? formatSenteEvaluation(trial.search.selectedEvaluation ?? trial.search.evaluationBreakdown.total, entry.turn!) : null,
    selectedActionLabel: trial.pv?.[0] ?? '手なし', pvLabel: trial.pv?.join(' ') || '手順なし',
    maxDepthReached: trial.search && typeof trial.search === 'object' && 'iterations' in trial.search ? trial.search.completedDepth === 4 : null,
  })}`;
}
export function formatRepeatedCase(entry: RepeatedCase) {
  return entry.ok ? `SUMMARY ${rawJson(summarizeRepeatedCase(entry))}`
    : `INCOMPLETE ${rawJson({ position: entry.position.id, mode: entry.mode, extension: entry.extension,
      attempted: entry.trials.length, error: entry.error, summary: null })}`;
}

/** Return an exit status so the exact CLI failure path is fixture-testable. */
export function runRepeatedCli(args: readonly string[], dependencies: RepeatedDependencies = {},
  positions = QUIESCENCE_BENCHMARK_POSITIONS, write: (line: string) => void = console.log): 0 | 1 {
  try {
    const modes = parseRepeatedModes(args);
    const cases = runRepeatedSuite(modes, dependencies, positions,
      entry => write(formatRepeatedCase(entry)), (entry, trial) => write(formatRepeatedTrial(entry, trial)));
    write(`COMPLETE ${rawJson({ units: cases.length, success: cases.filter(c => c.ok).length,
      failed: cases.filter(c => !c.ok).length, attemptedCalls: cases.reduce((n, c) => n + c.trials.length, 0) })}`);
    return cases.some(c => !c.ok) ? 1 : 0;
  } catch (error) { write(`ERROR ${message(error)}`); return 1; }
}
