// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { QUIESCENCE_BENCHMARK_POSITIONS as positions, type BenchmarkPosition } from '../../scripts/benchmarks/quiescencePositions';
import { describeNumbers, formatRepeatedCase, formatRepeatedTrial, parseRepeatedModes, rawJson,
  runRepeatedCase, runRepeatedCli, runRepeatedSuite, summarizeRepeatedCase, trialOrder,
  type RepeatedDependencies } from '../../scripts/benchmarks/quiescenceOrderingRepeated';
import { statisticKeys } from '../../scripts/benchmarks/quiescenceOrderingSuite';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch,
  cloneBoardState, executeLegalAction, getLegalActions, type AlphaBetaSearchResult,
  type TimeLimitedIterativeDeepeningAlphaBetaSearchResult } from '../domain/shogi';
import { evaluateSearchPositionBreakdown } from '../domain/shogi/twoPlyMinimaxAi';
import type { BoardState } from '../types/shogi';

const ended: BenchmarkPosition = { ...positions[0], create: () => ({ ...positions[0].create(), status: 'ended',
  result: { winner: 'sente', loser: 'gote', endReason: 'resignation' } }) };
const clock = () => 0;
const dependencies: RepeatedDependencies = { clock, measurementClock: clock };

// Legal PV fixtures, not a second search implementation: simply replay the
// first/last legal action (or a capture at the root) and evaluate that leaf.
function pass(state: BoardState, depth: number, variant: 'first' | 'last' | 'capture' = 'first'): AlphaBetaSearchResult {
  let leaf = cloneBoardState(state);
  const principalVariation: AlphaBetaSearchResult['principalVariation'] = [];
  for (let i = 0; i < depth; i++) {
    const actions = getLegalActions(leaf);
    const action = variant === 'last' ? actions.at(-1) : variant === 'capture' && i === 0
      ? actions.find(a => a.kind === 'move' && leaf.squares[a.to.row][a.to.col].piece) ?? actions[0] : actions[0];
    if (!action) break;
    principalVariation.push(action);
    const execution = executeLegalAction(leaf, action);
    if (execution.type !== 'applied') throw new Error('fixture PV');
    leaf = execution.state;
  }
  const evaluationBreakdown = evaluateSearchPositionBreakdown(leaf, state.turn);
  const count = principalVariation.length ? depth + 1 : 0;
  return { depth, principalVariation, selectedAction: principalVariation[0] ?? null,
    selectedEvaluation: principalVariation.length ? evaluationBreakdown.total : null, evaluationBreakdown,
    rootLegalActionCount: getLegalActions(state).length, elapsedMilliseconds: 0,
    visitedPositionCount: count, cutoffCount: 0, skippedActionCount: 0,
    quiescenceLeafCount: 0, quiescenceVisitedPositionCount: 0, quiescenceCutoffCount: 0, quiescenceSkippedActionCount: 0 };
}
function timed(state: BoardState, depth: number, variant: 'first' | 'last' = 'first'): TimeLimitedIterativeDeepeningAlphaBetaSearchResult {
  const iterations = Array.from({ length: depth }, (_, i) => pass(state, i + 1, variant));
  return { ...iterations.at(-1)!, iterations, requestedMaxDepth: 4, completedDepth: depth, timedOut: depth < 4,
    ...Object.fromEntries(statisticKeys.map(([key, sum]) => [sum, iterations.reduce((n, r) => n + r[key], 0)])) as Record<typeof statisticKeys[number][1], number>,
  };
}
function expectFrozen(value: unknown): void {
  if (value && typeof value === 'object') {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(expectFrozen);
  }
}

describe('repeated ordering schedule and isolation', () => {
  it('runs 3+8 per setting on six unchanged positions, both modes, with independent frozen snapshots', () => {
    const snapshots: BoardState[] = [];
    const fixedSearch: NonNullable<RepeatedDependencies['fixedSearch']> = (state, depth, evaluation, now, options) => {
      expectFrozen(state); snapshots.push(state);
      expect(depth).toBe(3); expect(evaluation).toBeUndefined(); expect(now).toBe(clock);
      expect(options?.moveOrdering).toBe('standard');
      const unit = Math.floor((snapshots.length - 1) / 22);
      const call = (snapshots.length - 1) % 22;
      expect(options?.quiescence).toEqual({ maxTacticalDepth: unit % 2 + 1,
        moveOrdering: trialOrder(Math.floor(unit / 2), (unit % 2 + 1) as 1 | 2,
          Math.floor((call < 6 ? call : call - 6) / 2))[call % 2] });
      return pass(state, depth);
    };
    const timedSearch: NonNullable<RepeatedDependencies['timedSearch']> = (state, depth, milliseconds, evaluation, now, options) => {
      expectFrozen(state); snapshots.push(state);
      expect(depth).toBe(4); expect(milliseconds).toBe(1000); expect(evaluation).toBeUndefined(); expect(now).toBe(clock);
      expect(options?.moveOrdering).toBe('standard');
      const unit = Math.floor((snapshots.length - 265) / 22);
      const call = (snapshots.length - 265) % 22;
      expect(options?.quiescence).toEqual({ maxTacticalDepth: unit % 2 + 1,
        moveOrdering: trialOrder(Math.floor(unit / 2), (unit % 2 + 1) as 1 | 2,
          Math.floor((call < 6 ? call : call - 6) / 2))[call % 2] });
      return timed(state, 4);
    };
    const callback = vi.fn(), trialCallback = vi.fn();
    const cases = runRepeatedSuite(['fixed', 'timed'], { ...dependencies, fixedSearch, timedSearch },
      positions.map(p => ({ ...p, create: ended.create })), callback, trialCallback);
    expect(cases).toHaveLength(24); expect(cases.every(c => c.ok)).toBe(true);
    expect(snapshots).toHaveLength(528); expect(new Set(snapshots).size).toBe(528);
    for (const key of ['squares', 'senteHand', 'positionHistory'] as const) expect(new Set(snapshots.map(s => s[key])).size).toBe(528);
    expect(callback).toHaveBeenCalledTimes(24); expect(trialCallback).toHaveBeenCalledTimes(528);
    for (const entry of cases) {
      expect(entry.trials.filter(t => t.phase === 'warmup')).toHaveLength(6);
      const samples = entry.trials.filter(t => t.phase === 'measurement');
      for (const ordering of ['original', 'material']) {
        expect(samples.filter(t => t.ordering === ordering)).toHaveLength(8);
        expect(samples.filter(t => t.ordering === ordering && t.orderIndex === 0)).toHaveLength(4);
      }
      expect(samples.filter(t => t.orderIndex === 0).map(t => t.ordering)).toEqual(
        Array.from({ length: 8 }, (_, i) => trialOrder(positions.findIndex(p => p.id === entry.position.id), entry.extension, i)[0]));
    }
  });
  it('alternates initial order in both position and extension dimensions, without randomness', () => {
    expect(trialOrder(0, 1, 0)).toEqual(['original', 'material']);
    expect(trialOrder(0, 2, 0)).toEqual(['material', 'original']);
    expect(trialOrder(1, 1, 0)).toEqual(['material', 'original']);
    expect(trialOrder(1, 2, 0)).toEqual(['original', 'material']);
    expect(trialOrder(0, 1, 1)).toEqual(['material', 'original']);
  });
  it('gives every real timed API its own deadline with an advancing fake clock', () => {
    let now = 0;
    const entry = runRepeatedCase(ended, 0, 'timed', 1, { clock: () => (now += 600), measurementClock: clock });
    expect(entry.ok).toBe(true); expect(entry.trials).toHaveLength(22);
    for (const trial of entry.trials) {
      const result = trial.search as TimeLimitedIterativeDeepeningAlphaBetaSearchResult;
      // Fake-clock consequence, never an expectation on real runtime/depth.
      expect(result.completedDepth).toBe(1); expect(result.timedOut).toBe(true);
      expect(result.elapsedMilliseconds).toBe(2400);
      expect(result.iterations).toHaveLength(1);
    }
  });
  it.each([['fixed', ['fixed']], ['timed', ['timed']], ['both', ['fixed', 'timed']]])('selects CLI %s', (arg, modes) => {
    expect(parseRepeatedModes([arg as string])).toEqual(modes);
    const output: string[] = [];
    expect(runRepeatedCli([arg as string], dependencies, [ended], line => output.push(line))).toBe(0);
    expect(output.filter(line => line.startsWith('SUMMARY'))).toHaveLength((modes as string[]).length * 2);
  });
  it('defaults to both and rejects invalid CLI arguments with exit 1', () => {
    expect(parseRepeatedModes([])).toEqual(['fixed', 'timed']);
    for (const args of [['bad'], ['fixed', 'timed']]) {
      expect(parseRepeatedModes.bind(null, args)).toThrow('measure:quiescence-ordering-repeated');
      expect(runRepeatedCli(args, dependencies, [], () => {})).toBe(1);
    }
  });
});

describe('statistics without discarded samples', () => {
  it.each([
    [[0], { median: 0, q1: 0, q3: 0, iqr: 0, min: 0, max: 0 }],
    [[2, 0], { median: 1, q1: 0.5, q3: 1.5, iqr: 1, min: 0, max: 2 }],
    [[3, 1, 2], { median: 2, q1: 1.5, q3: 2.5, iqr: 1, min: 1, max: 3 }],
    [[1, 2, 3, 4, 5, 6, 7, 1000], { median: 4.5, q1: 2.75, q3: 6.25, iqr: 3.5, min: 1, max: 1000 }],
    [[-2, -2, -2, -2], { median: -2, q1: -2, q3: -2, iqr: 0, min: -2, max: -2 }],
  ])('uses type7 interpolation for %j', (values, expected) => {
    const before = [...values];
    expect(describeNumbers(values)).toEqual({ count: values.length, ...expected });
    expect(values).toEqual(before);
  });
  it.each([[], [Infinity], [-Infinity], [NaN]].map(values => ({ values })))('rejects invalid samples $values', ({ values }) => {
    expect(() => describeNumbers(values)).toThrow('有限な標本');
  });
  it('excludes warmup outliers, retains every measurement, and reports median percentage', () => {
    let ticks = 0, calls = 0, duration = 0, current = 0;
    const entry = runRepeatedCase(ended, 0, 'fixed', 1, {
      clock, measurementClock: () => ++ticks % 2 ? current : (current += duration),
      fixedSearch: (...args) => {
        duration = calls++ < 6 ? 99999 : args[4]?.quiescence?.moveOrdering === 'original' ? 2 : 3;
        return analyzeAlphaBetaSearch(...args);
      },
    });
    expect(entry.ok).toBe(true);
    const summary = summarizeRepeatedCase(entry)!;
    expect(summary.settings.map(s => s.apiMilliseconds)).toEqual([2, 3].map(v => ({ count: 8, median: v, q1: v, q3: v, iqr: 0, min: v, max: v })));
    expect(summary.materialMedianChangePercent).toBe(50);
    expect(summarizeRepeatedCase(runRepeatedCase(ended, 0, 'fixed', 1, dependencies))!.materialMedianChangePercent).toBeNull();
  });
  it('separates deepest and completed totals, distributions, frequencies and paired depths without requiring timed equality', () => {
    const fixtureState = positions[4].create();
    const fixtures = [1, 2, 3, 4].map(depth => timed(fixtureState, depth));
    const perMode = { original: 0, material: 0 };
    const measuredDepths = { original: [1, 2, 3, 4, 1, 2, 3, 4], material: [2, 2, 2, 4, 1, 3, 4, 3] };
    const entry = runRepeatedCase(positions[4], 4, 'timed', 2, { ...dependencies,
      timedSearch: (_s, _d, _ms, _e, _c, options) => {
        const ordering = options!.quiescence!.moveOrdering as 'original' | 'material';
        const index = perMode[ordering]++;
        return structuredClone(fixtures[(index < 3 ? 4 : measuredDepths[ordering][index - 3]) - 1]);
      },
    });
    expect(entry.ok).toBe(true);
    const summary = summarizeRepeatedCase(entry)!;
    expect(summary.paired).toMatchObject({ deeper: 3, same: 3, shallower: 2 });
    expect(summary.settings[0].depthDistribution.map(v => [v.value, v.count])).toEqual([['1', 2], ['2', 2], ['3', 2], ['4', 2]]);
    expect(summary.settings[1].depthDistribution.map(v => [v.value, v.count])).toEqual([['2', 3], ['4', 2], ['1', 1], ['3', 2]]);
    for (const setting of summary.settings) {
      expect(setting.count).toBe(8); expect(setting.maxDepthReached).toBe(2); expect(setting.timedOut).toBe(6);
      expect(setting.actions.reduce((n, f) => n + f.count, 0)).toBe(8);
      expect(setting.evaluations.reduce((n, f) => n + f.count, 0)).toBe(8);
      const depths = measuredDepths[setting.ordering];
      expect(setting.deepest.visitedPositionCount).toEqual(describeNumbers(depths.map(d => fixtures[d - 1].visitedPositionCount)));
      expect(setting.completedTotals!.visitedPositionCount).toEqual(describeNumbers(depths.map(d => fixtures[d - 1].totalVisitedPositionCount)));
      expect(setting.completedTotals!.quiescenceVisitedPositionCount).toEqual(describeNumbers(depths.map(d => fixtures[d - 1].totalQuiescenceVisitedPositionCount)));
      const expectedScores = new Map<string, number>();
      for (const d of depths) {
        const value = fixtures[d - 1].selectedEvaluation!;
        const label = value > 0 ? `+${value}` : String(value);
        expectedScores.set(label, (expectedScores.get(label) ?? 0) + 1);
      }
      expect(setting.evaluations.map(f => [f.value, f.count])).toEqual([...expectedScores]);
      expect(setting.actions).toHaveLength(1); expect(setting.actions[0].count).toBe(8);
    }
  });
});

describe('validation, failure preservation and display', () => {
  it.each([42, 'bad result', null])('retains invalid primitive %j, excludes its unit and continues the CLI', invalid => {
    let calls = 0;
    const output: string[] = [];
    expect(runRepeatedCli(['fixed'], { ...dependencies, fixedSearch: (...args) =>
      calls++ === 0 ? invalid as unknown as AlphaBetaSearchResult : analyzeAlphaBetaSearch(...args),
    }, [ended], line => output.push(line))).toBe(1);
    const failedTrial = JSON.parse(output.find(line => line.startsWith('TRIAL'))!.slice(6));
    expect(failedTrial).toMatchObject({ ok: false, search: invalid });
    expect(output.filter(line => line.startsWith('SUMMARY'))).toHaveLength(1);
    expect(output.at(-1)).toContain('"failed":1');
  });
  it('counts multiple moves/evaluations and changes from the first timed measurement', () => {
    const state = positions[4].create(), fixtures = [timed(state, 3), timed(state, 3, 'last')];
    expect(fixtures[0].selectedAction).not.toEqual(fixtures[1].selectedAction);
    expect(fixtures[0].selectedEvaluation).not.toBe(fixtures[1].selectedEvaluation);
    const calls = { original: 0, material: 0 };
    const entry = runRepeatedCase(positions[4], 4, 'timed', 1, { ...dependencies,
      timedSearch: (_s, _d, _ms, _e, _c, options) => {
        const index = calls[options!.quiescence!.moveOrdering as 'original' | 'material']++ - 3;
        return structuredClone(fixtures[[1, 3, 5].includes(index) ? 1 : 0]);
      },
    });
    expect(entry.ok).toBe(true);
    for (const setting of summarizeRepeatedCase(entry)!.settings) {
      expect(setting.actions.map(f => f.count)).toEqual([5, 3]);
      expect(setting.evaluations.map(f => f.count)).toEqual([5, 3]);
      expect(setting.changesFromFirst).toEqual({ selectedAction: 3, evaluation: 3, pv: 3 });
    }
  });
  it.each([0, 3, 6, 13])('retains a failure at call %i and continues independent units with exit 1', failedCall => {
    let calls = 0;
    const output: string[] = [];
    const status = runRepeatedCli(['fixed'], { ...dependencies, fixedSearch: (...args) => {
      if (calls++ === failedCall) throw new Error('fixture failure');
      return analyzeAlphaBetaSearch(...args);
    } }, [ended, { ...ended, id: 'next' }], line => output.push(line));
    expect(status).toBe(1);
    const incomplete = JSON.parse(output.find(s => s.startsWith('INCOMPLETE'))!.slice('INCOMPLETE '.length));
    expect(incomplete).toMatchObject({ position: 'initial', mode: 'fixed', extension: 1, attempted: failedCall + 1, summary: null });
    expect(incomplete.error).toContain(`phase=${failedCall < 6 ? 'warmup' : 'measurement'}`);
    expect(incomplete.error).toContain(`trial=${Math.floor((failedCall < 6 ? failedCall : failedCall - 6) / 2) + 1}`);
    expect(incomplete.error).toMatch(/ordering=(original|material)/);
    const raw = output.filter(s => s.startsWith('TRIAL')).map(s => JSON.parse(s.slice(6)));
    expect(raw.filter(t => t.position === 'initial' && t.extension === 1)).toHaveLength(failedCall + 1);
    expect(raw.filter(t => !t.ok)).toHaveLength(1);
    expect(output.filter(s => s.startsWith('SUMMARY'))).toHaveLength(3);
    expect(output.at(-1)).toContain('"failed":1');
  });
  it.each(['fixed', 'timed'] as const)('validates %s warmup and retains invalid returned raw data', mode => {
    const entry = runRepeatedCase(ended, 0, mode, 1, { ...dependencies,
      fixedSearch: (...args) => ({ ...analyzeAlphaBetaSearch(...args), evaluationBreakdown: { ...analyzeAlphaBetaSearch(...args).evaluationBreakdown, material: 17 } }),
      timedSearch: (...args) => ({ ...analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(...args), totalVisitedPositionCount: 1 }),
    });
    expect(entry.ok).toBe(false); expect(entry.trials).toHaveLength(1);
    expect(entry.trials[0].search).toBeDefined(); expect(entry.error).toContain('phase=warmup trial=1 ordering=original');
    expect(summarizeRepeatedCase(entry)).toBeNull(); expect(formatRepeatedCase(entry)).toContain('"summary":null');
  });
  it('rejects frozen mutation attempts and detects original input mutation with raw results retained', () => {
    const frozen = runRepeatedCase(ended, 0, 'fixed', 1, { ...dependencies, fixedSearch: (...args) => {
      args[0].senteHand.push({ id: 'bad', type: 'gold', player: 'sente' });
      return analyzeAlphaBetaSearch(...args);
    } });
    expect(frozen.ok).toBe(false); expect(frozen.error).toContain('phase=warmup trial=1 ordering=original');
    const input = ended.create();
    const source = runRepeatedCase({ ...ended, create: () => input }, 0, 'fixed', 1, { ...dependencies, fixedSearch: (...args) => {
      input.turn = 'gote'; return analyzeAlphaBetaSearch(...args);
    } });
    expect(source.ok).toBe(false); expect(source.error).toContain('入力局面が変更されました');
    expect(source.trials[0].search).toBeDefined();
  });
  it('rejects non-deterministic fixed statistics within a mode even during warmup', () => {
    const fixture = pass(positions[0].create(), 3);
    let calls = 0;
    const entry = runRepeatedCase(positions[0], 0, 'fixed', 1, { ...dependencies, fixedSearch: () => ({ ...structuredClone(fixture), visitedPositionCount: fixture.visitedPositionCount + calls++ }) });
    expect(entry.ok).toBe(false); expect(entry.error).toContain('非決定的');
    expect(entry.trials).toHaveLength(3);
  });
  it('permits equal-score different moves/PVs across ordering modes and records all eight pairs', () => {
    const state = positions[0].create();
    const a = pass(state, 3, 'first'), b = pass(state, 3, 'last');
    expect(a.selectedEvaluation).toBe(b.selectedEvaluation); expect(a.selectedAction).not.toEqual(b.selectedAction);
    const entry = runRepeatedCase(positions[0], 0, 'fixed', 1, { ...dependencies, fixedSearch: (_s, _d, _e, _c, options) =>
      structuredClone(options!.quiescence!.moveOrdering === 'original' ? a : b) });
    expect(entry.ok).toBe(true);
    expect(summarizeRepeatedCase(entry)!.paired).toMatchObject({ selectedActionChanges: 8, pvChanges: 8, evaluationChanges: 0 });
    expect(summarizeRepeatedCase(entry)!.settings.map(s => s.changesFromFirst)).toEqual(Array(2).fill({ selectedAction: 0, evaluation: 0, pv: 0 }));
  });
  it('requires fixed equal scores but allows different valid evaluations and PVs in timed', () => {
    const position = positions[4], state = position.create();
    const a = pass(state, 3), b = pass(state, 3, 'capture');
    expect(a.selectedEvaluation).not.toBe(b.selectedEvaluation);
    const fixed = runRepeatedCase(position, 0, 'fixed', 1, { ...dependencies, fixedSearch: (_s, _d, _e, _c, options) =>
      structuredClone(options!.quiescence!.moveOrdering === 'original' ? a : b) });
    expect(fixed.ok).toBe(false); expect(fixed.error).toContain('固定深さ評価が一致しません');
    const timedA = timed(state, 1), timedB = timed(state, 2, 'last');
    expect(timedA.selectedEvaluation).not.toBe(timedB.selectedEvaluation);
    const result = runRepeatedCase(position, 0, 'timed', 1, { ...dependencies, timedSearch: (_s, _d, _ms, _e, _c, options) =>
      structuredClone(options!.quiescence!.moveOrdering === 'original' ? timedA : timedB) });
    expect(result.ok).toBe(true); expect(summarizeRepeatedCase(result)!.paired.evaluationChanges).toBe(8);
  });
  it('validates every completed timed iteration, not only the deepest', () => {
    const fixture = timed(positions[0].create(), 4);
    fixture.iterations[0].evaluationBreakdown = { ...fixture.iterations[0].evaluationBreakdown, material: 123 };
    const entry = runRepeatedCase(positions[0], 0, 'timed', 1, { ...dependencies, timedSearch: () => structuredClone(fixture) });
    expect(entry.ok).toBe(false); expect(entry.error).toContain('評価');
    expect(entry.trials[0].search).toEqual(fixture);
  });
  it.each(['win', 'loss', 'draw'] as const)('displays %s including infinities, zero, no action and empty PV', kind => {
    const position: BenchmarkPosition = { ...ended, create: () => ({ ...ended.create(), result: kind === 'draw'
      ? { winner: null, loser: null, endReason: 'repetition' }
      : { winner: kind === 'win' ? 'sente' : 'gote', loser: kind === 'win' ? 'gote' : 'sente', endReason: 'resignation' } }) };
    const entry = runRepeatedCase(position, 0, 'fixed', 1, dependencies);
    expect(entry.ok).toBe(true);
    const line = formatRepeatedTrial(entry, entry.trials[0]);
    expect(line).toContain('手なし'); expect(line).toContain('手順なし');
    expect(line).toContain(`"senteEvaluation":"${kind === 'win' ? '+∞' : kind === 'loss' ? '-∞' : '0'}"`);
    expect(line).toContain(kind === 'draw' ? '"total":0' : `"total":"${kind === 'win' ? 'Infinity' : '-Infinity'}"`);
    expect(JSON.parse(rawJson([Infinity, -Infinity, 0, null, []]))).toEqual(['Infinity', '-Infinity', 0, null, []]);
  });
  it('rejects duplicated position IDs and reports creation failures', () => {
    expect(() => runRepeatedSuite(['fixed'], dependencies, [ended, ended])).toThrow('局面ID重複');
    const entry = runRepeatedCase({ ...ended, create: () => { throw new Error('create failed'); } }, 0, 'fixed', 2);
    expect(entry.error).toContain('position=initial mode=fixed extension=2 phase=setup trial=0 ordering=none');
  });
});
