import { describe, expect, it } from 'vitest';
import { createInitialBoardState } from '../types/shogi';
import { getLegalActions } from '../domain/shogi/legalActions';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { DEFAULT_CONFIG, runMeasurement, summarizeGames, summarizePlies,
  type MeasurementGame, type MeasurementPly, type Search } from '../../scripts/benchmarks/timedFallbackSelfPlay';

const fallbackSearch: Search = (state) => {
  // Zero deadline produces a real, legal PR #152 fallback, with no score or PV.
  const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 1, 0);
  expect(result.selectedAction).toEqual(getLegalActions(state)[0]);
  return result;
};

describe('timed fallback self-play measurement', () => {
  it('alternates complete seat pairs and records legal fallback moves without an invented evaluation', () => {
    let tick = 0;
    const config = { ...DEFAULT_CONFIG, pairCount: 2, maxPlies: 2 };
    const games = runMeasurement(config, { search: fallbackSearch, now: () => ++tick });
    expect(games.map(g => [g.sente, g.gote])).toEqual([
      ['A', 'B'], ['B', 'A'], ['B', 'A'], ['A', 'B'],
    ]);
    expect(games.map(g => g.executionIndex)).toEqual([1, 2, 3, 4]);
    expect(games.every(g => g.outcome === 'max_plies')).toBe(true);
    for (const game of games) for (const ply of game.plies) {
      expect(ply.resultSource).toBe('fallback');
      expect(ply.selectedEvaluation).toBeNull();
      expect(ply.evaluationBreakdown).toBeNull();
      expect(ply.principalVariation).toEqual([]);
      expect(ply.completedDepth).toBe(0);
      expect(ply.timedOut).toBe(true);
      expect(ply.actualElapsedMilliseconds).toBe(1);
      expect(ply.timeLimitMilliseconds).toBe(100);
      expect(ply.participant).toBe(game[ply.player]);
    }
    const summary = summarizeGames(games);
    expect(summary.outcomes).toEqual({ aWins: 0, bWins: 0, draws: 0, maxPlies: 4, failures: 0 });
    expect(summary.totalPlies).toBe(8);
    expect(summary.participants.A).toMatchObject({ moves: 4, fallbackCount: 4, fallbackRate: 1 });
    expect(summary.participants.B).toMatchObject({ moves: 4, fallbackCount: 4, fallbackRate: 1 });
    expect(summary).toEqual(summarizeGames(
      games.map(g => JSON.parse(JSON.stringify(g)) as MeasurementGame)));
  });

  it('uses successful moves as the denominator, groups ply bands and actual overrun, and separates outcomes', () => {
    const base = runMeasurement({ ...DEFAULT_CONFIG, pairCount: 1, maxPlies: 2 },
      { search: fallbackSearch, now: (() => { let n = 0; return () => n++; })() });
    const first = base[0];
    const completed: MeasurementPly = { ...first.plies[1], resultSource: 'completed-iteration',
      completedDepth: 1, selectedEvaluation: 12, actualElapsedMilliseconds: 107,
      timeLimitMilliseconds: 100, ply: 21 };
    const fallback: MeasurementPly = { ...first.plies[0], ply: 20, actualElapsedMilliseconds: 131 };
    const stats = summarizePlies([fallback, completed]);
    expect(stats).toMatchObject({ moves: 2, fallbackCount: 1, fallbackRate: .5,
      fallbackPlies: [20], fallbackByPlyBand: {
        '1-20': { moves: 1, fallbacks: 1 }, '21-40': { moves: 1, fallbacks: 0 },
      }, completedDepthDistribution: { '0': 1, '1': 1 },
      actualOverLimit: { count: 2, rate: 1, medianExcessMilliseconds: 7,
        maxExcessMilliseconds: 31, distribution: {
          withinLimit: 0, over0to5: 0, over5to20: 1, over20to100: 1, over100: 0,
        } } });
    const games: MeasurementGame[] = [
      { ...first, outcome: 'a_win', status: 'ended', plies: [fallback, completed] },
      { ...base[1], outcome: 'draw', status: 'ended', plies: [] },
      { ...first, outcome: 'max_plies', status: 'max_plies', plies: [] },
      { ...first, outcome: 'failed', status: 'failed', plies: [] },
    ];
    const summary = summarizeGames(games);
    expect(summary.outcomes).toEqual({ aWins: 1, bWins: 0, draws: 1, maxPlies: 1, failures: 1 });
    expect(summary.participants.A).toMatchObject({ moves: 1, fallbackCount: 1, fallbackRate: 1,
      outcomes: { wins: 1, losses: 0, draws: 1, maxPlies: 1, failures: 1 } });
    expect(summary.participants.B).toMatchObject({ moves: 1, fallbackCount: 0, fallbackRate: 0 });
    expect(summary.byFallback.withFallback).toMatchObject({ games: 1, outcomes: { aWins: 1 } });
    expect(summary.byFallback.withoutFallback).toMatchObject({ games: 3, outcomes: { draws: 1, maxPlies: 1, failures: 1 } });
    expect(summarizePlies([]).fallbackRate).toBeNull();
  });

  it('distinguishes an already terminal no-action position from a played fallback', () => {
    const state = createInitialBoardState();
    state.status = 'ended';
    state.result = { endReason: 'repetition', winner: null, loser: null };
    const games = runMeasurement({ ...DEFAULT_CONFIG, pairCount: 1, maxPlies: 2 },
      { initialState: state, search: () => { throw new Error('search must not run'); } });
    expect(games).toHaveLength(2);
    expect(games.every(g => g.status === 'ended' && g.plies.length === 0 && g.outcome === 'draw')).toBe(true);
    expect(summarizeGames(games).participants.A).toMatchObject({ moves: 0, fallbackCount: 0, fallbackRate: null });
  });
});
