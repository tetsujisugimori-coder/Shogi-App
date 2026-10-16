import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInitialBoardState, type BoardState } from '../../src/types/shogi';
import { getLegalActions, executeLegalAction, type LegalAction } from '../../src/domain/shogi/legalActions';
import { createPositionKey } from '../../src/domain/shogi/repetition';
import { runSelfPlayGame, type SelfPlayGameResult } from '../../src/domain/shogi/selfPlayGame';
import { validatePartialRoot } from '../../src/application/partialRootValidation';
import type { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch as Search } from '../../src/domain/shogi/twoPlyAlphaBetaAi';

export type Engine = 'old' | 'c';
export type Result = ReturnType<typeof Search>;
export const SHAS = { old: 'cc37291a121a9bf72cef222ff472e5d2f1e90f45', c: '70a9a0f753abf76dd24d605caa361e06f17f1266' };
export const SETTINGS = { maxDepth: 4, evaluationPreset: 'standard', options: {
  moveOrdering: 'standard' as const, killerMoves: false,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const },
}, maxPlies: 200, warmupPerEnginePerBudget: 2 };
export const json = (v: unknown) => JSON.stringify(v, (_k, n: unknown) => typeof n === 'number' && !Number.isFinite(n)
  ? n === Infinity ? '+Infinity' : n === -Infinity ? '-Infinity' : 'NaN' : n);
export const parse = (s: string): any => JSON.parse(s, (_k, n: unknown) => n === '+Infinity' ? Infinity : n === '-Infinity' ? -Infinity : n === 'NaN' ? NaN : n);
export const hash = (v: unknown) => createHash('sha256').update(json(v)).digest('hex');
export const byteHash = (v: Buffer) => createHash('sha256').update(v).digest('hex');
export type Position = { id: string; state: BoardState; actions: LegalAction[]; stateHash: string };
export function positionsFromGames(games: { plies: { action: LegalAction; positionKey: string }[] }[]): Position[] {
  const initial = createInitialBoardState(); initial.recordId = 'partial-root-match-initial';
  const positions: Position[] = [{ id: 'initial', state: initial, actions: [], stateHash: hash(initial) }];
  assert.equal(games.length, 4);
  games.forEach((game, i) => {
    let state = structuredClone(initial);
    const actions = game.plies.slice(0, 20 + i * 10).map(p => p.action);
    assert.equal(actions.length, 20 + i * 10);
    for (const [j, action] of actions.entries()) {
      assert.equal(createPositionKey(state), game.plies[j].positionKey);
      assert.ok(getLegalActions(state).some(a => json(a) === json(action)));
      const next = executeLegalAction(state, action, { proposer: 'local_ai' });
      assert.equal(next.type, 'applied'); if (next.type !== 'applied') throw Error('fixture');
      state = next.state;
    }
    assert.notEqual(state.status, 'ended');
    positions.push({ id: `g${i + 1}-after${actions.length}`, state, actions, stateHash: hash(state) });
  });
  assert.equal(new Set(positions.map(p => createPositionKey(p.state))).size, 5);
  return positions;
}
export function plan(ids: string[]) {
  assert.equal(ids.length, 5);
  return ids.flatMap((position, i) => (i % 2 ? [1000, 100] : [100, 1000]).flatMap(budget =>
    (i % 2 ? ['old', 'c'] : ['c', 'old']).map(sente => ({ position, budget, sente: sente as Engine,
      gote: (sente === 'c' ? 'old' : 'c') as Engine, pair: `${position}-${budget}` }))))
    .map((g, i) => ({ ...g, id: `game-${String(i + 1).padStart(2, '0')}`, executionIndex: i + 1 }));
}
export type GamePlan = ReturnType<typeof plan>[number];
export type Attempt = { game: string; ply: number; engine: Engine; budget: number; stateHash: string;
  result?: Result; error?: string; callMs: number; apiMs: number | null; overrunMs: number; apiOverrunMs: number | null };
export type Game = GamePlan & { result: SelfPlayGameResult; initialStateHash: string;
  implementations: { sente: { id: Engine; sha: string }; gote: { id: Engine; sha: string } }; settings: typeof SETTINGS };

// The old API already reports source/depth/evaluation/PV. No observations are invented.
// The full API object is kept in the journal; the existing game runner validates
// observations, turn, selected action, PV legality and applies the canonical move.
export function validateContract(state: BoardState, result: Result, engine: Engine) {
  assert.ok(result && typeof result === 'object');
  assert.equal(result.requestedMaxDepth, 4);
  assert.equal(result.rootLegalActionCount, getLegalActions(state).length);
  assert.equal(result.depth, result.completedDepth);
  assert.ok(Number.isFinite(result.elapsedMilliseconds) && result.elapsedMilliseconds >= 0);
  assert.ok(['completed-iteration', 'partial-root', 'fallback', 'no-legal-actions', 'ended-position'].includes(result.resultSource));
  assert.ok(Array.isArray(result.iterations));
  if (engine === 'old') assert.notEqual(result.resultSource, 'partial-root');
  if (result.resultSource === 'partial-root') assert.ok(validatePartialRoot(state, result, 1));
  else assert.equal(result.partialRoot, undefined);
  if (result.resultSource === 'completed-iteration') {
    assert.ok(result.completedDepth >= 1 && result.completedDepth <= 4);
    assert.equal(result.iterations.length, result.completedDepth);
    assert.notEqual(result.selectedEvaluation, null);
    assert.notEqual(result.evaluationBreakdown, null);
    const last = result.iterations.at(-1)!;
    for (const key of ['depth', 'selectedAction', 'selectedEvaluation', 'principalVariation', 'evaluationBreakdown'] as const)
      assert.deepEqual(result[key], last[key]);
  } else if (result.resultSource === 'fallback') {
    assert.equal(result.completedDepth, 0); assert.equal(result.iterations.length, 0);
  } else if (result.resultSource !== 'partial-root') {
    assert.equal(result.selectedAction, null);
    assert.ok(state.status === 'ended' || getLegalActions(state).length === 0);
  }
}
export function runGame(p: GamePlan, initialState: BoardState, search: (s: BoardState, e: Engine, budget: number) => Result & { actualElapsedMilliseconds: number }, maxPlies = SETTINGS.maxPlies): Game {
  const participant = (engine: Engine) => ({ settings: engine, search: (s: BoardState) => {
    const r = search(s, engine, p.budget); validateContract(s, r, engine); return r;
  } });
  return { ...p, initialStateHash: hash(initialState),
    implementations: { sente: { id: p.sente, sha: SHAS[p.sente] }, gote: { id: p.gote, sha: SHAS[p.gote] } },
    settings: { ...SETTINGS, maxPlies },
    result: runSelfPlayGame({ initialState, maxPlies, sente: participant(p.sente), gote: participant(p.gote) }) };
}
export const outcome = (g: Game) => g.result.status !== 'ended' ? g.result.status : g.result.gameResult.winner === null
  ? 'draw' : g[g.result.gameResult.winner] === 'c' ? 'c_win' : 'c_loss';
const countBy = (xs: (string | number)[]) => Object.fromEntries([...new Set(xs)].sort().map(x => [x, xs.filter(v => v === x).length]));
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { count: s.length,
  median: s.length ? s[Math.ceil(s.length * .5) - 1] : null,
  p95: s.length ? s[Math.ceil(s.length * .95) - 1] : null, max: s.length ? s.at(-1)! : null }; };
export function summarize(games: Game[], attempts: Attempt[]) {
  return { totalGames: games.length, conditions: [100, 1000].map(budget => {
    const own = games.filter(g => g.budget === budget);
    const counts = (gs: Game[]) => Object.fromEntries(['c_win', 'c_loss', 'draw', 'max_plies', 'failed'].map(k => [k, gs.filter(g => outcome(g) === k).length]));
    const ended = own.filter(g => g.result.status === 'ended');
    return { budget, games: own.length, outcomes: counts(own), winRate: {
      value: ended.length ? (ended.filter(g => outcome(g) === 'c_win').length + ended.filter(g => outcome(g) === 'draw').length * .5) / ended.length : null,
      denominator: ended.length, drawCredit: .5, excludedCap: own.filter(g => g.result.status === 'max_plies').length,
      excludedFailure: own.filter(g => g.result.status === 'failed').length },
      cSente: counts(own.filter(g => g.sente === 'c')), cGote: counts(own.filter(g => g.gote === 'c')),
      pairs: [...new Set(own.map(g => g.pair))].map(pair => ({ pair, games: own.filter(g => g.pair === pair).map(g => ({ id: g.id, cSide: g.sente === 'c' ? 'sente' : 'gote', outcome: outcome(g) })) })),
      perGame: own.map(g => ({ id: g.id, plies: g.result.plies.length, outcome: outcome(g), reason: g.result.status === 'ended' ? g.result.gameResult : g.result.status === 'failed' ? g.result.failure : 'diagnostic-cap' })),
      engines: (['old', 'c'] as const).map(engine => {
        const plies = own.flatMap(g => g.result.plies.filter(p => g[p.player] === engine));
        const calls = attempts.filter(a => a.budget === budget && a.engine === engine);
        return { engine, moves: plies.length, calls: calls.length, sources: ['completed-iteration', 'partial-root', 'fallback'].map(source => ({ source,
          count: plies.filter(p => p.resultSource === source).length, fraction: plies.length ? plies.filter(p => p.resultSource === source).length / plies.length : null })),
          depths: countBy(plies.map(p => p.completedDepth ?? 'unavailable')), apiMs: stats(calls.flatMap(a => a.apiMs === null ? [] : [a.apiMs])),
          callMs: stats(calls.map(a => a.callMs)), overrunMs: stats(calls.map(a => a.overrunMs)),
          apiOverrunMs: stats(calls.flatMap(a => a.apiOverrunMs === null ? [] : [a.apiOverrunMs])),
          overBudgetCalls: calls.filter(a => a.overrunMs > 0).length };
      }) };
  }) };
}
