import { describe, it, expect, vi, afterEach } from 'vitest';
import * as ai from '../domain/shogi/twoPlyAlphaBetaAi';
import { createTranspositionTableStatistics, ExactTranspositionTable, transpositionIdentity,
  TRANSPOSITION_TABLE_CAPACITY } from '../domain/shogi/transpositionTable';
import { createPositionKey } from '../domain/shogi/repetition';
import { createInitialBoardState } from '../types/shogi';
import { DEFAULT_MATERIAL_VALUE_TABLE as TABLE } from '../domain/shogi/materialEvaluation';
import * as legal from '../domain/shogi/legalActions';
import { distancePositions, observePv, exhaustive, compareReference } from '../../scripts/benchmarks/terminalDistanceReference';
import { constructed } from '../../scripts/benchmarks/tacticalPositions';

afterEach(() => vi.restoreAllMocks());
const position = (id: string) => distancePositions().find(p => p.id === id)!.state;
function stripTime(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTime);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => k !== 'elapsedMilliseconds').map(([k, v]) => [k, stripTime(v)]));
  return value;
}

describe('bounded exact transposition table', () => {
  it('only evaluates a lazy identity for a candidate, including mismatches and falsey results', () => {
    const table = new ExactTranspositionTable<number>();
    const identity = vi.fn(() => 'safe');
    expect(table.probe('missing', identity)).toBeUndefined();
    expect(identity).not.toHaveBeenCalled();
    table.store('present', 'safe', 0);
    expect(table.probe('present', identity)).toBe(0);
    expect(identity).toHaveBeenCalledTimes(1);
    expect(table.probe('present', () => 'different')).toBeUndefined();
    expect(table.statistics).toMatchObject({ lookups: 3, misses: 1, hits: 2,
      identityMatches: 1, identityMismatches: 1, exactReuses: 1, safetyRejects: 1 });
  });

  it('generates identity once for candidate checks or exact stores, skipping nonexact misses', () => {
    const s = constructed('tt-lazy', [[8,8,'king','sente'], [0,0,'king','gote']]);
    const stats = createTranspositionTableStatistics();
    const probe = ExactTranspositionTable.prototype.probe;
    const store = ExactTranspositionTable.prototype.store;
    const generated = new Set<string>();
    let calls = 0;
    vi.spyOn(ExactTranspositionTable.prototype, 'probe').mockImplementation(function(this: ExactTranspositionTable<unknown>, key, identity) {
      expect(typeof identity).toBe('function');
      return probe.call(this, key, () => {
        generated.add(key); calls++;
        return (identity as () => string)();
      });
    });
    vi.spyOn(ExactTranspositionTable.prototype, 'store').mockImplementation(function(this: ExactTranspositionTable<unknown>, key, identity, result) {
      expect(identity.length).toBeGreaterThan(0);
      return store.call(this, key, identity, result);
    });
    ai.analyzeAlphaBetaSearch(s, 4, undefined, () => 0,
      { useTranspositionTable: true, transpositionTableStatistics: stats });
    expect(stats.identityGenerations).toBe(stats.hits + stats.stores);
    expect(calls).toBe(stats.hits);
    expect(generated.size).toBeGreaterThan(0);
    expect(stats.nonExactStoreRejects).toBeGreaterThan(0);
    expect(stats.identityGenerations).toBeLessThan(stats.lookups);
    expect(stats.identityMatches).toBe(stats.exactReuses);
    expect(stats.sizeStoreRejects).toBe(0);
    expect(stats.safetyRejects).toBe(stats.identityMismatches + stats.nonExactStoreRejects);
  });

  it('reuses an identity rejected by a candidate check when saving the completed exact result', () => {
    const s = position('mixed-distance');
    const probe = ExactTranspositionTable.prototype.probe;
    const store = ExactTranspositionTable.prototype.store;
    const identities = new Map<string,string>();
    const stats = createTranspositionTableStatistics();
    vi.spyOn(ExactTranspositionTable.prototype, 'probe').mockImplementation(function(this: ExactTranspositionTable<unknown>, key, identity) {
      // Force a coarse-key collision. The mismatched value must never escape.
      store.call(this,key,'incompatible',{ poison: true });
      return probe.call(this,key,() => {
        const value = (identity as () => string)(); identities.set(key,value); return value;
      });
    });
    const saved = vi.spyOn(ExactTranspositionTable.prototype, 'store').mockImplementation(function(this: ExactTranspositionTable<unknown>,key,identity,result) {
      expect(identity).toBe(identities.get(key)); return store.call(this,key,identity,result);
    });
    const on = ai.analyzeAlphaBetaSearch(s,2,undefined,() => 0,
      { useTranspositionTable:true, transpositionTableStatistics:stats });
    const off = ai.analyzeAlphaBetaSearch(s,2,undefined,() => 0);
    expect(on).toEqual(off);
    expect(saved).toHaveBeenCalled();
    expect(stats.identityGenerations).toBe(stats.lookups);
    expect(stats.identityMismatches).toBe(stats.lookups);
    expect(stats.exactReuses).toBe(0);
  });

  it('is FIFO with bounded entry count and payload, and distinguishes hit from reuse', () => {
    const table = new ExactTranspositionTable<number>();
    for (let i = 0; i <= TRANSPOSITION_TABLE_CAPACITY; i++) table.store(String(i), 'safe', i);
    expect(table.probe('0', 'safe')).toBeUndefined();
    expect(table.probe('1', 'unsafe')).toBeUndefined();
    expect(table.probe('1', 'safe')).toBe(1);
    table.store('huge', 'x'.repeat(16385), 0);
    expect(table.statistics).toMatchObject({ maxEntries: 512, evictions: 1,
      lookups: 3, misses: 1, hits: 2, exactReuses: 1, safetyRejects: 2, stores: 513,
      sizeStoreRejects: 1, identityMismatches: 1, identityMatches: 1 });
    expect(table.statistics.maxPayloadCharacters).toBeLessThanOrEqual(512 * 16384);
  });

  it('requires ordered check history when repetition is possible within the horizon', () => {
    const s = position('mixed-distance');
    const altered = structuredClone(s);
    altered.positionHistory![0].gaveCheck = true;
    expect(transpositionIdentity(s, 3)).not.toBe(transpositionIdentity(altered, 3));
    expect(transpositionIdentity(s, 2)).toBe(transpositionIdentity(altered, 2));
    altered.positionHistory = Array.from({ length: 3 }, () => ({ ...s.positionHistory![0] }));
    expect(transpositionIdentity(s, 1)).not.toBe(transpositionIdentity(altered, 1));
  });

  it('separates move limit/pending state, result, IDs, hand order and root ply', () => {
    const s = createInitialBoardState();
    const variants = [ { ...s, moveNumber: 500 },
      { ...s, moveLimitJishogi: { kind: 'awaiting_continuous_check_end' as const, checkingPlayer: 'sente' as const } },
      { ...s, status: 'ended' as const, result: { endReason: 'repetition' as const, winner: null, loser: null } } ];
    for (const v of variants) expect(transpositionIdentity(v, 2)).not.toBe(transpositionIdentity(s, 2));
    const ids = structuredClone(s); ids.squares[0][0].piece!.id += '-different';
    expect(createPositionKey(ids)).toBe(createPositionKey(s));
    expect(transpositionIdentity(ids, 2)).not.toBe(transpositionIdentity(s, 2));
    const hand = { ...s, senteHand: [{ id: 'a', type: 'gold' as const, player: 'sente' as const },
      { id: 'b', type: 'gold' as const, player: 'sente' as const }] };
    expect(transpositionIdentity(hand, 1)).not.toBe(transpositionIdentity({ ...hand, senteHand: [...hand.senteHand].reverse() }, 1));
    const table = new ExactTranspositionTable();
    expect(table.key(s, 1, 1)).not.toBe(table.key(s, 1, 3));
    expect(table.key(s, 1, 1)).not.toBe(table.key(s, 2, 1));
  });

  it('keeps omitted/false identical, validates the opt-in, and isolates calls', () => {
    const s = position('mixed-distance');
    const omitted = ai.analyzeIterativeDeepeningAlphaBetaSearch(s, 3, undefined, () => 0);
    const off = ai.analyzeIterativeDeepeningAlphaBetaSearch(s, 3, undefined, () => 0, { useTranspositionTable: false });
    expect(off).toEqual(omitted);
    expect(() => ai.analyzeAlphaBetaSearch(s, 1, undefined, undefined,
      { useTranspositionTable: 'yes' } as unknown as ai.AlphaBetaSearchOptions)).toThrow(RangeError);
    const stats = createTranspositionTableStatistics();
    const first = ai.analyzeAlphaBetaSearch(s, 3, undefined, () => 0, { useTranspositionTable: true, transpositionTableStatistics: stats });
    const firstStatistics = { ...stats };
    const second = ai.analyzeAlphaBetaSearch(s, 3, undefined, () => 0, { useTranspositionTable: true, transpositionTableStatistics: stats });
    expect(second).toEqual(first);
    expect(stats).toEqual(firstStatistics);
    ai.analyzeAlphaBetaSearch(s, 0, undefined, () => 0, { useTranspositionTable: true, transpositionTableStatistics: stats });
    expect(stats).toEqual(createTranspositionTableStatistics());
  });

  it.each(['mixed-distance', 'terminal-resistance', 'terminal-resistance-gote', 'mate-three'])('matches independent full width and legal leaf breakdown: %s', id => {
    const s = position(id), before = structuredClone(s);
    const reference = exhaustive(s, 4, 1);
    const stats = createTranspositionTableStatistics();
    const r = ai.analyzeAlphaBetaSearch(s, 4, undefined, undefined, { useTranspositionTable: true,
      transpositionTableStatistics: stats, quiescence: { maxTacticalDepth: 1 } });
    const pv = observePv(s, r.principalVariation);
    expect(compareReference(pv, reference)).toBe(0);
    expect(r.selectedAction).toEqual(reference.pv[0]);
    expect(r.evaluationBreakdown).toEqual(pv.breakdown);
    expect(r.selectedEvaluation).toBe(pv.breakdown.total);
    expect(s).toEqual(before);
    expect(stats.maxEntries).toBeLessThanOrEqual(512);
  });

  it('actually reuses values reached through different legal paths against full width', () => {
    const s = constructed('tt-commute', [[8,8,'king','sente'], [0,0,'king','gote']]);
    const stats = createTranspositionTableStatistics();
    const options = { useTranspositionTable: true, transpositionTableStatistics: stats, quiescence: { maxTacticalDepth: 1 } };
    const r = ai.analyzeAlphaBetaSearch(s, 4, undefined, undefined, options);
    const off = ai.analyzeAlphaBetaSearch(s, 4, undefined, undefined, { quiescence: options.quiescence });
    expect(stats.exactReuses).toBeGreaterThan(0);
    const observed = observePv(s, r.principalVariation);
    expect(compareReference(observed, exhaustive(s, 4, 1))).toBe(0);
    expect(r.selectedAction).toEqual(off.selectedAction);
    expect(r.selectedEvaluation).toBe(off.selectedEvaluation);
    expect(r.quiescenceLeafCount).toBeLessThan(off.quiescenceLeafCount);
  });

  it.each([false, true])('supports PV hints and conservatively bypasses killer history: pv=%s', pv => {
    const s = position('mixed-distance');
    for (const killer of [false, true]) {
      const options = { usePreviousIterationPv: pv, killerMoves: killer, quiescence: { maxTacticalDepth: 1 } };
      const off = ai.analyzeIterativeDeepeningAlphaBetaSearch(s, 4, undefined, () => 0, options);
      const stats = createTranspositionTableStatistics();
      const on = ai.analyzeIterativeDeepeningAlphaBetaSearch(s, 4, undefined, () => 0,
        { ...options, useTranspositionTable: true, transpositionTableStatistics: stats });
      expect(on.selectedAction).toEqual(off.selectedAction);
      expect(on.selectedEvaluation).toBe(off.selectedEvaluation);
      if (killer) { expect(on).toEqual(off); expect(stats.exactReuses).toBe(0); expect(stats.safetyRejects).toBeGreaterThan(0); }
    }
  });

  it.each([498, 499, 500])('preserves 500 move boundary and waiting state at moveNumber=%i', moveNumber => {
    const s = { ...position('mixed-distance'), moveNumber };
    for (const pending of [null, { kind: 'awaiting_continuous_check_end' as const, checkingPlayer: s.turn }]) {
      const input = { ...s, moveLimitJishogi: pending };
      const reference = exhaustive(input, 2, 1);
      const r = ai.analyzeAlphaBetaSearch(input, 2, undefined, undefined,
        { useTranspositionTable: true, quiescence: { maxTacticalDepth: 1 } });
      expect(compareReference(observePv(input, r.principalVariation), reference)).toBe(0);
    }
  });

  it.each([false, true])('preserves repetition/perpetual-check adjudication: continuous=%s', continuous => {
    const s = continuous
      ? constructed('tt-perpetual', [[8,8,'king','sente'],[0,4,'king','gote'],[1,3,'rook','sente']])
      : constructed('tt-repetition', [[8,8,'king','sente'],[0,0,'king','gote']]);
    const a = continuous ? legal.getLegalActions(s).find(a => a.kind === 'move' && a.pieceType === 'rook' &&
      a.to.row === 1 && a.to.col === 4 && a.promotion === 'decline')! : legal.getLegalActions(s)[0];
    const next = legal.executeLegalAction(s, a);
    expect(next.type).toBe('applied'); if (next.type !== 'applied') return;
    const key = createPositionKey(next.state);
    const records = [0,1,2].flatMap(() => [
      { key, movedBy: s.turn, gaveCheck: continuous, historyIndex: 0 },
      { key: createPositionKey(s), movedBy: next.state.turn, gaveCheck: false, historyIndex: 0 }]);
    const input = { ...s, positionHistory: records };
    const executed = legal.executeLegalAction(input, a);
    expect(executed.type).toBe('applied');
    if (executed.type === 'applied') expect(executed.state.result?.endReason).toBe(continuous ? 'foul_loss' : 'repetition');
    const r = ai.analyzeAlphaBetaSearch(input, 2, undefined, undefined, { useTranspositionTable: true });
    expect(compareReference(observePv(input, r.principalVariation), exhaustive(input, 2))).toBe(0);
  });

  it('never hides NaN or converts it to a deadline result', () => {
    const s = createInitialBoardState();
    const bad = { ...TABLE, unpromoted: { ...TABLE.unpromoted, pawn: NaN } };
    expect(() => ai.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s, 4, 100, bad, () => 0,
      { useTranspositionTable: true })).toThrow(RangeError);
  });

  it.each([1, -1])('reuses numeric Infinity without promoting it to a win/loss category: sign=%i', sign => {
    const s = constructed('tt-overflow', [[8,8,'king','sente'],[0,0,'king','gote'],
      [6,3,'pawn','sente'],[6,5,'pawn','sente']]);
    const evaluation = { ...TABLE, unpromoted: { ...TABLE.unpromoted, pawn: sign * Number.MAX_VALUE } };
    const stats = createTranspositionTableStatistics();
    const on = ai.analyzeAlphaBetaSearch(s, 4, evaluation, () => 0,
      { useTranspositionTable: true, transpositionTableStatistics: stats });
    const off = ai.analyzeAlphaBetaSearch(s, 4, evaluation, () => 0);
    expect(stats.exactReuses).toBeGreaterThan(0);
    expect(on.selectedAction).toEqual(off.selectedAction);
    expect(on.selectedEvaluation).toBe(sign * Infinity);
    expect(on.evaluationBreakdown.terminal).toBeNull();
    expect(on.principalVariation).toEqual(off.principalVariation);
    observePv(s, on.principalVariation);
  });

  it('independently checks every saved subtree, including q cutoffs and window-edge terminal categories', () => {
    const s = position('mixed-distance');
    const contexts = new Map<string, { state: typeof s; depth: number; ply: number }>();
    const originalKey = ExactTranspositionTable.prototype.key;
    vi.spyOn(ExactTranspositionTable.prototype, 'key').mockImplementation(function(this: ExactTranspositionTable<unknown>, state, depth, ply) {
      const key = originalKey.call(this, state, depth, ply);
      contexts.set(key, { state, depth, ply }); return key;
    });
    const saved = vi.spyOn(ExactTranspositionTable.prototype, 'store');
    const r = ai.analyzeAlphaBetaSearch(s, 3, undefined, undefined,
      { useTranspositionTable: true, quiescence: { maxTacticalDepth: 1 } });
    expect(r.cutoffCount + r.quiescenceCutoffCount).toBeGreaterThan(0);
    expect(saved.mock.calls.length).toBeGreaterThan(0);
    for (const [key, , result] of saved.mock.calls) {
      const context = contexts.get(key)!;
      const node = result as { principalVariation: legal.LegalAction[]; evaluationBreakdown: unknown };
      const actual = observePv(context.state, node.principalVariation, s.turn);
      if (actual.terminalDistancePly !== null) actual.terminalDistancePly += context.ply;
      const reference = exhaustive(context.state, context.depth, 1, s.turn, context.ply);
      expect(compareReference(actual, reference)).toBe(0);
      expect(node.evaluationBreakdown).toEqual(actual.breakdown);
    }
  });

  it('retains existing check counts when there are no hits and protects fallback/partial priority', () => {
    const s = position('mixed-distance');
    for (const limit of [0, 5, 20, 50, 100, 250]) {
      const run = (enabled: boolean) => {
        let reads = 0;
        return ai.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s, 1, limit, undefined, () => reads++,
          { useTranspositionTable: enabled, quiescence: { maxTacticalDepth: 1 } });
      };
      expect(run(true)).toEqual(run(false));
    }
  });

  it('checks the deadline before returning a cached hit and preserves completed results', () => {
    const s = constructed('tt-time', [[8,8,'king','sente'], [0,0,'king','gote']]);
    const stats = createTranspositionTableStatistics();
    let expired = false;
    const result = ai.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s, 5, 100, undefined,
      () => { if (stats.exactReuses > 0) expired = true; return expired ? 100 : 0; },
      { useTranspositionTable: true, transpositionTableStatistics: stats, quiescence: { maxTacticalDepth: 1 } });
    expect(stats.exactReuses).toBeGreaterThan(0);
    expect(result.timedOut).toBe(true);
    expect(result.resultSource).toBe('completed-iteration');
    expect(result.completedDepth).toBeLessThan(5);
    expect(result.principalVariation).toEqual(result.iterations.at(-1)!.principalVariation);
  });
});
