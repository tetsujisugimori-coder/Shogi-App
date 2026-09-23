import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createPositionKey } from '../../src/domain/shogi/repetition';
import type { LegalAction } from '../../src/domain/shogi/legalActions';
import type { BoardState } from '../../src/types/shogi';
import { QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS, type SelfPlayScenario } from './quiescenceOrderingSelfPlayScenarios';
import { WARMUP_COUNT, MEASUREMENT_COUNT, alternatingPairOrder, describeNumbers, rawJson,
  type RepeatedDependencies } from './quiescenceOrderingRepeated';
import { DEFAULT_TIMED_SEARCH_OPTIONS, runOrderingTrial, type OrderingResult, type SearchResult, type Setting,
  type TimedSearchOptions } from './quiescenceOrderingSuite';
import type { BenchmarkMode } from './quiescenceSuite';

export type ComparisonSide = 'baseline' | 'candidate';
type ComparisonPhase = 'warmup' | 'measurement';
type MetricName = 'completedDepth' | 'searchPositionCount' | 'cutoffCount' | 'skippedActionCount' | 'elapsedMilliseconds';

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

/** Same suite and all other search settings; only killer history differs. */
export const KILLER_MOVE_SUITE_COMPARISON_CONFIG = Object.freeze({
  warmupCount: WARMUP_COUNT,
  measurementCount: MEASUREMENT_COUNT,
  execution: 'synchronous-serial-alternating-pairs',
  baseline: Object.freeze({ id: 'killer-off', setting: Object.freeze({ maxTacticalDepth: 1, moveOrdering: 'original', killerMoves: false }) }),
  candidate: Object.freeze({ id: 'killer-on', setting: Object.freeze({ maxTacticalDepth: 1, moveOrdering: 'original', killerMoves: true }) }),
} as const);

export interface SuiteComparisonConfig {
  readonly mode: BenchmarkMode;
  readonly timeLimitMilliseconds: number;
  readonly maxDepth: number;
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
  readonly skippedActionCount: number | null;
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
  /** Measurement-only, valid completed depths in ascending numeric order. */
  readonly completedDepthDistribution: Array<{ readonly depth: number; readonly count: number }>;
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
  readonly phase: SelfPlayScenario['phase'];
  readonly sideToMove: SelfPlayScenario['sideToMove'];
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
  dependencies: RepeatedDependencies, capture?: (search: SearchResult) => void,
  timedOptions?: TimedSearchOptions) => OrderingResult;
export interface SuiteComparisonDependencies extends RepeatedDependencies {
  readonly trialRunner?: SuiteComparisonTrialRunner;
}

const metricNames: readonly MetricName[] = ['completedDepth', 'searchPositionCount', 'cutoffCount', 'skippedActionCount', 'elapsedMilliseconds'];
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
    case 'skippedActionCount':
      return finite('iterations' in search ? search.totalSkippedActionCount : search.skippedActionCount);
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

function completedDepthDistribution(measurements: readonly SuiteComparisonTrial[]): Array<{ readonly depth: number; readonly count: number }> {
  const counts = new Map<number, number>();
  for (const trial of measurements) {
    const depth = trial.search ? finite(trial.search.depth) : null;
    // Failed/null/non-integral observations are intentionally not recoded.
    if (depth === null || !Number.isSafeInteger(depth) || depth < 1) continue;
    counts.set(depth, (counts.get(depth) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left - right)
    .map(([depth, count]) => ({ depth, count }));
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
    completedDepthDistribution: completedDepthDistribution(measurements),
    completedDepth: median('completedDepth'), searchPositionCount: median('searchPositionCount'),
    cutoffCount: median('cutoffCount'), skippedActionCount: median('skippedActionCount'),
    elapsedMilliseconds: median('elapsedMilliseconds'),
  };
}

function emptyDifference(): MetricDifference {
  return safeDifference(null, null);
}

function failedPosition(scenario: SelfPlayScenario, executionOrder: number, mode: BenchmarkMode,
  trials: SuiteComparisonTrial[], error: string, initialPositionKey?: string): PositionComparison {
  return { scenarioId: scenario.id, scenarioName: scenario.name, provenance: scenario.provenance,
    phase: scenario.phase, sideToMove: scenario.sideToMove,
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
            // runOrderingTrial invokes capture before result validation. Retain an
            // independent raw snapshot even when that validation then throws.
            const result = runner(input, config.mode, setting, dependencies, search => {
              trial.search = structuredClone(search);
            }, { timeLimitMilliseconds: config.timeLimitMilliseconds, maxDepth: config.maxDepth });
            const returnedSearch = structuredClone(result.search);
            assert.ok(trial.search === undefined || isDeepStrictEqual(trial.search, returnedSearch),
              'capture結果と正常終了結果の検索データが一致しません');
            trial.search = returnedSearch;
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
      phase: scenario.phase, sideToMove: scenario.sideToMove,
      executionOrder, mode: config.mode, initialPositionKey, trials, ok: true, baseline, candidate,
      selectedActionMatches: isDeepStrictEqual(baseline.selectedAction, candidate.selectedAction),
      evaluation: safeDifference(finite(baseline.selectedEvaluation), finite(candidate.selectedEvaluation)), metrics };
  } catch (error) {
    return failedPosition(scenario, executionOrder, config.mode, trials,
      `scenario=${scenario.id} ${stage}: ${message(error)}`, initialPositionKey);
  }
}

function aggregateMetric(positions: readonly PositionComparison[], metric: MetricName): MetricDifference {
  // A suite with no completed position still has a useful structured failure
  // report. There is no representative numeric value for any metric.
  if (positions.length === 0) return emptyDifference();
  const baseline = positions.map((position) => position.baseline![metric]);
  const candidate = positions.map((position) => position.candidate![metric]);
  if (!baseline.every((value): value is number => value !== null) || !candidate.every((value): value is number => value !== null)) return emptyDifference();
  const aggregate = metric === 'searchPositionCount' || metric === 'cutoffCount' || metric === 'skippedActionCount'
    ? (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0)
    : (values: readonly number[]) => describeNumbers(values).median;
  return safeDifference(aggregate(baseline), aggregate(candidate));
}

function validateConfig(config: SuiteComparisonConfig): void {
  assert.ok(config.mode === 'fixed' || config.mode === 'timed', 'Comparison mode must be fixed or timed.');
  assert.ok(Number.isSafeInteger(config.timeLimitMilliseconds) && config.timeLimitMilliseconds > 0,
    'Comparison timeLimitMilliseconds must be a positive integer.');
  assert.ok(Number.isSafeInteger(config.maxDepth) && config.maxDepth >= 1,
    'Comparison maxDepth must be an integer of at least 1.');
  assert.ok(config.baseline.id.length > 0 && config.candidate.id.length > 0, 'Comparison setting IDs are required.');
  assert.notEqual(config.baseline.id, config.candidate.id, 'Baseline and candidate IDs must differ.');
  for (const [side, named] of Object.entries({ baseline: config.baseline, candidate: config.candidate }) as
    Array<[ComparisonSide, NamedSearchSetting]>) {
    assert.ok(named.setting.maxTacticalDepth === 1 || named.setting.maxTacticalDepth === 2,
      `${side} tactical depth must be 1 or 2.`);
    assert.ok(named.setting.moveOrdering === 'original' || named.setting.moveOrdering === 'material',
      `${side} move ordering must be original or material.`);
    assert.ok(named.setting.killerMoves === undefined || typeof named.setting.killerMoves === 'boolean',
      `${side} killerMoves must be boolean when provided.`);
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
  return { mode, ...DEFAULT_TIMED_SEARCH_OPTIONS, baseline: SUITE_COMPARISON_CONFIG.baseline, candidate: SUITE_COMPARISON_CONFIG.candidate };
}

export function defaultKillerMoveSuiteComparisonConfig(mode: BenchmarkMode = 'timed'): SuiteComparisonConfig {
  return { mode, ...DEFAULT_TIMED_SEARCH_OPTIONS, baseline: KILLER_MOVE_SUITE_COMPARISON_CONFIG.baseline,
    candidate: KILLER_MOVE_SUITE_COMPARISON_CONFIG.candidate };
}

export function parseSuiteComparisonMode(args: readonly string[]): BenchmarkMode {
  if (args.length === 0) return 'timed';
  if (args.length === 1 && (args[0] === 'fixed' || args[0] === 'timed')) return args[0];
  throw new Error('Usage: npm run measure:quiescence-ordering-suite-comparison -- [fixed|timed]');
}

const value = (metric: MetricDifference) => metric.difference === null
  ? '未算出' : `${metric.baseline}→${metric.candidate} (差=${metric.difference}, 率=${metric.percentChange === null ? '未算出' : `${metric.percentChange}%`})`;
const describeSetting = (named: NamedSearchSetting) => `${named.id}=${rawJson(named.setting)}`;
const describeDepthDistribution = (distribution: readonly { readonly depth: number; readonly count: number }[]) =>
  distribution.length === 0 ? 'なし' : distribution.map(({ depth, count }) => `depth ${depth}×${count}`).join('、');

/** Human-facing rendering deliberately reports measurements only; it never names a winner. */
export function formatSuiteComparison(result: SuiteComparisonResult): string {
  const summary = result.summary;
  const lines = [
    'A/B 探索設定スイート比較',
    `mode=${result.config.mode}; timeLimitMilliseconds=${result.config.timeLimitMilliseconds}; maxDepth=${result.config.maxDepth}`,
    `baseline設定=${describeSetting(result.config.baseline)}; candidate設定=${describeSetting(result.config.candidate)}`,
    `対象局面=${summary.targetPositionCount}; 正常完了=${summary.completedPositionCount}; エラー=${summary.errorCount}; 選択手変更=${summary.selectedActionChangedPositionCount}`,
    `到達深さ（局面中央値の中央値）: ${value(summary.metrics.completedDepth)}`,
    `探索局面数（局面中央値の合計）: ${value(summary.metrics.searchPositionCount)}`,
    `カットオフ数（局面中央値の合計）: ${value(summary.metrics.cutoffCount)}`,
    `スキップ手数（局面中央値の合計）: ${value(summary.metrics.skippedActionCount)}`,
    `経過時間ms（局面中央値の中央値）: ${value(summary.metrics.elapsedMilliseconds)}`,
    '局面別の本測定:',
  ];
  if (result.positions.length === 0) lines.push('  該当なし');
  for (const position of result.positions) {
    if (!position.ok) {
      lines.push(`  ${position.scenarioId}: phase=${position.phase}; sideToMove=${position.sideToMove}; ERROR ${position.error}`);
      continue;
    }
    lines.push(`  ${position.scenarioId}: phase=${position.phase}; sideToMove=${position.sideToMove}; 手=${position.baseline!.selectedActionLabel}→${position.candidate!.selectedActionLabel}; 評価=${position.baseline!.selectedEvaluation}→${position.candidate!.selectedEvaluation}; 完了深さ中央値=${position.baseline!.completedDepth}→${position.candidate!.completedDepth}; 深さ分布=${describeDepthDistribution(position.baseline!.completedDepthDistribution)}→${describeDepthDistribution(position.candidate!.completedDepthDistribution)}; 探索局面数=${position.baseline!.searchPositionCount}→${position.candidate!.searchPositionCount}; cutoff=${position.baseline!.cutoffCount}→${position.candidate!.cutoffCount}; skip=${position.baseline!.skippedActionCount}→${position.candidate!.skippedActionCount}; 経過時間ms=${position.baseline!.elapsedMilliseconds}→${position.candidate!.elapsedMilliseconds}; timeout=${position.baseline!.timedOutCount}→${position.candidate!.timedOutCount}`);
  }
  return lines.join('\n');
}

/** JSON.stringify-compatible without silently turning Infinity into null. */
export const serializeSuiteComparison = (result: SuiteComparisonResult): string => rawJson(result);

export function runSuiteComparisonCli(args: readonly string[], dependencies: SuiteComparisonDependencies = {},
  scenarios = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS, write: (line: string) => void = console.log,
  configForMode: (mode: BenchmarkMode) => SuiteComparisonConfig = defaultSuiteComparisonConfig): 0 | 1 {
  try {
    const result = runSuiteComparison(configForMode(parseSuiteComparisonMode(args)), dependencies, scenarios);
    write(formatSuiteComparison(result));
    write(`JSON ${serializeSuiteComparison(result)}`);
    return result.summary.errorCount === 0 ? 0 : 1;
  } catch (error) {
    write(`ERROR ${message(error)}`);
    return 1;
  }
}

export interface KillerMoveSuiteComparisonCliArguments {
  readonly mode: BenchmarkMode;
  readonly timeLimitMilliseconds: number;
  readonly maxDepth: number;
}

const killerMoveCliUsage = 'Usage: npm run measure:killer-move-suite-comparison -- [fixed|timed] [--time-limit-ms <positive integer>] [--max-depth <integer >= 1>]';

function parsePositiveInteger(option: string, raw: string | undefined, minimum: number): number {
  if (raw === undefined || raw.startsWith('--') || !/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`${option} must be an integer${minimum === 1 ? ' of at least 1' : ' greater than 0'}. ${killerMoveCliUsage}`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${option} must be an integer${minimum === 1 ? ' of at least 1' : ' greater than 0'}. ${killerMoveCliUsage}`);
  }
  return parsed;
}

/** Parses the killer-only timed options without altering the established mode parser. */
export function parseKillerMoveSuiteComparisonCliArguments(args: readonly string[]): KillerMoveSuiteComparisonCliArguments {
  let mode: BenchmarkMode = 'timed';
  let explicitMode = false;
  let timeLimitMilliseconds = DEFAULT_TIMED_SEARCH_OPTIONS.timeLimitMilliseconds;
  let maxDepth = DEFAULT_TIMED_SEARCH_OPTIONS.maxDepth;
  let sawTimedOption = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === 'fixed' || argument === 'timed') {
      if (explicitMode) throw new Error(`Mode may be specified only once. ${killerMoveCliUsage}`);
      mode = argument;
      explicitMode = true;
      continue;
    }
    if (argument === '--time-limit-ms') {
      if (sawTimedOption && args.slice(0, index).includes('--time-limit-ms')) throw new Error(`--time-limit-ms may be specified only once. ${killerMoveCliUsage}`);
      timeLimitMilliseconds = parsePositiveInteger(argument, args[++index], 1);
      sawTimedOption = true;
      continue;
    }
    if (argument === '--max-depth') {
      if (args.slice(0, index).includes('--max-depth')) throw new Error(`--max-depth may be specified only once. ${killerMoveCliUsage}`);
      maxDepth = parsePositiveInteger(argument, args[++index], 1);
      sawTimedOption = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}. ${killerMoveCliUsage}`);
  }
  if (mode === 'fixed' && sawTimedOption) throw new Error(`Timed-only options cannot be used with fixed mode. ${killerMoveCliUsage}`);
  return { mode, timeLimitMilliseconds, maxDepth };
}

/** Killer CLI extension; the shared comparison CLI deliberately keeps its legacy grammar. */
export function runKillerMoveSuiteComparisonCli(args: readonly string[], dependencies: SuiteComparisonDependencies = {},
  scenarios = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS, write: (line: string) => void = console.log,
  configForMode: (mode: BenchmarkMode) => SuiteComparisonConfig = defaultKillerMoveSuiteComparisonConfig): 0 | 1 {
  try {
    const parsed = parseKillerMoveSuiteComparisonCliArguments(args);
    const base = configForMode(parsed.mode);
    const result = runSuiteComparison({ ...base, timeLimitMilliseconds: parsed.timeLimitMilliseconds, maxDepth: parsed.maxDepth }, dependencies, scenarios);
    write(formatSuiteComparison(result));
    write(`JSON ${serializeSuiteComparison(result)}`);
    return result.summary.errorCount === 0 ? 0 : 1;
  } catch (error) {
    write(`ERROR ${message(error)}`);
    return 1;
  }
}
