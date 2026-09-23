// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { QUIESCENCE_BENCHMARK_POSITIONS as positions, type BenchmarkPosition } from '../../scripts/benchmarks/quiescencePositions';
import { ORDERING_SETTINGS, formatOrderingCase, formatOrderingSummary, runOrderingCase, runOrderingSuite, summarizeOrdering } from '../../scripts/benchmarks/quiescenceOrderingSuite';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../domain/shogi';
import type { BoardState } from '../types/shogi';

const endedPosition: BenchmarkPosition = { ...positions[0], create: () => ({ ...positions[0].create(), status: 'ended',
  result: { winner: 'sente', loser: 'gote', endReason: 'resignation' } }) };
const endedPositions = positions.map(p => ({ ...p, create: endedPosition.create }));
const clock = () => 0;
function expectDeepFrozen(value: unknown): void {
  if (value && typeof value === 'object') {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(expectDeepFrozen);
  }
}

describe('quiescence ordering A/B suite', () => {
  it('runs 48 ordered independent frozen settings, with depth/budget/evaluation contracts', () => {
    const snapshots: BoardState[] = [];
    const fixed = vi.fn<typeof analyzeAlphaBetaSearch>((state, depth, evaluation, now, options) => {
      expectDeepFrozen(state);
      snapshots.push(state);
      expect(depth).toBe(3); expect(evaluation).toBeUndefined(); expect(now).toBe(clock);
      expect(options).toEqual({ moveOrdering: 'standard', quiescence: ORDERING_SETTINGS[(snapshots.length - 1) % 4] });
      return analyzeAlphaBetaSearch(state, depth, evaluation, now, options);
    });
    const timed = vi.fn<typeof analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch>((state, depth, milliseconds, evaluation, now, options) => {
      expectDeepFrozen(state);
      snapshots.push(state);
      expect(depth).toBe(4); expect(milliseconds).toBe(1000); expect(evaluation).toBeUndefined(); expect(now).toBe(clock);
      expect(options).toEqual({ moveOrdering: 'standard', quiescence: ORDERING_SETTINGS[(snapshots.length - 1) % 4] });
      return analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, depth, milliseconds, evaluation, now, options);
    });
    const callback = vi.fn();
    const cases = runOrderingSuite(['fixed', 'timed'], { clock, fixedSearch: fixed, timedSearch: timed }, endedPositions, callback);
    expect(cases).toHaveLength(12); expect(cases.every(c => c.ok)).toBe(true);
    expect(cases.map(c => `${c.mode}:${c.position.id}`)).toEqual(['fixed', 'timed'].flatMap(mode => positions.map(p => `${mode}:${p.id}`)));
    expect(fixed).toHaveBeenCalledTimes(24); expect(timed).toHaveBeenCalledTimes(24); expect(callback).toHaveBeenCalledTimes(12);
    expect(new Set(snapshots).size).toBe(48);
    expect(new Set(snapshots.map(s => s.squares)).size).toBe(48);
    expect(new Set(snapshots.map(s => s.positionHistory)).size).toBe(48);
    expect(new Set(snapshots.map(s => s.senteHand)).size).toBe(48);
    expect(summarizeOrdering(cases, 'fixed')).toMatchObject({ success: 6, errors: 0 });
    expect(formatOrderingSummary(cases, 'timed')).toContain('成功=6局面/24設定');
    expect(formatOrderingCase(cases[0])).toContain('先手評価=+∞');
    expect(formatOrderingCase(cases[0])).toContain('PV=手順なし');
  });
  it('provides a new deadline to every real timed search and retains only completed work using an injected clock', () => {
    let now = 0;
    const tickingClock = () => (now += 600);
    const entry = runOrderingCase(positions[1], 'timed', { clock: tickingClock });
    if (!entry.ok) throw new Error(entry.error);
    for (const result of entry.results) {
      const s = result.search;
      if (!('iterations' in s)) throw new Error('Expected timed result');
      expect(s.completedDepth).toBe(0); // Determined by fake clock, never wall time.
      expect(s.resultSource).toBe('fallback');
      expect(s.timedOut).toBe(true);
      expect(s.iterations).toHaveLength(0);
      expect(s.totalVisitedPositionCount).toBe(0);
      expect(s.totalQuiescenceVisitedPositionCount).toBe(0);
    }
    expect(formatOrderingCase(entry)).toContain('採用反復=0/4; 完了反復=[]');
  });
  it.each(ORDERING_SETTINGS.map((s, i) => [s.moveOrdering, s.maxTacticalDepth, i] as const))('reports failed %s +%i and excludes partial cases', (_ordering, _depth, index) => {
    let calls = 0;
    const fixedSearch: typeof analyzeAlphaBetaSearch = (...args) => {
      if (calls++ === index) throw new Error('injected search failure');
      return analyzeAlphaBetaSearch(...args);
    };
    const cases = runOrderingSuite(['fixed'], { clock, fixedSearch }, endedPositions.slice(0, 2));
    expect(cases[0]).toMatchObject({ ok: false, error: expect.stringContaining(`position=initial mode=fixed 追加${ORDERING_SETTINGS[index].maxTacticalDepth}手 ordering=${ORDERING_SETTINGS[index].moveOrdering}`) });
    expect(cases[1].ok).toBe(true);
    expect(summarizeOrdering(cases, 'fixed')).toMatchObject({ success: 1, errors: 1 });
    expect(formatOrderingCase(cases[0])).toContain('injected search failure');
  });
  it('detects mutation attempts on frozen snapshots and changes to the source input', () => {
    const mutated = runOrderingCase(endedPosition, 'fixed', { fixedSearch: (...args) => {
      args[0].turn = 'gote';
      return analyzeAlphaBetaSearch(...args);
    } });
    expect(mutated.ok).toBe(false);
    const input = endedPosition.create();
    const source = runOrderingCase({ ...endedPosition, create: () => input }, 'fixed', { clock, fixedSearch: (...args) => {
      input.senteHand.push({ id: 'mutation', type: 'gold', player: 'sente' });
      return analyzeAlphaBetaSearch(...args);
    } });
    expect(source).toMatchObject({ ok: false, error: expect.stringContaining('入力局面が変更されました') });
  });
  it('rejects invalid evaluation breakdowns with setting context', () => {
    const entry = runOrderingCase(endedPosition, 'fixed', { clock, fixedSearch: (...args) => {
      const result = analyzeAlphaBetaSearch(...args);
      return { ...result, evaluationBreakdown: { ...result.evaluationBreakdown, material: 17 } };
    } });
    expect(entry).toMatchObject({ ok: false, error: expect.stringContaining('ordering=original: PV末端の評価内訳') });
  });
  it('rejects invalid timed aggregates instead of accepting interrupted work', () => {
    const entry = runOrderingCase(endedPosition, 'timed', { clock, timedSearch: (...args) => ({
      ...analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(...args), totalQuiescenceVisitedPositionCount: 1,
    }) });
    expect(entry).toMatchObject({ ok: false, error: expect.stringContaining('完了反復合計:totalQuiescenceVisitedPositionCount') });
  });
  it('aggregates deepest vs all completed iterations separately and emits changes for every pair', () => {
    let now = 0;
    const cases = [runOrderingCase(positions[1], 'timed', { clock: () => (now += 5) })];
    const entry = cases[0];
    if (!entry.ok) throw new Error(entry.error);
    const summary = summarizeOrdering(cases, 'timed');
    summary.settings.forEach((s, i) => {
      const r = entry.results[i].search;
      if (!('iterations' in r)) throw new Error('Expected timed');
      expect(s.deepest[0]).toBe(r.visitedPositionCount);
      expect(s.totals[0]).toBe(r.iterations.reduce((sum, iteration) => sum + iteration.visitedPositionCount, 0));
      expect(s.totals[4]).toBe(r.iterations.reduce((sum, iteration) => sum + iteration.quiescenceVisitedPositionCount, 0));
      expect(s.elapsed).toBe(r.elapsedMilliseconds);
    });
    const text = formatOrderingCase(entry);
    expect(text).toContain('追加1手 original→material: 推奨手=');
    expect(text).toContain('追加2手 original→material: 推奨手=');
    expect(text).toContain('全完了合計:');
  });
  it('rejects duplicate IDs', () => {
    expect(() => runOrderingSuite(['fixed'], {}, [endedPosition, endedPosition])).toThrow('局面ID重複');
  });
});
