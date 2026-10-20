import { describe, it, expect, vi, afterEach } from 'vitest';
import * as ai from '../domain/shogi/twoPlyAlphaBetaAi';
import * as legal from '../domain/shogi/legalActions';
import { DEFAULT_MATERIAL_VALUE_TABLE as TABLE } from '../domain/shogi/materialEvaluation';
import { createInitialBoardState } from '../types/shogi';
import { handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest as worker } from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerHandler';
import { distancePositions, observePv, compareReference, exhaustive } from '../../scripts/benchmarks/terminalDistanceReference';

afterEach(() => vi.restoreAllMocks());
const options = { usePreviousIterationPv: true, quiescence: { maxTacticalDepth: 1 } };
const position = (id: string) => distancePositions().find(p => p.id === id)!.state;
function stripTime(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTime);
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'elapsedMilliseconds').map(([key, v]) => [key, stripTime(v)])
  );
  return value;
}

describe('previous completed iteration PV', () => {
  it('stably prioritizes legal hints and ignores absent/empty hints', () => {
    const actions = legal.getLegalActions(position('recapture'));
    const before = [...actions];
    const hint = structuredClone(actions[2]);
    expect(ai.prioritizeLegalPvAction([...actions], hint)).toEqual([actions[2], actions[0], actions[1], ...actions.slice(3)]);
    expect(ai.prioritizeLegalPvAction([...actions], undefined)).toEqual(before);
    expect(ai.prioritizeLegalPvAction([...actions], { ...hint, to: { row: -1, col: -1 } })).toEqual(before);
    expect(ai.prioritizeLegalPvAction([], hint)).toEqual([]);
    expect(actions).toEqual(before);
  });

  it('rejects invalid runtime opt-in values', () => {
    expect(() => ai.analyzeIterativeDeepeningAlphaBetaSearch(position('mixed-distance'), 1, undefined, undefined,
      { usePreviousIterationPv: 'yes' } as unknown as ai.AlphaBetaSearchOptions)).toThrow(RangeError);
  });

  it('uses the PV next move only along the matching prefix, including deeper ordinary nodes', () => {
    const s = position('recapture');
    const original = legal.executeLegalAction;
    const paths = new WeakMap<object, legal.LegalAction[]>();
    paths.set(s, []);
    const trace = new Map<string, { iteration: number; path: legal.LegalAction[]; action: legal.LegalAction; state: typeof s }>();
    let reads = 0;
    const clock = () => { reads++; return 0; };
    vi.spyOn(legal, 'executeLegalAction').mockImplementation((state, action, ...args) => {
      const path = paths.get(state) ?? [];
      const iteration = Math.floor(reads / 2);
      const key = JSON.stringify([iteration, path]);
      if (!trace.has(key)) trace.set(key, { iteration, path, action, state });
      const result = original(state, action, ...args);
      if (result.type === 'applied') paths.set(result.state, [...path, action]);
      return result;
    });
    const r = ai.analyzeIterativeDeepeningAlphaBetaSearch(s, 4, undefined, clock, options);
    let internalHints = 0;
    for (let depth = 2; depth <= 4; depth++) {
      const pv = r.iterations[depth - 2].principalVariation;
      for (let ply = 1; ply < Math.min(depth, pv.length); ply++) {
        const first = trace.get(JSON.stringify([depth, pv.slice(0, ply)]));
        expect(first?.action).toEqual(pv[ply]);
        internalHints++;
      }
      // A divergent branch at the same ply must retain its ordinary ordering.
      for (const t of [...trace.values()].filter(t => t.iteration === depth && t.path.length > 0 && t.path.length < depth)) {
        if (JSON.stringify(t.path) === JSON.stringify(pv.slice(0, t.path.length))) continue;
        expect(t.action).toEqual(ai.orderAlphaBetaNodeActions(t.state, legal.getLegalActions(t.state))[0]);
      }
    }
    expect(internalHints).toBeGreaterThan(2);
  });

  it.each(['mixed-distance', 'terminal-resistance', 'terminal-resistance-gote', 'evasion'])('matches independent full width at bounded depth: %s', id => {
    const s = position(id), before = structuredClone(s);
    const depth = id === 'evasion' ? 2 : 4;
    const reference = exhaustive(s, depth, 1);
    for (const enabled of [false, true]) {
      const r = ai.analyzeIterativeDeepeningAlphaBetaSearch(s, depth, undefined, undefined, { ...options, usePreviousIterationPv: enabled });
      const pv = observePv(s, r.principalVariation);
      expect(compareReference(pv, reference)).toBe(0);
      expect(r.selectedEvaluation).toBe(pv.breakdown.total);
      expect(r.evaluationBreakdown).toEqual(pv.breakdown);
    }
    expect(s).toEqual(before);
  });

  it('keeps omitted/false identical and fixed-depth unaffected', () => {
    const s = position('terminal-resistance');
    expect(stripTime(ai.analyzeIterativeDeepeningAlphaBetaSearch(s, 4))).toEqual(stripTime(ai.analyzeIterativeDeepeningAlphaBetaSearch(s, 4, undefined, undefined, { usePreviousIterationPv: false })));
    expect(stripTime(ai.analyzeAlphaBetaSearch(s, 4))).toEqual(stripTime(ai.analyzeAlphaBetaSearch(s, 4, undefined, undefined, { usePreviousIterationPv: true })));
  });

  it.each([4, 7, 8, 30, 200])('keeps deadline approval/partial/fallback semantics at clock read %i', expires => {
    const s = position('mixed-distance');
    const run = (enabled: boolean) => { let reads = 0; return ai.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s, 4, 100, undefined,
      () => ++reads >= expires ? 100 : 0, { ...options, usePreviousIterationPv: enabled }); };
    const off = run(false), on = run(true);
    if (off.completedDepth <= 1) expect(stripTime(on)).toEqual(stripTime(off));
    expect(on.iterations).toHaveLength(on.completedDepth);
    if (on.completedDepth) expect(on.principalVariation).toEqual(on.iterations[on.completedDepth - 1].principalVariation);
  });

  it.each(['standard', 'static-exchange'] as const)('composes with %s ordering and killer history', moveOrdering => {
    const s = position('terminal-resistance');
    const reference = exhaustive(s, 4, 1);
    for (const killerMoves of [false, true]) {
      const r = ai.analyzeIterativeDeepeningAlphaBetaSearch(s, 4, undefined, undefined, { ...options, moveOrdering, killerMoves });
      expect(compareReference(observePv(s, r.principalVariation), reference)).toBe(0);
    }
  });

  it('discards an interrupted later iteration and keeps the completed PV', () => {
    const s = position('recapture');
    let firstReads = 0;
    const first = ai.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s, 1, 100, undefined, () => { firstReads++; return 0; }, options);
    let reads = 0;
    const interrupted = ai.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s, 4, 100, undefined,
      () => ++reads >= firstReads + 3 ? 100 : 0, options);
    expect(interrupted.completedDepth).toBe(1);
    expect(interrupted.timedOut).toBe(true);
    expect(interrupted.principalVariation).toEqual(first.principalVariation);
    expect(interrupted.selectedEvaluation).toBe(first.selectedEvaluation);
    expect(interrupted.resultSource).toBe('completed-iteration');
  });

  it('propagates NaN as RangeError with PV enabled', () => {
    const s = createInitialBoardState();
    const evaluation = { ...TABLE, unpromoted: { ...TABLE.unpromoted, pawn: NaN } };
    expect(() => ai.analyzeIterativeDeepeningAlphaBetaSearch(s, 4, evaluation, () => 0, options)).toThrow(RangeError);
    expect(() => ai.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s, 4, 100, evaluation, () => 0, options)).toThrow(RangeError);
  });

  it.each(['repetition', 'five_hundred_move_jishogi', 'agreed_jishogi_draw', 'entering_king_draw'] as const)('handles empty completed PV for draw %s', endReason => {
    const s = position('mixed-distance');
    const ended = { ...s, status: 'ended' as const, result: { winner: null, loser: null, endReason, sentePoints: 0, gotePoints: 0 } };
    const r = ai.analyzeIterativeDeepeningAlphaBetaSearch(ended, 4, undefined, undefined, options);
    expect(r.iterations.every(i => i.principalVariation.length === 0)).toBe(true);
    expect(r.evaluationBreakdown.terminal).toBe('draw');
  });

  it('serializes the real Worker result with opt-in injected at the search API', () => {
    const s = position('terminal-resistance'), before = structuredClone(s);
    const response = worker({ type: 'run-time-limited-iterative-deepening-alpha-beta-search', requestId: 'pv', state: s,
      maxDepth: 4, timeLimitMilliseconds: 1000 }, (state, depth, budget, evaluation, _clock, workerOptions) =>
      ai.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, depth, budget, evaluation, () => 0,
        { ...workerOptions, usePreviousIterationPv: true }));
    expect(response.type).toBe('time-limited-iterative-deepening-alpha-beta-search-succeeded');
    if (response.type === 'time-limited-iterative-deepening-alpha-beta-search-succeeded') {
      const result = structuredClone(response).result;
      expect(observePv(s, result.principalVariation).terminalDistancePly).toBe(4);
      expect(result.selectedEvaluation).toBe(-Infinity);
      expect(result.evaluationBreakdown?.total).toBe(-Infinity);
      expect(Object.keys(result)).not.toContain('searchValue');
    }
    expect(s).toEqual(before);
  });
});
