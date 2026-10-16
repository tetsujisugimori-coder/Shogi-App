import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createInitialBoardState, type BoardState } from '../types/shogi';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch as timed } from '../domain/shogi/twoPlyAlphaBetaAi';
import { getLegalActions } from '../domain/shogi/legalActions';
import { SOURCE } from '../../scripts/benchmarks/timedDepthOneDiagnostics';
import { positionsFromGames, plan, runGame, outcome, summarize, json, parse, hash, validateContract,
  type Game, type Result, type Attempt } from '../../scripts/benchmarks/partialRootMatches';

const ids = ['initial', 'g1', 'g2', 'g3', 'g4'];
const fallback = (s: BoardState) => ({ ...timed(s, 4, 0, undefined, () => 0), actualElapsedMilliseconds: 0 });
describe('fixed partial-root match diagnostic', () => {
  it('fixes twenty games, balanced budgets, engines, positions and exchange pairs', () => {
    const games = plan(ids);
    expect(games).toHaveLength(20); expect(new Set(games.map(g => g.id)).size).toBe(20);
    for (const position of ids) for (const budget of [100, 1000]) {
      const pair = games.filter(g => g.position === position && g.budget === budget);
      expect(pair.map(g => g.sente).sort()).toEqual(['c', 'old']);
      expect(pair.map(g => g.gote).sort()).toEqual(['c', 'old']);
      expect(pair[0].pair).toBe(pair[1].pair);
    }
    expect(games.map(g => g.executionIndex)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
  it('replays all four saved games at the predeclared 20/30/40/50 plies with full history', () => {
    const games = readFileSync(SOURCE, 'utf8').trim().split(/\r?\n/).map(parse).filter(g => g.type === 'game');
    const positions = positionsFromGames(games);
    expect(positions).toHaveLength(5);
    expect(new Set(positions.map(p => p.stateHash)).size).toBe(5);
    for (const [i, p] of positions.slice(1).entries()) {
      expect(p.state.history).toHaveLength(20 + i * 10); expect(p.actions).toHaveLength(20 + i * 10);
      expect(p.state.positionHistory!.length).toBeGreaterThan(0);
      expect(p.state.positionSnapshots!.length).toBeGreaterThan(0);
      expect(hash(p.state)).toBe(p.stateHash);
    }
  });
  it('passes independent protected states, turns, budget and correct engine; preserves input', () => {
    const state = createInitialBoardState(), before = structuredClone(state);
    const calls: { engine: string; budget: number; turn: string; state: BoardState }[] = [];
    const game = runGame(plan(ids)[1], state, (s, engine, budget) => {
      calls.push({ engine, budget, turn: s.turn, state: s }); return fallback(s);
    }, 2);
    expect(game.result.status).toBe('max_plies'); expect(outcome(game)).toBe('max_plies');
    expect(calls.map(c => [c.engine, c.budget, c.turn])).toEqual([['old', 100, 'sente'], ['c', 100, 'gote']]);
    expect(calls[0].state).not.toBe(calls[1].state); expect(state).toEqual(before);
    expect(() => { calls[0].state.history.length = 0; }).toThrow();
    const mutation = runGame(plan(ids)[0], state, s => { s.history.length = 0; return fallback(s); }, 1);
    expect(mutation.result).toMatchObject({ status: 'failed', failure: { code: 'input_mutation' } });
  });
  it('rejects missing/broken contracts, illegal actions and wrong turns without substituting moves', () => {
    const state = createInitialBoardState();
    const bad: ((r: Result) => void)[] = [
      r => { r.selectedAction = null; }, r => { r.selectedEvaluation = NaN; },
      r => { r.selectedAction!.player = 'gote'; }, r => { r.selectedAction!.to = { row: 4, col: 4 }; },
      r => { r.resultSource = 'completed-iteration'; }, r => { r.requestedMaxDepth = 3; },
    ];
    for (const change of bad) {
      const g = runGame(plan(ids)[0], state, s => { const r = fallback(s); change(r); return r; }, 2);
      expect(g.result.status).toBe('failed'); expect(g.result.plies).toHaveLength(0);
    }
  });
  it('preserves partial metadata and rejects it on old API, including broken partial contracts', () => {
    const state = createInitialBoardState(); let reads = 0;
    const result = timed(state, 4, 100, undefined, () => ++reads >= 7 ? 100 : 0);
    expect(result.resultSource).toBe('partial-root');
    expect(() => validateContract(state, result, 'c')).not.toThrow();
    expect(() => validateContract(state, result, 'old')).toThrow();
    const saved = parse(json(result)); expect(saved).toEqual(result);
    delete saved.partialRoot; expect(() => validateContract(state, saved, 'c')).toThrow();
    const old = fallback(state); expect(old.partialRoot).toBeUndefined();
    expect(() => validateContract(state, old, 'old')).not.toThrow();
  });
  it('separates normal win, rule draw, diagnostic cap and failure; regenerates counts', () => {
    const state = createInitialBoardState();
    const ended = structuredClone(state); ended.status = 'ended';
    ended.result = { endReason: 'checkmate', winner: 'sente', loser: 'gote' };
    const draw = structuredClone(ended); draw.result = { endReason: 'repetition', winner: null, loser: null };
    const p = plan(ids)[0];
    const win = runGame(p, ended, fallback);
    const ruleDraw = runGame({ ...p, id: 'draw' }, draw, fallback);
    const cap = runGame({ ...p, id: 'cap' }, state, fallback, 0);
    const failed = runGame({ ...p, id: 'failure' }, state, () => { throw Error('controlled failure'); });
    expect([win, ruleDraw, cap, failed].map(outcome)).toEqual(['c_win', 'draw', 'max_plies', 'failed']);
    const raw: Game[] = parse(json([win, ruleDraw, cap, failed]));
    const summary = summarize(raw, []);
    expect(summary).toEqual(summarize([win, ruleDraw, cap, failed], []));
    expect(summary.conditions[0]).toMatchObject({ games: 4, outcomes: { c_win: 1, c_loss: 0, draw: 1, max_plies: 1, failed: 1 },
      winRate: { value: .75, denominator: 2, excludedCap: 1, excludedFailure: 1 } });
  });
  it('keeps API/call time, missing values and non-finite scores distinct in raw and summary', () => {
    expect(parse(json([null, Infinity, -Infinity, NaN]))).toEqual([null, Infinity, -Infinity, NaN]);
    const p = plan(ids)[0], state = createInitialBoardState();
    const g = runGame(p, state, fallback, 1);
    const attempt: Attempt = { game: p.id, engine: 'c', ply: 1, budget: 100, stateHash: hash(state),
      callMs: 105, apiMs: 103, overrunMs: 5, apiOverrunMs: 3 };
    const summary = summarize([g], [attempt]);
    expect(summary.conditions[0].engines[1]).toMatchObject({ moves: 1, calls: 1,
      depths: { 0: 1 }, callMs: { median: 105, p95: 105 }, overrunMs: { max: 5 } });
    expect(getLegalActions(state)).toContainEqual(g.result.plies[0].action);
  });
  it('replays raw results without search and matches every ply, full final state and aggregate', () => {
    const state = createInitialBoardState(), p = plan(ids)[0];
    const results: ReturnType<typeof fallback>[] = [];
    const game = runGame(p, state, s => { const r = fallback(s); results.push(r); return r; }, 3);
    let i = 0;
    const replay = runGame(p, state, () => parse(json(results[i++])), 3);
    expect(i).toBe(3); expect(replay).toEqual(game);
    // cloneBoardState adds optional undefined properties; JSON omits them.
    expect(replay.result.finalState).toHaveProperty('branchFrom', undefined);
    expect(parse(json(replay))).toStrictEqual(parse(json(game)));
    expect(summarize([parse(json(game))], [])).toEqual(summarize([replay], []));
  });
});
