// @vitest-environment node
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createSelfPlayParticipants, gameSignature, runSelfPlayBenchmark, runSelfPlayCli,
  SELF_PLAY_CONFIG, selfPlayJson, summarizeObservations, summarizeSelfPlay,
  type SelfPlayBenchmarkDependencies, type SelfPlayBenchmarkSettings } from '../../scripts/benchmarks/quiescenceOrderingSelfPlay';
import { statisticKeys } from '../../scripts/benchmarks/quiescenceOrderingSuite';
import { createInitialBoardState, type BoardState } from '../types/shogi';
import * as boardTypes from '../types/shogi';
import { executeLegalAction, getLegalActions, type LegalAction } from '../domain/shogi/legalActions';
import { runRepeatedPairedSelfPlayMatches } from '../domain/shogi/repeatedPairedSelfPlayMatches';
import * as repeated from '../domain/shogi/repeatedPairedSelfPlayMatches';
import * as alphaBeta from '../domain/shogi/twoPlyAlphaBetaAi';
import { evaluateSearchPositionBreakdown } from '../domain/shogi/twoPlyMinimaxAi';
import type { SelfPlaySearchResult } from '../domain/shogi/selfPlayGame';
import type { PairedSelfPlayOutcome } from '../domain/shogi/pairedSelfPlayMatch';

afterEach(() => vi.restoreAllMocks());
const clock = () => 0;

// Legal one-action observations with deliberately distinct per-iteration values.
// No real deadline, waiting, or performance/node-count acceptance thresholds.
function searchFixture(state: BoardState, material = false): alphaBeta.TimeLimitedIterativeDeepeningAlphaBetaSearchResult {
  const action = getLegalActions(state)[0];
  const next = executeLegalAction(state, action);
  if (next.type !== 'applied') throw new Error('fixture must apply');
  const evaluationBreakdown = evaluateSearchPositionBreakdown(next.state, state.turn);
  const completedDepth = material ? 4 : 2;
  const iterations = Array.from({ length: completedDepth }, (_, index) => ({
    selectedAction: action, selectedEvaluation: evaluationBreakdown.total, evaluationBreakdown,
    principalVariation: [action], depth: index + 1, elapsedMilliseconds: 1,
    rootLegalActionCount: getLegalActions(state).length,
    visitedPositionCount: index + 10, cutoffCount: index + 2, skippedActionCount: index + 3,
    quiescenceLeafCount: index + 4, quiescenceVisitedPositionCount: index + 5,
    quiescenceCutoffCount: index + 6, quiescenceSkippedActionCount: index + 7,
  }));
  return { ...iterations.at(-1)!, iterations, completedDepth, requestedMaxDepth: 4,
    timedOut: !material, resultSource: 'completed-iteration', elapsedMilliseconds: material ? 7 : 5,
    ...Object.fromEntries(statisticKeys.map(([key, sum]) => [sum, iterations.reduce((n, r) => n + r[key], 0)])) as
      Record<typeof statisticKeys[number][1], number>,
  };
}
const fixtureSearch: NonNullable<SelfPlayBenchmarkDependencies['search']> = (state, _depth, _time, _evaluation, _clock, options) =>
  searchFixture(state, options?.quiescence?.moveOrdering === 'material');
const shortRunner: NonNullable<SelfPlayBenchmarkDependencies['runner']> = options =>
  runRepeatedPairedSelfPlayMatches({ ...options, maxPlies: 2 });
const dependencies: SelfPlayBenchmarkDependencies = { search: fixtureSearch, clock, runner: shortRunner };
const sample = () => runSelfPlayBenchmark(dependencies);

describe('self-play benchmark wiring', () => {
  it('uses one frozen common configuration and differs only in quiescence ordering', () => {
    const before = structuredClone(SELF_PLAY_CONFIG);
    const state = createInitialBoardState(), stateBefore = structuredClone(state);
    const returned = searchFixture(state);
    const search = vi.fn(() => returned);
    const { a, b } = createSelfPlayParticipants({ search, clock });
    expectTypeOf(a.settings).toEqualTypeOf<SelfPlayBenchmarkSettings>();
    expectTypeOf(a.search(state, a.settings)).toEqualTypeOf<SelfPlaySearchResult>();
    // Direct result identity preserves the existing boundary without lossy conversion.
    search.mockClear();
    expect(a.search(state, a.settings)).toBe(returned);
    expect(b.search(state, b.settings)).toBe(returned);
    expect(a.search).toBe(b.search);
    expect(a.settings).toEqual({ ...before.search, quiescenceMoveOrdering: 'original' });
    expect(b.settings).toEqual({ ...before.search, quiescenceMoveOrdering: 'material' });
    expect(Object.isFrozen(a.settings)).toBe(true); expect(Object.isFrozen(b.settings)).toBe(true);
    expect(search.mock.calls).toEqual(['original', 'material'].map(moveOrdering => [state, 4, 100,
      { coefficients: { material: 1, pieceSquare: 1, kingSafety: 1, undefendedPieceSafety: 1 } }, clock,
      { moveOrdering: 'standard', quiescence: { maxTacticalDepth: 1, moveOrdering } },
    ]));
    expect(state).toEqual(stateBefore); expect(SELF_PLAY_CONFIG).toEqual(before);
  });

  it('connects the default search API and returns its full object unchanged', () => {
    const state = createInitialBoardState(), result = searchFixture(state);
    const spy = vi.spyOn(alphaBeta, 'analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch').mockReturnValue(result);
    const { a } = createSelfPlayParticipants({ clock });
    expect(a.search(state, a.settings)).toBe(result);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('passes three pairs, 120 ply and the standard initial position to the existing default runner', () => {
    const expected = sample();
    const initial = createInitialBoardState();
    const factory = vi.spyOn(boardTypes, 'createInitialBoardState').mockReturnValue(initial);
    const spy = vi.spyOn(repeated, 'runRepeatedPairedSelfPlayMatches').mockReturnValue(expected);
    expect(runSelfPlayBenchmark({ search: fixtureSearch })).toBe(expected);
    expect(spy).toHaveBeenCalledTimes(1);
    const options = spy.mock.calls[0][0];
    expect(factory).toHaveBeenCalledExactlyOnceWith();
    expect(options.initialState).toBe(initial);
    expect(options.pairCount).toBe(3); expect(options.maxPlies).toBe(120);
    expect(options.a.settings).toEqual({ ...SELF_PLAY_CONFIG.search, quiescenceMoveOrdering: 'original' });
    expect(options.b.settings).toEqual({ ...SELF_PLAY_CONFIG.search, quiescenceMoveOrdering: 'material' });
  });

  it('preserves inputs and settings with real repeated/pair/game delegation and injected observations', () => {
    const initial = createInitialBoardState(), before = structuredClone(initial);
    const config = structuredClone(SELF_PLAY_CONFIG);
    const result = runSelfPlayBenchmark(dependencies, initial);
    expect(result.pairs.map(p => p.pairNumber)).toEqual([1, 2, 3]);
    expect(result.summary).toEqual({ aWins: 0n, bWins: 0n, draws: 0n, maxPlies: 6n, failures: 0n });
    expect(initial).toEqual(before); expect(SELF_PLAY_CONFIG).toEqual(config);
    expect(runSelfPlayBenchmark(dependencies, initial)).toEqual(result);
  });

  it('continues subsequent games and pairs after an observed search failure and truncations', () => {
    let calls = 0;
    const result = runSelfPlayBenchmark({ ...dependencies, search: (...args) => {
      if (++calls === 5) throw new Error('observed fixture failure');
      return fixtureSearch(...args);
    } });
    expect(calls).toBe(11);
    expect(result.pairs.flatMap(p => p.result.games.map(g => g.outcome)))
      .toEqual(['max_plies', 'max_plies', 'failed', 'max_plies', 'max_plies', 'max_plies']);
    const report = summarizeSelfPlay(result);
    expect(report.games[2].detail).toMatchObject({ code: 'search_exception', message: 'observed fixture failure' });
    expect(report.summary.outcomes).toEqual({ aWins: 0n, bWins: 0n, draws: 0n, maxPlies: 5n, failures: 1n });
  });
});

describe('observations, participant and seat aggregation', () => {
  it('separates every statistic for deepest and completed totals, correctly after swapping seats', () => {
    const result = sample(), before = structuredClone(result);
    const report = summarizeSelfPlay(result);
    for (const id of ['A', 'B'] as const) {
      const fixture = searchFixture(createInitialBoardState(), id === 'B');
      const expectMetrics = (metrics: ReturnType<typeof summarizeObservations>, moves: number) => {
        expect(metrics.moveCount).toBe(moves);
        expect(metrics.elapsedMilliseconds).toBe(moves * fixture.elapsedMilliseconds);
        expect(metrics.completedDepthDistribution).toEqual({ [fixture.completedDepth]: moves });
        expect(metrics.timedOutCount).toBe(id === 'A' ? moves : 0);
        expect(Object.values(metrics.unavailable).every(n => n === 0)).toBe(true);
        for (const [key, total] of statisticKeys) {
          expect(metrics.deepest[key]).toBe(BigInt(moves * fixture[key]));
          expect(metrics.completedTotals[key]).toBe(BigInt(moves * fixture[total]));
          expect(metrics.deepest[key]).not.toBe(metrics.completedTotals[key]);
        }
      };
      expectMetrics(report.summary.participants[id], 6);
      for (const seat of ['sente', 'gote'] as const) expectMetrics(report.summary.bySeat[seat][id], 3);
      for (const game of report.games) expectMetrics(game.participants[id], 1);
    }
    expect(result).toEqual(before);
    expect(summarizeSelfPlay(result)).toEqual(report);
    expect(report.summary).toMatchObject({ totalGames: 6n, outcomeCountSum: 6n, consistent: true,
      uniqueSignatures: 1, duplicateGames: 5 });
    expect(report.summary.signatureFrequencies).toEqual([{ signature: report.games[0].signature,
      count: 6, games: ['1/1', '1/2', '2/1', '2/2', '3/1', '3/2'] }]);
  });

  it('distinguishes all five outcomes and wins/losses by participant and seat', () => {
    // Aggregate fixture only: outcome adjudication is the existing pair runner's responsibility.
    const result = sample();
    const outcomes: PairedSelfPlayOutcome[] = ['a_win', 'b_win', 'draw', 'max_plies', 'failed', 'a_win'];
    result.pairs.flatMap(p => p.result.games).forEach((g, i) => {
      g.outcome = outcomes[i];
      if (i === 4) g.result = { ...g.result, status: 'failed', failure: {
        ply: 3, player: 'sente', stage: 'search', code: 'search_exception', message: 'fixture',
      } };
      else if (i !== 3) g.result = { ...g.result, status: 'ended', gameResult: i === 2
        ? { winner: null, loser: null, endReason: 'five_hundred_move_jishogi' }
        : { winner: i === 5 ? 'gote' : 'sente', loser: i === 5 ? 'sente' : 'gote', endReason: 'checkmate' },
      };
    });
    result.summary = { aWins: 2n, bWins: 1n, draws: 1n, maxPlies: 1n, failures: 1n };
    const report = summarizeSelfPlay(result);
    expect(report.games.map(g => g.outcome)).toEqual(outcomes);
    expect(report.games[2].detail).toMatchObject({ endReason: 'five_hundred_move_jishogi' });
    expect(report.games[3].detail).toEqual({ reason: 'max_plies' });
    expect(report.games[4].detail).toMatchObject({ message: 'fixture' });
    expect(report.summary.participants.A.outcomes).toEqual({ wins: 2, losses: 1, draws: 1, maxPlies: 1, failures: 1 });
    expect(report.summary.participants.B.outcomes).toEqual({ wins: 1, losses: 2, draws: 1, maxPlies: 1, failures: 1 });
    expect(report.summary.bySeat.sente.A.outcomes).toEqual({ wins: 1, losses: 0, draws: 1, maxPlies: 0, failures: 1 });
    expect(report.summary.bySeat.gote.A.outcomes).toEqual({ wins: 1, losses: 1, draws: 0, maxPlies: 1, failures: 0 });
    expect(report.summary.bySeat.sente.B.outcomes).toEqual({ wins: 1, losses: 1, draws: 0, maxPlies: 1, failures: 0 });
    expect(report.summary.bySeat.gote.B.outcomes).toEqual({ wins: 0, losses: 1, draws: 1, maxPlies: 0, failures: 1 });
  });

  it('keeps explicit unavailable observations null with coverage counts, including partial availability', () => {
    const plies = sample().pairs[0].result.games[0].result.plies;
    Object.assign(plies[0], { elapsedMilliseconds: null, completedDepth: null, timedOut: null,
      visitedPositionCount: null, totalVisitedPositionCount: null });
    const metrics = summarizeObservations(plies);
    expect(metrics.elapsedMilliseconds).toBeNull(); expect(metrics.timedOutCount).toBeNull();
    expect(metrics.deepest.visitedPositionCount).toBeNull(); expect(metrics.completedTotals.visitedPositionCount).toBeNull();
    expect(metrics.completedDepthDistribution).toEqual({ unavailable: 1, 4: 1 });
    expect(metrics.unavailable).toMatchObject({ elapsedMilliseconds: 1, timedOut: 1, completedDepth: 1,
      visitedPositionCount: 1, totalVisitedPositionCount: 1 });
  });

  it.each([
    ['elapsedMilliseconds', undefined], ['elapsedMilliseconds', Infinity], ['elapsedMilliseconds', -1],
    ['completedDepth', undefined], ['completedDepth', NaN], ['timedOut', undefined], ['timedOut', 1],
    ['visitedPositionCount', undefined], ['visitedPositionCount', -1], ['totalVisitedPositionCount', 1],
  ])('rejects invalid or missing %s=%s rather than making up a metric', (field, value) => {
    const plies = sample().pairs[0].result.games[0].result.plies;
    Object.assign(plies[0], { [field]: value });
    expect(() => summarizeObservations(plies)).toThrow('Invalid observation');
  });

  it('rejects summary count disagreement', () => {
    const result = sample(); result.summary.draws++;
    expect(() => summarizeSelfPlay(result)).toThrow('Inconsistent outcome count');
  });
});

describe('signatures and structured CLI output', () => {
  it('hashes only canonical actions, independent of timing, outcome and property insertion order', () => {
    const first = getLegalActions(createInitialBoardState())[0];
    const reordered = Object.fromEntries(Object.entries(first).reverse()) as LegalAction;
    expect(gameSignature([first])).toBe(gameSignature([reordered]));
    expect(gameSignature([])).not.toBe(gameSignature([first]));
    expect(gameSignature([first])).not.toBe(gameSignature([first, first]));
    const result = sample(), before = summarizeSelfPlay(result).games.map(g => g.signature);
    result.pairs[0].result.games[0].result.plies[0].elapsedMilliseconds = 999;
    expect(summarizeSelfPlay(result).games.map(g => g.signature)).toEqual(before);
    expect(gameSignature([first])).not.toBe(gameSignature([getLegalActions(createInitialBoardState())[1]]));
  });

  it('includes drop identity, player, coordinates, piece type and promotion in canonical actions', () => {
    const drop: LegalAction = { kind: 'drop', player: 'sente', pieceType: 'pawn', pieceId: 'hand1',
      to: { row: 4, col: 4 }, promotion: 'none' };
    for (const update of [{ player: 'gote' }, { pieceType: 'rook' }, { pieceId: 'hand2' }, { to: { row: 4, col: 5 } }]) {
      expect(gameSignature([drop])).not.toBe(gameSignature([{ ...drop, ...update } as LegalAction]));
    }
    const move = getLegalActions(createInitialBoardState())[0];
    expect(gameSignature([move])).not.toBe(gameSignature([{ ...move, promotion: 'promote' } as LegalAction]));
    expect(gameSignature([drop, move])).not.toBe(gameSignature([move, drop]));
  });

  it('reports multiple signature frequencies including an incomplete empty game', () => {
    const result = sample();
    result.pairs[0].result.games[0].result.plies = [];
    const summary = summarizeSelfPlay(result).summary;
    expect(summary.uniqueSignatures).toBe(2); expect(summary.duplicateGames).toBe(4);
    expect(summary.signatureFrequencies.map(f => f.count)).toEqual([1, 5]);
  });

  it('serializes nested bigint exactly and all non-finite values explicitly', () => {
    expect(JSON.parse(selfPlayJson({ big: 900719925474099312345n, values: [Infinity, -Infinity, NaN, null, 0] })))
      .toEqual({ big: '900719925474099312345', values: ['Infinity', '-Infinity', 'NaN', null, 0] });
  });

  it('emits settings, all six games and records, complete summary and interpretation limits', () => {
    const lines: string[] = [];
    expect(runSelfPlayCli(dependencies, line => lines.push(line))).toBe(0);
    const read = (prefix: string) => lines.filter(l => l.startsWith(`${prefix} `)).map(l => JSON.parse(l.slice(prefix.length + 1)));
    expect(read('CONFIG')).toEqual([SELF_PLAY_CONFIG]);
    expect(read('GAME')).toHaveLength(6); expect(read('RECORD')).toHaveLength(6);
    expect(read('SUMMARY')[0]).toMatchObject({ totalGames: '6', outcomeCountSum: '6', consistent: true,
      outcomes: { aWins: '0', bWins: '0', draws: '0', maxPlies: '6', failures: '0' } });
    expect(lines.join('\n')).toContain('時間制限から除外');
    expect(lines.join('\n')).toContain('複数開始局面や定跡分岐を導入するまでは棋力差を判断できない');
  });

  it('reports missing search fields as failed games through the existing result boundary', () => {
    const lines: string[] = [];
    expect(runSelfPlayCli({ ...dependencies, search: (...args) => {
      const result = fixtureSearch(...args); Reflect.deleteProperty(result, 'elapsedMilliseconds'); return result;
    } }, line => lines.push(line))).toBe(1);
    const games = lines.filter(l => l.startsWith('GAME ')).map(l => JSON.parse(l.slice(5)));
    expect(games).toHaveLength(6);
    for (const game of games) {
      expect(game).toMatchObject({ outcome: 'failed', plyCount: 0, detail: { code: 'invalid_result' } });
    }
  });

  it('retains raw records but emits no successful summary for invalid injected aggregate observations', () => {
    const result = sample();
    Object.assign(result.pairs[0].result.games[0].result.plies[0], { elapsedMilliseconds: NaN });
    const lines: string[] = [];
    expect(runSelfPlayCli({ runner: () => result }, line => lines.push(line))).toBe(1);
    expect(lines.filter(l => l.startsWith('RECORD '))).toHaveLength(6);
    expect(lines.some(l => l.startsWith('SUMMARY '))).toBe(false);
    expect(lines.some(l => l.startsWith('ERROR '))).toBe(true);
  });
});
