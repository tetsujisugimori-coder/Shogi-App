import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus, platform, release, arch } from 'node:os';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { BoardState } from '../src/types/shogi';
import type { LegalAction } from '../src/domain/shogi/legalActions';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { options, evaluation, sha256, loadPositions, positionMetadata, verifyAction, reference,
  tacticalEvidence, summarize, type TimedSample, type ReferenceRow } from './benchmarks/fallbackQuality';
import { SOURCE } from './benchmarks/timedDepthOneDiagnostics';

type Position = { id: string; state: BoardState; stateSha256: string };
const args = process.argv.slice(2);
// A process limit can stop a fixed search even when synchronous domain work
// cannot reach a cooperative interruption check. No partial result is promoted.
if (args[0] === '--worker') {
  const position: Position = JSON.parse(readFileSync(args[2], 'utf8')).positions.find((p: Position) => p.id === args[3]);
  assert.ok(position); assert.equal(sha256(position.state), position.stateSha256);
  const start = performance.now();
  const data = args[1] === 'reference' ? reference(position.state)
    : tacticalEvidence(position.state, JSON.parse(args[4]) as LegalAction);
  console.log(JSON.stringify({ ...data, processWorkMs: performance.now() - start }, (_key, value) =>
    value === Infinity ? '+Infinity' : value === -Infinity ? '-Infinity' : value));
} else {
  assert.ok(args.length === 2 && ['extract', 'timed', 'reference', 'tactics', 'audit'].includes(args[0]),
    'Usage: npx tsx scripts/measure-fallback-quality.ts extract|timed|reference|tactics|audit DIRECTORY');
  const [mode, directory] = args;
  const dir = resolve(directory); mkdirSync(dir, { recursive: true });
  const positionsPath = join(dir, 'positions.json');
  const readRows = (name: string) => readFileSync(join(dir, name), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const git = (...argv: string[]) => execFileSync('git', argv, { encoding: 'utf8' }).trim();
  const config = () => ({ type: 'config', schema: 'fallback-quality-v1', mode, startedAt: new Date().toISOString(),
    baseSha: git('rev-parse', 'origin/main'), head: git('rev-parse', 'HEAD'),
    dirty: git('status', '--porcelain=v1', '--untracked-files=all') !== '',
    status: git('status', '--porcelain=v1', '--untracked-files=all'),
    os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model, node: process.version,
    npm: execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim(),
    command: `npx tsx scripts/measure-fallback-quality.ts ${mode} ${directory}`,
    settings: { evaluation: 'standard', maxDepth: 4, budgets: [100, 1000], ...options },
    warmups: 2, runs: 5, diagnostics: false, input: 'protectSearchInput outside clock, same as saved self-play',
    execution: 'synchronous serial; timing in one process; reference/tactics in separate serial children with 120000ms process limit' });
  if (mode === 'extract') {
    const replay = loadPositions();
    write('positions.json', { config: config(), source: SOURCE, sourceSha256: replay.sourceSha256,
      selection: 'Existing seven depth-one positions plus g1-p44 (two evasions), g1-p93 and g3-p117 (prior long-tail); purposive, not random',
      positions: replay.positions.map(p => {
        const state = { ...p.state, recordId: 'replayed' };
        assert.equal(sha256(state), p.stateSha256);
        return { ...p, state, game: Number(p.id.match(/^g(\d+)/)![1]),
          nextPly: p.historyLength + 1, ...positionMetadata(state) };
      }) });
  } else {
    const document = JSON.parse(readFileSync(positionsPath, 'utf8'));
    const positions: Position[] = document.positions;
    assert.equal(new Set(positions.map(p => p.id)).size, positions.length);
    for (const p of positions) assert.equal(sha256(p.state), p.stateSha256);
    if (mode === 'audit') {
      const timed = readRows('timed.jsonl'); const refs = readRows('reference.jsonl'); const tactics = readRows('tactics.jsonl');
      for (const rows of [timed, refs, tactics]) {
        assert.equal(rows[0].positionsFileSha256, sha256(document)); assert.equal(rows.at(-1).type, 'end');
      }
      const samples = timed.filter(r => r.type === 'sample') as TimedSample[];
      assert.equal(samples.length, positions.length * 2 * 7);
      for (const p of positions) for (const budget of [100, 1000]) for (const phase of ['warmup', 'measurement']) {
        const own = samples.filter(s => s.positionId === p.id && s.budget === budget && s.phase === phase);
        assert.equal(own.length, phase === 'warmup' ? 2 : 5);
        assert.equal(new Set(own.map(s => s.run)).size, own.length);
      }
      const references = refs.filter(r => r.type === 'reference') as ReferenceRow[];
      assert.equal(references.length, positions.length);
      assert.deepEqual(references.map(r => r.positionId).sort(), positions.map(p => p.id).sort());
      write('summary.json', { schema: 'fallback-quality-summary-v1',
        inputHashes: Object.fromEntries(['timed.jsonl', 'reference.jsonl', 'tactics.jsonl', 'positions.json'].map(name => [name, sha256(readFileSync(join(dir, name), 'utf8'))])),
        uniquePositions: positions.length, measurementCalls: samples.filter(s => s.phase === 'measurement').length,
        rows: summarize(samples, references),
        tactics: tactics.filter(r => r.type === 'tactics').map(r => ({ positionId: r.positionId, status: r.status,
          missedMateInOne: r.missedMateInOne ?? null, allowsMateInOne: r.allowsMateInOne ?? null,
          alternativeAvoidsMateInOne: r.alternativeAvoidsMateInOne ?? null,
          betterOneReplyMaterialHorizon: r.betterOneReplyMaterialHorizon ?? null })) });
    } else {
      const name = `${mode}.jsonl`;
      // Exclusive creation and immediate append preserve original rows on failure.
      writeFileSync(join(dir, name), JSON.stringify({ ...config(), positionsFileSha256: sha256(document) }) + '\n', { flag: 'wx' });
      const emit = (value: object) => writeFileSync(join(dir, name), JSON.stringify(value, (_key, value) =>
        value === Infinity ? '+Infinity' : value === -Infinity ? '-Infinity' : value) + '\n', { flag: 'a' });
      if (mode === 'timed') {
        for (const position of positions) {
          const before = sha256(position.state); const legal = getLegalActions(position.state);
          for (const budget of [100, 1000]) for (let index = 0; index < 7; index++) {
            const input = protectSearchInput(position.state);
            const start = performance.now();
            const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot, 4, budget, evaluation, undefined, options);
            const callMs = performance.now() - start;
            assert.equal(input.wasMutated(), false); verifyAction(position.state, result, legal);
            assert.equal(sha256(position.state), before);
            emit({ type: 'sample', positionId: position.id, budget, phase: index < 2 ? 'warmup' : 'measurement',
              run: index < 2 ? index + 1 : index - 1, callMs, apiMs: result.elapsedMilliseconds,
              overrunMs: Math.max(0, callMs - budget), resultSource: result.resultSource, completedDepth: result.completedDepth,
              timedOut: result.timedOut, action: result.selectedAction, inputUnchanged: true, result });
          }
          console.log(`timed ${position.id}`);
        }
      } else {
        const refs = mode === 'tactics' ? readRows('reference.jsonl') : [];
        for (const position of positions) {
          const ref = refs.find(r => r.type === 'reference' && r.positionId === position.id);
          if (mode === 'tactics' && ref?.status !== 'complete') {
            emit({ type: mode, positionId: position.id, status: 'missing-reference' }); continue;
          }
          const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/measure-fallback-quality.ts', '--worker', mode,
            positionsPath, position.id, ...(mode === 'tactics' ? [JSON.stringify(ref.result.selectedAction)] : [])],
          { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
          if (child.status !== 0 || child.error) emit({ type: mode, positionId: position.id,
            status: child.error && 'code' in child.error && child.error.code === 'ETIMEDOUT' ? 'process-timeout' : 'failed',
            error: child.error?.message ?? child.stderr, exitStatus: child.status, signal: child.signal });
          else emit({ type: mode, positionId: position.id, status: 'complete', ...JSON.parse(child.stdout) });
          console.log(`${mode} ${position.id}: ${child.status === 0 ? 'complete' : 'incomplete'}`);
        }
      }
      emit({ type: 'end', endedAt: new Date().toISOString() });
    }
  }
}
