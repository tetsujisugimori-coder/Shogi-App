// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createPositionKey } from '../domain/shogi/repetition';
import { getLegalActions } from '../domain/shogi/legalActions';
import { analyzeAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS, type SelfPlayScenario } from '../../scripts/benchmarks/quiescenceOrderingSelfPlayScenarios';
import { defaultSuiteComparisonConfig, formatSuiteComparison, parseSuiteComparisonMode, runSuiteComparison,
  runSuiteComparisonCli, serializeSuiteComparison, defaultKillerMoveSuiteComparisonConfig,
  parseKillerMoveSuiteComparisonCliArguments, runKillerMoveSuiteComparisonCli,
  type SuiteComparisonDependencies } from '../../scripts/benchmarks/quiescenceOrderingSuiteComparison';
import type { SearchResult } from '../../scripts/benchmarks/quiescenceOrderingSuite';

function fixtureDependencies(options: { readonly infiniteCandidateEvaluation?: boolean; readonly failScenarioId?: string } = {}): SuiteComparisonDependencies {
  const calls = new Map<string, number>();
  const legalActions = new Map<string, ReturnType<typeof getLegalActions>>();
  const scenariosByPosition = new Map(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map(scenario =>
    [createPositionKey(scenario.create()), scenario] as const));
  return {
    trialRunner: (input, mode, setting) => {
      const key = `${createPositionKey(input)}/${setting.moveOrdering}`;
      const call = (calls.get(key) ?? 0) + 1;
      calls.set(key, call);
      const scenario = scenariosByPosition.get(createPositionKey(input));
      if (setting.moveOrdering === 'material' && scenario?.id === options.failScenarioId) throw new Error('fixture candidate failure');
      const actions = legalActions.get(key) ?? getLegalActions(input);
      legalActions.set(key, actions);
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

    expect(result.positions).toHaveLength(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length);
    expect(seen).toHaveLength(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length * (3 + 8) * 2);
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
    expect(result.summary).toMatchObject({ targetPositionCount: QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length, completedPositionCount: QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length,
      errorCount: 0, selectedActionChangedPositionCount: QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length });
    const first = result.positions[0];
    expect(first.selectedActionMatches).toBe(false);
    expect(first.evaluation).toMatchObject({ baseline: 0, candidate: 5, difference: 5, percentChange: null });
    expect(first.metrics.completedDepth).toMatchObject({ baseline: 5.5, candidate: 6.5, difference: 1, percentChange: expect.any(Number) });
    expect(first.metrics.searchPositionCount).toEqual({ baseline: 0, candidate: 4, difference: 4, percentChange: null });
    expect(first.metrics.cutoffCount).toEqual({ baseline: 0, candidate: 2, difference: 2, percentChange: null });
    expect(first.metrics.skippedActionCount).toEqual({ baseline: 0, candidate: 3, difference: 3, percentChange: null });
    expect(first.metrics.elapsedMilliseconds).toMatchObject({ baseline: 9, candidate: 18, difference: 9, percentChange: 100 });
    expect(result.summary.metrics.searchPositionCount).toEqual({ baseline: 0, candidate: 4 * QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length, difference: 4 * QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length, percentChange: null });
    expect(result.summary.metrics.cutoffCount).toEqual({ baseline: 0, candidate: 2 * QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length, difference: 2 * QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length, percentChange: null });
    expect(result.summary.metrics.skippedActionCount).toEqual({ baseline: 0, candidate: 3 * QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length, difference: 3 * QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length, percentChange: null });
    expect(result.positions.every((position) => position.baseline?.sampleCount === 8 && position.candidate?.sampleCount === 8)).toBe(true);
  });

  it('keeps an errored position and continues independent positions without aggregating the partial unit', () => {
    const result = runSuiteComparison(defaultSuiteComparisonConfig('fixed'), fixtureDependencies({
      failScenarioId: 'rook-pawn-opening-76-34-26-84',
    }));
    expect(result.summary).toMatchObject({ targetPositionCount: QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length, completedPositionCount: QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length - 1, errorCount: 1,
      selectedActionChangedPositionCount: QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length - 1 });
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
    expect(result.summary).toMatchObject({ targetPositionCount: QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length, completedPositionCount: 0, errorCount: QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length,
      selectedActionChangedPositionCount: 0 });
    const unavailable = { baseline: null, candidate: null, difference: null, percentChange: null };
    expect(result.summary.metrics).toEqual({ completedDepth: unavailable, searchPositionCount: unavailable,
      cutoffCount: unavailable, skippedActionCount: unavailable, elapsedMilliseconds: unavailable });
    expect(result.positions).toHaveLength(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length);
    expect(result.positions.every((position) => !position.ok && position.trials.length === 1 &&
      position.trials[0].error?.includes('fixture all failure'))).toBe(true);
    const output: string[] = [];
    expect(runSuiteComparisonCli(['fixed'], dependencies, scenarios, line => output.push(line))).toBe(1);
    expect(output[0]).toContain(`正常完了=0; エラー=${QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length}`);
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
    expect(text).toMatch(/^A\/B 探索設定スイート比較\nmode=fixed; timeLimitMilliseconds=1000; maxDepth=4/);
    expect(text).toContain('局面別の本測定:');
    expect(text).toContain('standard-hirate: phase=opening; sideToMove=sente; 手=baseline-action→candidate-action');
  });

  it('retains phase and actual side to move in JSON and text, including gote scenarios', () => {
    const result = runSuiteComparison(defaultSuiteComparisonConfig('fixed'), fixtureDependencies());
    expect(result.positions.map(position => [position.phase, position.sideToMove]))
      .toEqual(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map(scenario => [scenario.phase, scenario.sideToMove]));
    const gote = result.positions.find(position => position.sideToMove === 'gote');
    expect(gote).toMatchObject({ ok: true, phase: 'endgame', sideToMove: 'gote' });
    expect(formatSuiteComparison(result)).toContain('phase=endgame; sideToMove=gote');
    expect(JSON.parse(serializeSuiteComparison(result)).positions.find((position: { sideToMove: string }) => position.sideToMove === 'gote'))
      .toMatchObject({ phase: 'endgame', sideToMove: 'gote' });
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
    expect(config).toMatchObject({ mode: 'timed', timeLimitMilliseconds: 1000, maxDepth: 4,
      baseline: { id: 'killer-off', setting: { maxTacticalDepth: 1, moveOrdering: 'original', killerMoves: false } },
      candidate: { id: 'killer-on', setting: { maxTacticalDepth: 1, moveOrdering: 'original', killerMoves: true } } });
    const result = runSuiteComparison(config, fixtureDependencies(), [QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS[0]]);
    expect(result.positions[0].ok).toBe(true);
  });

  it('parses killer timed budgets in either option order and preserves the legacy timed defaults', () => {
    expect(parseKillerMoveSuiteComparisonCliArguments([])).toEqual({ mode: 'timed', timeLimitMilliseconds: 1000, maxDepth: 4 });
    expect(parseKillerMoveSuiteComparisonCliArguments(['timed'])).toEqual({ mode: 'timed', timeLimitMilliseconds: 1000, maxDepth: 4 });
    expect(parseKillerMoveSuiteComparisonCliArguments(['timed', '--time-limit-ms', '5000', '--max-depth', '4']))
      .toEqual({ mode: 'timed', timeLimitMilliseconds: 5000, maxDepth: 4 });
    expect(parseKillerMoveSuiteComparisonCliArguments(['--max-depth', '4', '--time-limit-ms', '10000', 'timed']))
      .toEqual({ mode: 'timed', timeLimitMilliseconds: 10000, maxDepth: 4 });
    expect(parseSuiteComparisonMode([])).toBe('timed');
    expect(parseSuiteComparisonMode(['fixed'])).toBe('fixed');
    expect(parseSuiteComparisonMode(['timed'])).toBe('timed');
  });

  it('rejects malformed, duplicate, unknown, and fixed-mode timed-only killer CLI arguments before running', () => {
    const invalid = [
      ['timed', '--time-limit-ms'], ['timed', '--time-limit-ms', '0'], ['timed', '--time-limit-ms', '-1'],
      ['timed', '--time-limit-ms', '1.5'], ['timed', '--time-limit-ms', 'NaN'], ['timed', '--time-limit-ms', 'Infinity'],
      ['timed', '--time-limit-ms', 'word'], ['timed', '--time-limit-ms', '5', '--time-limit-ms', '6'],
      ['timed', '--max-depth', '0'], ['timed', '--max-depth', '-1'], ['timed', '--max-depth', '1.5'],
      ['timed', '--max-depth', 'NaN'], ['timed', '--max-depth', 'Infinity'], ['timed', '--max-depth', 'word'],
      ['timed', '--max-depth', '4', '--max-depth', '5'], ['timed', '--unexpected'],
      ['fixed', '--time-limit-ms', '5000'], ['fixed', '--max-depth', '4'],
    ];
    for (const args of invalid) expect(() => parseKillerMoveSuiteComparisonCliArguments(args)).toThrow('Usage:');
    let ran = false;
    const output: string[] = [];
    expect(runKillerMoveSuiteComparisonCli(['fixed', '--max-depth', '4'], { trialRunner: () => {
      ran = true;
      throw new Error('must not run');
    } }, [], line => output.push(line))).toBe(1);
    expect(ran).toBe(false);
    expect(output).toEqual([expect.stringContaining('Timed-only options cannot be used')]);
  });

  it('propagates each requested timed budget identically to killer OFF and ON without mutating source settings', () => {
    const calls: Array<{ killerMoves: boolean | undefined; timed: unknown; input: unknown; setting: Record<string, unknown> }> = [];
    const dependencies: SuiteComparisonDependencies = {
      trialRunner: (input, mode, setting, _dependencies, _capture, timed) => {
        calls.push({ killerMoves: setting.killerMoves, timed, input: structuredClone(input), setting: { ...setting } });
        const action = getLegalActions(input)[0] ?? null;
        return { setting, search: { depth: 3, selectedAction: action, selectedEvaluation: 0, elapsedMilliseconds: 1,
          visitedPositionCount: 1, cutoffCount: 1, skippedActionCount: 1 } as SearchResult, pv: ['fixture-action'] };
      },
    };
    for (const [milliseconds, maxDepth] of [[5000, 4], [10000, 4]] as const) {
      calls.length = 0;
      const output: string[] = [];
      expect(runKillerMoveSuiteComparisonCli(['timed', '--time-limit-ms', String(milliseconds), '--max-depth', String(maxDepth)],
        dependencies, [QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS[0]], line => output.push(line))).toBe(0);
      expect(calls).toHaveLength(22);
      expect(calls.map((call) => call.timed)).toEqual(Array(22).fill({ timeLimitMilliseconds: milliseconds, maxDepth }));
      expect(calls.filter((call) => call.killerMoves === false)).toHaveLength(11);
      expect(calls.filter((call) => call.killerMoves === true)).toHaveLength(11);
      expect(calls.map((call) => ({ ...call.setting, killerMoves: undefined }))).toEqual(Array(22).fill({ maxTacticalDepth: 1, moveOrdering: 'original', killerMoves: undefined }));
      const json = JSON.parse(output.at(-1)!.slice('JSON '.length));
      expect(json.config).toMatchObject({ mode: 'timed', timeLimitMilliseconds: milliseconds, maxDepth });
      expect(output[0]).toContain(`timeLimitMilliseconds=${milliseconds}; maxDepth=${maxDepth}`);
    }
  });

  it('aggregates only measurement completed depths in deterministic ascending distributions and emits them in text and JSON', () => {
    const calls = new Map<boolean, number>();
    const result = runSuiteComparison({ ...defaultKillerMoveSuiteComparisonConfig('timed'), timeLimitMilliseconds: 5000, maxDepth: 4 }, {
      trialRunner: (input, _mode, setting) => {
        const killerMoves = setting.killerMoves === true;
        const call = (calls.get(killerMoves) ?? 0) + 1;
        calls.set(killerMoves, call);
        const measurement = call - 3;
        const depth = measurement === 2 ? null : killerMoves ? (measurement % 2 === 0 ? 3 : 2) : (measurement % 2 === 0 ? 2 : 3);
        return { setting, search: { depth, selectedAction: getLegalActions(input)[0] ?? null, selectedEvaluation: 0,
          elapsedMilliseconds: 1, visitedPositionCount: 1, cutoffCount: 1, skippedActionCount: 1 } as unknown as SearchResult, pv: ['fixture-action'] };
      },
    }, [QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS[0]]);
    expect(result.positions[0].baseline?.completedDepthDistribution).toEqual([{ depth: 2, count: 3 }, { depth: 3, count: 4 }]);
    expect(result.positions[0].candidate?.completedDepthDistribution).toEqual([{ depth: 2, count: 4 }, { depth: 3, count: 3 }]);
    const text = formatSuiteComparison(result);
    expect(text).toContain('深さ分布=depth 2×3、depth 3×4→depth 2×4、depth 3×3');
    expect(JSON.parse(serializeSuiteComparison(result)).positions[0].baseline.completedDepthDistribution)
      .toEqual([{ depth: 2, count: 3 }, { depth: 3, count: 4 }]);
  });

  it('fails fatal duplicate scenario configuration before beginning a suite', () => {
    const scenario: SelfPlayScenario = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS[0];
    expect(() => runSuiteComparison(defaultSuiteComparisonConfig('fixed'), fixtureDependencies(), [scenario, scenario])).toThrow('Scenario IDs must be unique');
    expect(() => runSuiteComparison({ ...defaultSuiteComparisonConfig('fixed'),
      candidate: { id: 'invalid', setting: { maxTacticalDepth: 3, moveOrdering: 'material' } as never },
    }, fixtureDependencies(), [scenario])).toThrow('candidate tactical depth');
  });
});
