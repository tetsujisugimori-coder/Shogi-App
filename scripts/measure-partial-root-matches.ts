import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPositionKey } from '../src/domain/shogi/repetition';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { SHAS, SETTINGS, json, parse, hash, byteHash, positionsFromGames, plan, runGame, summarize,
  type Position, type GamePlan, type Game, type Attempt, type Engine, type Result } from './benchmarks/partialRootMatches';

const [mode, outArg, oldArg, cArg] = process.argv.slice(2);
assert.ok(['prepare', 'run', 'audit'].includes(mode) && outArg, 'prepare OUT | run OUT OLD_CHECKOUT C_CHECKOUT | audit OUT');
const out = path.resolve(outArg);
const git = (args: string[], cwd = process.cwd()) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (name: string, value: unknown) => writeFileSync(path.join(out, name), json(value) + '\n', { flag: 'wx' });
const read = (name: string) => parse(readFileSync(path.join(out, name), 'utf8'));
const packedWrite = (name: string, value: unknown) => writeFileSync(path.join(out, name), gzipSync(json(value)), { flag: 'wx' });
const packedRead = (name: string) => parse(gunzipSync(readFileSync(path.join(out, name))).toString());
const journal = (name: string, value: unknown) => appendFileSync(path.join(out, name), json(value) + '\n');
const readAttempts = (): Attempt[] => {
  const file = path.join(out, 'attempts.jsonl');
  const content = existsSync(file) ? readFileSync(file, 'utf8') : gunzipSync(readFileSync(file + '.gz')).toString();
  return content.trim() ? content.trim().split(/\r?\n/).map(parse) : [];
};
if (mode === 'prepare') {
  mkdirSync(out); // Refuse overwrite.
  const source = readFileSync(SOURCE);
  const games = source.toString().trim().split(/\r?\n/).map(parse).filter(r => r.type === 'game');
  const positions = positionsFromGames(games);
  packedWrite('positions.json.gz', positions);
  write('plan.json', { createdAt: new Date().toISOString(), shas: SHAS, settings: SETTINGS,
    source: SOURCE, sourceByteSha256: byteHash(source), positionsByteSha256: byteHash(readFileSync(path.join(out, 'positions.json.gz'))),
    selection: 'initial plus 20/30/40/50 legal plies from source games 1/2/3/4 respectively; fixed before outcomes; not selected by C scores',
    warmup: 'initial position, budgets 100 then 1000, two rounds each, old/c order reversed on second round; eight calls total',
    order: 'position blocks; budget order and first C side alternate across blocks; each exchange pair adjacent',
    games: plan(positions.map(p => p.id)) });
  console.log('Frozen 5 positions / 10 exchange pairs / 20 games.');
} else {
  const frozen = read('plan.json');
  assert.deepEqual(frozen.shas, SHAS); assert.deepEqual(frozen.settings, SETTINGS);
  assert.equal(frozen.positionsByteSha256, byteHash(readFileSync(path.join(out, 'positions.json.gz'))));
  const positions = packedRead('positions.json.gz') as Position[];
  assert.deepEqual(frozen.games, plan(positions.map(p => p.id)));
  for (const p of positions) assert.equal(hash(p.state), p.stateHash);
  if (mode === 'run') {
    assert.ok(oldArg && cArg);
    assert.ok(!existsSync(path.join(out, 'environment.json')), 'Do not resume/repeat into existing raw output');
    const dirs = { old: path.resolve(oldArg), c: path.resolve(cArg) };
    assert.notEqual(dirs.old, dirs.c); assert.notEqual(dirs.old, process.cwd()); assert.notEqual(dirs.c, process.cwd());
    const load = async (engine: Engine) => {
      const dir = dirs[engine];
      assert.equal(git(['rev-parse', 'HEAD'], dir), SHAS[engine]);
      assert.equal(git(['status', '--porcelain', '--untracked-files=all'], dir), '');
      const imp = (file: string) => import(pathToFileURL(path.join(dir, file)).href);
      return { search: (await imp('src/domain/shogi/twoPlyAlphaBetaAi.ts')).analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch,
        key: (await imp('src/domain/shogi/repetition.ts')).createPositionKey,
        legal: (await imp('src/domain/shogi/legalActions.ts')).getLegalActions,
        preset: (await imp('src/domain/shogi/searchEvaluationPresets.ts')).resolveSearchEvaluationPreset('standard') };
    };
    const engines = { old: await load('old'), c: await load('c') };
    assert.notEqual(engines.old.search, engines.c.search);
    assert.notEqual(engines.old.legal, engines.c.legal);
    write('environment.json', { startedAt: new Date().toISOString(), node: process.version,
      npm: execFileSync('npm.cmd', ['--version'], { encoding: 'utf8', shell: true }).trim(),
      platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model,
      dirs, shas: SHAS, harnessSha: git(['rev-parse', 'HEAD']), harnessStatus: git(['status', '--porcelain']),
      sourceHashes: Object.fromEntries(['scripts/measure-partial-root-matches.ts', 'scripts/benchmarks/partialRootMatches.ts'].map(f => [f, byteHash(readFileSync(f))])),
      planSha256: byteHash(readFileSync(path.join(out, 'plan.json'))),
      clock: 'performance.now; search receives undefined clock and no diagnostics hook',
      execution: 'one synchronous process, distinct absolute module graphs, serial warmup and games; no tests/build/other benchmark during run' });
    const call = (state: Parameters<typeof runGame>[1], engine: Engine, budget: number, game: string, ply: number, warmup = false) => {
      // All state interpretation checks, copies, logging and result validation are outside the clock interval.
      for (const other of Object.values(engines)) {
        assert.equal(other.key(state), createPositionKey(state));
        assert.deepEqual(other.legal(state), getLegalActions(state));
      }
      const stateHash = hash(state);
      let result: Result | undefined, error: string | undefined;
      const start = performance.now();
      try { result = engines[engine].search(state, 4, budget, engines[engine].preset, undefined, SETTINGS.options); }
      catch (e) { error = e instanceof Error ? e.stack ?? e.message : String(e); }
      const callMs = performance.now() - start;
      const apiMs = result?.elapsedMilliseconds ?? null;
      const attempt: Attempt = { game, ply, engine, budget, stateHash, result, error, callMs, apiMs,
        overrunMs: Math.max(0, callMs - budget), apiOverrunMs: apiMs === null ? null : Math.max(0, apiMs - budget) };
      journal(warmup ? 'warmup.jsonl' : 'attempts.jsonl', attempt);
      assert.equal(hash(state), stateHash);
      if (error || !result) throw Error(error ?? 'Missing search result');
      return { ...result, actualElapsedMilliseconds: callMs };
    };
    for (const budget of [100, 1000]) for (let round = 0; round < 2; round++) {
      for (const engine of (round ? ['c', 'old'] : ['old', 'c']) as Engine[]) {
        const input = protectSearchInput(positions[0].state);
        const p = frozen.games.find((g: GamePlan) => g.budget === budget) as GamePlan;
        const warm = runGame({ ...p, sente: engine }, input.snapshot, (s, e, b) => call(s, e, b, 'warmup', 1, true), 1);
        assert.equal(warm.result.status, 'max_plies'); assert.equal(input.wasMutated(), false);
      }
    }
    for (const p of frozen.games as GamePlan[]) {
      journal('events.jsonl', { event: 'game-start', id: p.id, at: new Date().toISOString() });
      let ply = 0;
      const game = runGame(p, positions.find(v => v.id === p.position)!.state, (s, e, b) => call(s, e, b, p.id, ++ply));
      packedWrite(`${p.id}.json.gz`, game);
      journal('events.jsonl', { event: 'game-finish', id: p.id, status: game.result.status, plies: game.result.plies.length, at: new Date().toISOString() });
      console.log(`${p.id} ${p.budget}ms ${game.result.status} ${game.result.plies.length} plies`);
    }
    write('completed.json', { at: new Date().toISOString(), games: 20 });
    writeFileSync(path.join(out, 'attempts.jsonl.gz'), gzipSync(readFileSync(path.join(out, 'attempts.jsonl'))), { flag: 'wx' });
  } else {
    const attempts = readAttempts();
    const games: Game[] = [];
    for (const p of frozen.games as GamePlan[]) {
      const saved = packedRead(`${p.id}.json.gz`) as Game;
      const own = attempts.filter(a => a.game === p.id); let index = 0;
      const replayed = runGame(p, positions.find(v => v.id === p.position)!.state, (s, e, budget) => {
        const a = own[index++]; assert.ok(a, 'missing attempt');
        assert.equal(a.ply, index); assert.equal(a.engine, e); assert.equal(a.budget, budget); assert.equal(a.stateHash, hash(s));
        assert.ok(Number.isFinite(a.callMs) && a.callMs >= 0);
        assert.equal(a.overrunMs, Math.max(0, a.callMs - budget));
        assert.equal(a.apiMs, a.result?.elapsedMilliseconds ?? null);
        assert.equal(a.apiOverrunMs, a.apiMs === null ? null : Math.max(0, a.apiMs - budget));
        if (a.error || !a.result) throw Error(a.error ?? 'Missing search result');
        return { ...a.result, actualElapsedMilliseconds: a.callMs };
      });
      // JSON omits optional undefined object properties (e.g. branchFrom and
      // isPromoted). Compare the entire replay in that same persisted format.
      assert.equal(index, own.length); assert.deepEqual(parse(json(replayed)), saved);
      games.push(saved);
    }
    assert.equal(attempts.length, games.reduce((n, g) => n + g.result.plies.length + (g.result.status === 'failed' ? 1 : 0), 0));
    const summary = summarize(games, attempts);
    if (existsSync(path.join(out, 'summary.json'))) assert.deepEqual(read('summary.json'), summary);
    else write('summary.json', summary);
    console.log(json({ audit: 'passed', games: games.length, attempts: attempts.length, summary }));
  }
}
