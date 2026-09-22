import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createPositionKey } from '../../src/domain/shogi/repetition';
import type { LegalAction } from '../../src/domain/shogi/legalActions';
import type { BoardState } from '../../src/types/shogi';
import { QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS, type SelfPlayScenario } from './quiescenceOrderingSelfPlayScenarios';
import { WARMUP_COUNT, MEASUREMENT_COUNT, alternatingPairOrder, describeNumbers, rawJson,
  type RepeatedDependencies } from './quiescenceOrderingRepeated';
import { runOrderingTrial, type OrderingResult, type SearchResult, type Setting } from './quiescenceOrderingSuite';
import type { BenchmarkMode } from './quiescenceSuite';

export type ComparisonSide = 'baseline' | 'candidate';
type ComparisonPhase = 'warmup' | 'measurement';
type MetricName = 'completedDepth' | 'searchPositionCount' | 'cutoffCount' | 'elapsedMilliseconds';

export interface NamedSearchSetting {
  readonly id: string;
  readonly setting: Setting;
}

/** This is a measurement/reporting configuration, not a strength judgement. */
export const SUITE_COMPARISON_CONFIG = Object.freeze({
  warmupCount: WARMUP_COUNT,
  measurementCount: MEASUREMENT_COUNT,
  execution: 'synchronous-serial-alternating-pairs',
  baseline: Object.freeze({ id: 'original', setting: Object.freeze({ maxTacticalDepth: 1, moveOrdering: 'original' }) }),
  candidate: Object.freeze({ id: 'material', setting: Object.freeze({ maxTacticalDepth: 1, moveOrdering: 'material' }) }),
} as const);

export interface SuiteComparisonConfig {
  readonly mode: BenchmarkMode;
  readonly baseline: NamedSearchSetting;
  readonly candidate: NamedSearchSetting;
}

export interface SuiteComparisonTrial {
  readonly phase: ComparisonPhase;
  readonly trial: number;
  readonly order: readonly ComparisonSide[];
  readonly orderIndex: number;
  readonly side: ComparisonSide;
  ok: boolean;
  search?: SearchResult;
  pv?: string[];
  error?: string;
}

export interface SideMetrics {
  readonly completedDepth: number | null;
  /** Timed mode uses all completed iterations; fixed mode uses its sole pass. */
  readonly searchPositionCount: number | null;
  readonly cutoffCount: number | null;
  readonly elapsedMilliseconds: number | null;
}

export interface SideObservationSummary extends SideMetrics {
  readonly sampleCount: number;
  /** The first retained measurement identifies a concrete move; all samples remain in trials. */
  readonly selectedAction: LegalAction | null;
  readonly selectedActionLabel: string;
  readonly selectedEvaluation: number | null;
  readonly selectedActionFrequencies: Array<{ readonly label: string; readonly count: number }>;
  readonly timedOutCount: number;
  readonly completedCount: number;
  readonly timeoutUnavailableCount: number;
}

export interface MetricDifference {
  readonly baseline: number | null;
  readonly candidate: number | null;
  readonly difference: number | null;
  /** null means unavailable, including a zero baseline. */
  readonly percentChange: number | null;
}

export interface PositionComparison {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly provenance: string;
  readonly executionOrder: number;
  readonly mode: BenchmarkMode;
  readonly initialPositionKey?: string;
  readonly trials: SuiteComparisonTrial[];
  readonly ok: boolean;
  readonly baseline?: SideObservationSummary;
  readonly candidate?: SideObservationSummary;
  readonly selectedActionMatches?: boolean;
  readonly evaluation: MetricDifference;
  readonly metrics: Readonly<Record<MetricName, MetricDifference>>;
  readonly error?: string;
}

export interface SuiteComparisonResult {
  readonly config: SuiteComparisonConfig;
  readonly positions: PositionComparison[];
  readonly summary: {
    readonly targetPositionCount: number;
    readonly completedPositionCount: number;
    readonly errorCount: number;
    readonly selectedActionChangedPositionCount: number;
    readonly metrics: Readonly<Record<MetricName, MetricDifference>>;
  };
}

/** A narrow seam lets tests control measurements without changing the search engine. */
export type SuiteComparisonTrialRunner = (input: BoardState, mode: BenchmarkMode, setting: Setting,
  dependencies: RepeatedDependencies) => OrderingResult;
export interface SuiteComparisonDependencies extends RepeatedDependencies {
  readonly trialRunner?: SuiteComparisonTrialRunner;
}

const metricNames: readonly MetricName[] = ['completedDepth', 'searchPositionCount', 'cutoffCount', 'elapsedMilliseconds'];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricValue(search: SearchResult, metric: MetricName): number | null {
  switch (metric) {
    case 'completedDepth': return finite(search.depth);
    case 'elapsedMilliseconds': return finite(search.elapsedMilliseconds);
    case 'searchPositionCount':
      return finite('iterations' in search ? search.totalVisitedPositionCount : search.visitedPositionCount);
    case 'cutoffCount':
      return finite('iterations' in search ? search.totalCutoffCount : search.cutoffCount);
  }
}

function safeDifference(baseline: number | null, candidate: number | null): MetricDifference {
  const difference = baseline === null || candidate === null || !Number.isFinite(baseline) || !Number.isFinite(candidate)
    ? null : candidate - baseline;
  return { baseline, candidate, difference,
    percentChange: baseline === null || candidate === null || !Number.isFinite(baseline) || !Number.isFinite(candidate) || baseline === 0
      ? null : (candidate - baseline) / baseline * 100 };
}

function searchTimedOut(search: SearchResult): boolean | null {
  return 'timedOut' in search ? search.timedOut : false;
}

function summarizeSide(trials: readonly SuiteComparisonTrial[], side: ComparisonSide): SideObservationSummary {
  const measurements = trials.filter((trial) => trial.phase === 'measurement' && trial.side === side);
  assert.equal(measurements.length, MEASUREMENT_COUNT, `${side} measurement count`);
  assert.ok(measurements.every((trial) => trial.ok && trial.search), `${side} has an incomplete measurement`);
  const first = measurements[0];
  const values = (metric: MetricName) => measurements.map((trial) => metricValue(trial.search!, metric));
  const median = (metric: MetricName) => {
    const samples = values(metric);
    return samples.every((value): value is number => value !== null) ? describeNumbers(samples).median : null;
  };
  const frequencies = new Map<string, { label: string; count: number }>();
  for (const trial of measurements) {
    const label = trial.pv?.[0] ?? '手なし';
    const key = rawJson(trial.search!.selectedAction);
    const item = frequencies.get(key) ?? { label, count: 0 };
    item.count++;
    frequencies.set(key, item);
  }
  const timeoutValues = measurements.map((trial) => searchTimedOut(trial.search!));
  return {
    sampleCount: measurements.length,
    selectedAction: first.search!.selectedAction,
    selectedActionLabel: first.pv?.[0] ?? '手なし',
    selectedEvaluation: first.search!.selectedEvaluation,
    selectedActionFrequencies: [...frequencies.values()],
    timedOutCount: timeoutValues.filter((value) => value === true).length,
    completedCount: timeoutValues.filter((value) => value === false).length,
    timeoutUnavailableCount: timeoutValues.filter((value) => value === null).length,
    completedDepth: median('completedDepth'), searchPositionCount: median('searchPositionCount'),
    cutoffCount: median('cutoffCount'), elapsedMilliseconds: median('elapsedMilliseconds'),
  };
}

function emptyDifference(): MetricDifference {
  return safeDifference(null, null);
}

function failedPosition(scenario: SelfPlayScenario, executionOrder: number, mode: BenchmarkMode,
  trials: SuiteComparisonTrial[], error: string, initialPositionKey?: string): PositionComparison {
  return { scenarioId: scenario.id, scenarioName: scenario.name, provenance: scenario.provenance,
    executionOrder, mode, initialPositionKey, trials, ok: false, error,
    evaluation: emptyDifference(), metrics: Object.fromEntries(metricNames.map((metric) => [metric, emptyDifference()])) as Record<MetricName, MetricDifference> };
}

function runPositionComparison(scenario: SelfPlayScenario, executionOrder: number, config: SuiteComparisonConfig,
  dependencies: SuiteComparisonDependencies): PositionComparison {
  const trials: SuiteComparisonTrial[] = [];
  let initialPositionKey: string | undefined;
  let stage = 'setup';
  try {
    const input = scenario.create();
    const inputBefore = structuredClone(input);
    initialPositionKey = createPositionKey(input);
    const runner = dependencies.trialRunner ?? runOrderingTrial;
    for (const phase of ['warmup', 'measurement'] as const) {
      const count = phase === 'warmup' ? WARMUP_COUNT : MEASUREMENT_COUNT;
      for (let index = 0; index < count; index++) {
        const order = alternatingPairOrder('baseline', 'candidate', executionOrder - 1 + index);
        for (const [orderIndex, side] of order.entries()) {
          const setting = config[side].setting;
          stage = `phase=${phase} trial=${index + 1} side=${side}`;
          const trial: SuiteComparisonTrial = { phase, trial: index + 1, order, orderIndex, side, ok: false };
          trials.push(trial);
          try {
            const result = runner(input, config.mode, setting, dependencies);
            trial.search = structuredClone(result.search);
            trial.pv = [...result.pv];
            trial.ok = true;
          } catch (error) {
            trial.error = `${stage}: ${message(error)}`;
            throw error;
          }
        }
      }
    }
    assert.deepStrictEqual(input, inputBefore, '入力局面が変更されました');
    const baseline = summarizeSide(trials, 'baseline');
    const candidate = summarizeSide(trials, 'candidate');
    const metrics = Object.fromEntries(metricNames.map((metric) => [metric,
      safeDifference(baseline[metric], candidate[metric])])) as Record<MetricName, MetricDifference>;
    return { scenarioId: scenario.id, scenarioName: scenario.name, provenance: scenario.provenance,
      executionOrder, mode: config.mode, initialPositionKey, trials, ok: true, baseline, candidate,
      selectedActionMatches: isDeepStrictEqual(baseline.selectedAction, candidate.selectedAction),
      evaluation: safeDifference(finite(baseline.selectedEvaluation), finite(candidate.selectedEvaluation)), metrics };
  } catch (error) {
    return failedPosition(scenario, executionOrder, config.mode, trials,
      `scenario=${scenario.id} ${stage}: ${message(error)}`, initialPositionKey);
  }
}

function aggregateMetric(positions: readonly PositionComparison[], metric: MetricName): MetricDifference {
  const baseline = positions.map((position) => position.baseline![metric]);
  const candidate = positions.map((position) => position.candidate![metric]);
  if (!baseline.every((value): value is number => value !== null) || !candidate.every((value): value is number => value !== null)) return emptyDifference();
  const aggregate = metric === 'searchPositionCount' || metric === 'cutoffCount'
    ? (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0)
    : (values: readonly number[]) => describeNumbers(values).median;
  return safeDifference(aggregate(baseline), aggregate(candidate));
}

function validateConfig(config: SuiteComparisonConfig): void {
  assert.ok(config.mode === 'fixed' || config.mode === 'timed', 'Comparison mode must be fixed or timed.');
  assert.ok(config.baseline.id.length > 0 && config.candidate.id.length > 0, 'Comparison setting IDs are required.');
  assert.notEqual(config.baseline.id, config.candidate.id, 'Baseline and candidate IDs must differ.');
  for (const [side, named] of Object.entries({ baseline: config.baseline, candidate: config.candidate }) as
    Array<[ComparisonSide, NamedSearchSetting]>) {
    assert.ok(named.setting.maxTacticalDepth === 1 || named.setting.maxTacticalDepth === 2,
      `${side} tactical depth must be 1 or 2.`);
    assert.ok(named.setting.moveOrdering === 'original' || named.setting.moveOrdering === 'material',
      `${side} move ordering must be original or material.`);
  }
}

/** Runs the PR #136 scenario catalogue without duplicating the existing search executor. */
export function runSuiteComparison(config: SuiteComparisonConfig,
  dependencies: SuiteComparisonDependencies = {}, scenarios: readonly SelfPlayScenario[] = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS): SuiteComparisonResult {
  validateConfig(config);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, scenarios.length, 'Scenario IDs must be unique.');
  const positions = scenarios.map((scenario, index) => runPositionComparison(scenario, index + 1, config, dependencies));
  const completed = positions.filter((position) => position.ok);
  return { config, positions, summary: {
    targetPositionCount: positions.length,
    completedPositionCount: completed.length,
    errorCount: positions.length - completed.length,
    selectedActionChangedPositionCount: completed.filter((position) => position.selectedActionMatches === false).length,
    metrics: Object.fromEntries(metricNames.map((metric) => [metric, aggregateMetric(completed, metric)])) as Record<MetricName, MetricDifference>,
  } };
}

export function defaultSuiteComparisonConfig(mode: BenchmarkMode = 'timed'): SuiteComparisonConfig {
  return { mode, baseline: SUITE_COMPARISON_CONFIG.baseline, candidate: SUITE_COMPARISON_CONFIG.candidate };
}

export function parseSuiteComparisonMode(args: readonly string[]): BenchmarkMode {
  if (args.length === 0) return 'timed';
  if (args.length === 1 && (args[0] === 'fixed' || args[0] === 'timed')) return args[0];
  throw new Error('Usage: npm run measure:quiescence-ordering-suite-comparison -- [fixed|timed]');
}

const value = (metric: MetricDifference) => metric.difference === null
  ? '未算出' : `${metric.baseline}→${metric.candidate} (差=${metric.difference}, 率=${metric.percentChange === null ? '未算出' : `${metric.percentChange}%`})`;

/** Human-facing rendering deliberately reports measurements only; it never names a winner. */
export function formatSuiteComparison(result: SuiteComparisonResult): string {
  const summary = result.summary;
  const lines = [
    'A/B 探索設定スイート比較',
    `対象局面=${summary.targetPositionCount}; 正常完了=${summary.completedPositionCount}; エラー=${summary.errorCount}; 選択手変更=${summary.selectedActionChangedPositionCount}`,
    `到達深さ（局面中央値の中央値）: ${value(summary.metrics.completedDepth)}`,
    `探索局面数（局面中央値の合計）: ${value(summary.metrics.searchPositionCount)}`,
    `カットオフ数（局面中央値の合計）: ${value(summary.metrics.cutoffCount)}`,
    `経過時間ms（局面中央値の中央値）: ${value(summary.metrics.elapsedMilliseconds)}`,
    '局面別の主な差分:',
  ];
  const notable = result.positions.filter((position) => !position.ok || position.selectedActionMatches === false || position.evaluation.difference !== 0);
  if (notable.length === 0) lines.push('  該当なし');
  for (const position of notable) {
    if (!position.ok) { lines.push(`  ${position.scenarioId}: ERROR ${position.error}`); continue; }
    lines.push(`  ${position.scenarioId}: 手=${position.baseline!.selectedActionLabel}→${position.candidate!.selectedActionLabel}; 一致=${position.selectedActionMatches}; 評価差=${position.evaluation.difference ?? '未算出'}; 深さ差=${position.metrics.completedDepth.difference ?? '未算出'}; 探索局面数差=${position.metrics.searchPositionCount.difference ?? '未算出'}; cutoff差=${position.metrics.cutoffCount.difference ?? '未算出'}; 時間差ms=${position.metrics.elapsedMilliseconds.difference ?? '未算出'}`);
  }
  return lines.join('\n');
}

/** JSON.stringify-compatible without silently turning Infinity into null. */
export const serializeSuiteComparison = (result: SuiteComparisonResult): string => rawJson(result);

export function runSuiteComparisonCli(args: readonly string[], dependencies: SuiteComparisonDependencies = {},
  scenarios = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS, write: (line: string) => void = console.log): 0 | 1 {
  try {
    const result = runSuiteComparison(defaultSuiteComparisonConfig(parseSuiteComparisonMode(args)), dependencies, scenarios);
    write(formatSuiteComparison(result));
    write(`JSON ${serializeSuiteComparison(result)}`);
    return result.summary.errorCount === 0 ? 0 : 1;
  } catch (error) {
    write(`ERROR ${message(error)}`);
    return 1;
  }
}
