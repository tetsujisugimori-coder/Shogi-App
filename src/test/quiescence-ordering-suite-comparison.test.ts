// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createPositionKey } from '../domain/shogi/repetition';
import { getLegalActions } from '../domain/shogi/legalActions';
import { analyzeAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS, type SelfPlayScenario } from '../../scripts/benchmarks/quiescenceOrderingSelfPlayScenarios';
import { defaultSuiteComparisonConfig, formatSuiteComparison, parseSuiteComparisonMode, runSuiteComparison,
  runSuiteComparisonCli, serializeSuiteComparison, defaultKillerMoveSuiteComparisonConfig,
  type SuiteComparisonDependencies } from '../../scripts/benchmarks/quiescenceOrderingSuiteComparison';
import type { SearchResult } from '../../scripts/benchmarks/quiescenceOrderingSuite';

function fixtureDependencies(options: { readonly infiniteCandidateEvaluation?: boolean; readonly failScenarioId?: string } = {}): SuiteComparisonDependencies {
  const calls = new Map<string, number>();
  return {
    trialRunner: (input, mode, setting) => {
      const key = `${createPositionKey(input)}/${setting.moveOrdering}`;
      const call = (calls.get(key) ?? 0) + 1;
      calls.set(key, call);
      const scenario = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.find((item) => createPositionKey(item.create()) === createPositionKey(input));
      if (setting.moveOrdering === 'material' && scenario?.id === options.failScenarioId) throw new Error('fixture candidate failure');
      const actions = getLegalActions(input);
      const candidate = setting.moveOrdering === 'material';
      const measurement = Math.max(1, call - 3);
      const search = {
        depth: (candidate ? 2 : 1) + measurement,
        selectedAction: actions[candidate ? 1 : 0] ?? actions[0] ?? null,
        selectedEvaluation: candidate && options.infiniteCandidateEvaluation ? Infinity : candidate ? 5 : 0,
        elapsedMilliseconds: candidate ? measurement * 4 : measurement * 2,
        visitedPositionCount: candidate ? 4 : 0,
        cutoffCount: candidate ? 2 : 0,
        skippedActionCount: candidate ? 3 : 0,
      } as SearchResult;
      return { setting, search, pv: [candidate ? 'candidate-action' : 'baseline-action'] };
    },
  };
}

function endedScenario(id: string): SelfPlayScenario {
  const scenario = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS[0];
  return { ...scenario, id, create: () => ({ ...scenario.create(), status: 'ended',
    result: { winner: 'sente', loser: 'gote', endReason: 'resignation' } }) };
}

describe('multi-position A/B search suite comparison', () => {
  it('calls both named settings on every suite position under identical mode and balanced retained order', () => {
    const seen: Array<{ position: string; mode: string; ordering: string }> = [];
    const dependencies = fixtureDependencies();
    const runner = dependencies.trialRunner!;
    const result = runSuiteComparison(defaultSuiteComparisonConfig('fixed'), {
      ...dependencies,
      trialRunner: (input, mode, setting, injected) => {
        seen.push({ position: createPositionKey(input), mode, ordering: setting.moveOrdering });
        return runner(input, mode, setting, injected);
      },
    });

    expect(result.positions).toHaveLength(3);
    expect(seen).toHaveLength(3 * (3 + 8) * 2);
    for (const scenario of QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS) {
      const runs = seen.filter((entry) => entry.position === createPositionKey(scenario.create()));
      expect(runs).toHaveLength(22);
      expect(runs.map((entry) => entry.mode)).toEqual(Array(22).fill('fixed'));
      expect(runs.filter((entry) => entry.ordering === 'original')).toHaveLength(11);
      expect(runs.filter((entry) => entry.ordering === 'material')).toHaveLength(11);
      const retained = runs.slice(6);
      expect(retained.filter((entry) => entry.ordering === 'original')).toHaveLength(8);
      expect(retained.filter((entry) => entry.ordering === 'material')).toHaveLength(8);
    }
  });

  it('records selected-action differences and medians, sums suite nodes/cutoffs, and keeps zero-based rates unavailable', () => {
    const result = runSuiteComparison(defaultSuiteComparisonConfig('fixed'), fixtureDependencies());
    expect(result.summary).toMatchObject({ targetPositionCount: 3, completedPositionCount: 3,
      errorCount: 0, selectedActionChangedPositionCount: 3 });
    const first = result.positions[0];
    expect(first.selectedActionMatches).toBe(false);
    expect(first.evaluation).toMatchObject({ baseline: 0, candidate: 5, difference: 5, percentChange: null });
    expect(first.metrics.completedDepth).toMatchObject({ baseline: 5.5, candidate: 6.5, difference: 1, percentChange: expect.any(Number) });
    expect(first.metrics.searchPositionCount).toEqual({ baseline: 0, candidate: 4, difference: 4, percentChange: null });
    expect(first.metrics.cutoffCount).toEqual({ baseline: 0, candidate: 2, difference: 2, percentChange: null });
    expect(first.metrics.skippedActionCount).toEqual({ baseline: 0, candidate: 3, difference: 3, percentChange: null });
    expect(first.metrics.elapsedMilliseconds).toMatchObject({ baseline: 9, candidate: 18, difference: 9, percentChange: 100 });
    expect(result.summary.metrics.searchPositionCount).toEqual({ baseline: 0, candidate: 12, difference: 12, percentChange: null });
    expect(result.summary.metrics.cutoffCount).toEqual({ baseline: 0, candidate: 6, difference: 6, percentChange: null });
    expect(result.summary.metrics.skippedActionCount).toEqual({ baseline: 0, candidate: 9, difference: 9, percentChange: null });
    expect(result.positions.every((position) => position.baseline?.sampleCount === 8 && position.candidate?.sampleCount === 8)).toBe(true);
  });

  it('keeps an errored position and continues independent positions without aggregating the partial unit', () => {
    const result = runSuiteComparison(defaultSuiteComparisonConfig('fixed'), fixtureDependencies({
      failScenarioId: 'rook-pawn-opening-76-34-26-84',
    }));
    expect(result.summary).toMatchObject({ targetPositionCount: 3, completedPositionCount: 2, errorCount: 1,
      selectedActionChangedPositionCount: 2 });
    const failed = result.positions[1];
    expect(failed).toMatchObject({ scenarioId: 'rook-pawn-opening-76-34-26-84', ok: false });
    expect(failed.trials).toHaveLength(1);
    expect(failed.trials.at(-1)).toMatchObject({ side: 'candidate', ok: false, error: expect.stringContaining('fixture candidate failure') });
    expect(result.positions[2].ok).toBe(true);
    expect(formatSuiteComparison(result)).toContain('ERROR scenario=rook-pawn-opening-76-34-26-84');
  });

  it('keeps every failed position, null aggregate metrics, and CLI JSON when no position completes', () => {
    const scenarios = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS;
    const dependencies: SuiteComparisonDependencies = { trialRunner: () => { throw new Error('fixture all failure'); } };
    const result = runSuiteComparison(defaultSuiteComparisonConfig('fixed'), dependencies, scenarios);
    expect(result.summary).toMatchObject({ targetPositionCount: 3, completedPositionCount: 0, errorCount: 3,
      selectedActionChangedPositionCount: 0 });
    const unavailable = { baseline: null, candidate: null, difference: null, percentChange: null };
    expect(result.summary.metrics).toEqual({ completedDepth: unavailable, searchPositionCount: unavailable,
      cutoffCount: unavailable, skippedActionCount: unavailable, elapsedMilliseconds: unavailable });
    expect(result.positions).toHaveLength(3);
    expect(result.positions.every((position) => !position.ok && position.trials.length === 1 &&
      position.trials[0].error?.includes('fixture all failure'))).toBe(true);
    const output: string[] = [];
    expect(runSuiteComparisonCli(['fixed'], dependencies, scenarios, line => output.push(line))).toBe(1);
    expect(output[0]).toContain('正常完了=0; エラー=3');
    for (const scenario of scenarios) expect(output[0]).toContain(`${scenario.id}: ERROR`);
    const serialized = output.at(-1)!.slice('JSON '.length);
    expect(JSON.parse(serialized).positions.map((position: { scenarioId: string }) => position.scenarioId))
      .toEqual(scenarios.map((scenario) => scenario.id));
  });

  it('allows an empty scenario list without inventing aggregate values', () => {
    const result = runSuiteComparison(defaultSuiteComparisonConfig('fixed'), fixtureDependencies(), []);
    expect(result.summary).toMatchObject({ targetPositionCount: 0, completedPositionCount: 0, errorCount: 0,
      selectedActionChangedPositionCount: 0 });
    expect(result.summary.metrics.completedDepth).toEqual({ baseline: null, candidate: null, difference: null, percentChange: null });
  });

  it('retains a captured raw result when default validation fails and continues later positions', () => {
    const scenarios = [endedScenario('validation-failure'), endedScenario('continues-after-validation-failure')];
    let call = 0;
    const result = runSuiteComparison(defaultSuiteComparisonConfig('fixed'), {
      fixedSearch: (...args) => {
        const search = analyzeAlphaBetaSearch(...args);
        return call++ === 0 ? { ...search, rootLegalActionCount: 1 } : search;
      },
    }, scenarios);
    const failed = result.positions[0];
    expect(failed).toMatchObject({ scenarioId: 'validation-failure', ok: false });
    expect(failed.trials[0]).toMatchObject({ ok: false, search: { rootLegalActionCount: 1 },
      error: expect.stringContaining('root合法手数') });
    expect(result.positions[1].ok).toBe(true);
    expect(result.summary).toMatchObject({ completedPositionCount: 1, errorCount: 1 });
    expect(JSON.parse(serializeSuiteComparison(result)).positions[0].trials[0].search.rootLegalActionCount).toBe(1);
  });

  it('has a JSON-safe boundary and text output with the suite aggregate before notable position differences', () => {
    const result = runSuiteComparison(defaultSuiteComparisonConfig('fixed'), fixtureDependencies({ infiniteCandidateEvaluation: true }),
      [QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS[0]]);
    const serialized = serializeSuiteComparison(result);
    expect(JSON.parse(serialized).positions[0].candidate.selectedEvaluation).toBe('Infinity');
    const text = formatSuiteComparison(result);
    expect(text).toMatch(/^A\/B 探索設定スイート比較\n対象局面=1;/);
    expect(text).toContain('局面別の主な差分:');
    expect(text).toContain('standard-hirate: 手=baseline-action→candidate-action');
  });

  it('uses the established CLI boundary and rejects invalid modes without an accidental run', () => {
    const output: string[] = [];
    expect(runSuiteComparisonCli(['fixed'], fixtureDependencies(), [QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS[0]], (line) => output.push(line))).toBe(0);
    expect(output[0]).toMatch(/^A\/B 探索設定スイート比較/);
    expect(output.at(-1)).toMatch(/^JSON /);
    expect(runSuiteComparisonCli(['both'], fixtureDependencies(), [], () => {})).toBe(1);
    expect(parseSuiteComparisonMode([])).toBe('timed');
    expect(parseSuiteComparisonMode(['timed'])).toBe('timed');
    expect(() => parseSuiteComparisonMode(['bad'])).toThrow('measure:quiescence-ordering-suite-comparison');
  });

  it('builds a balanced killer OFF/ON configuration without changing quiescence or ordinary ordering', () => {
    const config = defaultKillerMoveSuiteComparisonConfig('timed');
    expect(config.baseline).toEqual({ id: 'killer-off', setting: { maxTacticalDepth: 1, moveOrdering: 'original', killerMoves: false } });
    expect(config.candidate).toEqual({ id: 'killer-on', setting: { maxTacticalDepth: 1, moveOrdering: 'original', killerMoves: true } });
    const result = runSuiteComparison(config, fixtureDependencies(), [QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS[0]]);
    expect(result.positions[0].ok).toBe(true);
  });

  it('fails fatal duplicate scenario configuration before beginning a suite', () => {
    const scenario: SelfPlayScenario = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS[0];
    expect(() => runSuiteComparison(defaultSuiteComparisonConfig('fixed'), fixtureDependencies(), [scenario, scenario])).toThrow('Scenario IDs must be unique');
    expect(() => runSuiteComparison({ ...defaultSuiteComparisonConfig('fixed'),
      candidate: { id: 'invalid', setting: { maxTacticalDepth: 3, moveOrdering: 'material' } as never },
    }, fixtureDependencies(), [scenario])).toThrow('candidate tactical depth');
  });
});
