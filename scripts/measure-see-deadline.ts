// Verification only: a parent process can terminate a stuck measurement child.
// This does not participate in the application's Worker or deadline handling.
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { cpus, platform, release, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createSeeDeadlinePosition } from './benchmarks/seeDeadlinePosition';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';

const [mode, arg, ordering] = process.argv.slice(2);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sourceFiles = ['src/domain/shogi/staticExchangeEvaluation.ts', 'src/domain/shogi/twoPlyAlphaBetaAi.ts',
  'scripts/benchmarks/seeDeadlinePosition.ts', 'scripts/measure-see-deadline.ts'];
const limit = 20_000;
if (mode === 'child') {
  assert.ok(ordering === 'standard' || ordering === 'static-exchange');
  const state = createSeeDeadlinePosition();
  const before = JSON.stringify(state);
  const timeLimitMilliseconds = Number(arg);
  for (let index = 0; index < 7; index++) {
    const metadata = { positionId: 'see-deadline-branching', moveOrdering: ordering,
      timeLimitMilliseconds, maxDepth: 4, quiescence: null,
      phase: index < 2 ? 'warmup' : 'measurement', run: index < 2 ? index + 1 : index - 1 };
    process.send?.({ type: 'started', ...metadata });
    const start = performance.now();
    try {
      const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 4, timeLimitMilliseconds,
        undefined, () => performance.now(), { moveOrdering: ordering });
      const elapsedMilliseconds = performance.now() - start;
      assert.equal(JSON.stringify(state), before);
      process.send?.({ type: 'sample', ...metadata, outcome: 'returned', elapsedMilliseconds, result });
    } catch (error) {
      process.send?.({ type: 'sample', ...metadata, outcome: 'error', elapsedMilliseconds: performance.now() - start,
        error: error instanceof Error ? error.stack : String(error) });
      process.exitCode = 1;
      break;
    }
  }
} else {
  assert.ok(mode === 'before' || mode === 'after');
  assert.ok(arg?.endsWith('.jsonl'), 'Usage: node --import tsx scripts/measure-see-deadline.ts before|after OUT.jsonl');
  const fd = openSync(arg, 'wx');
  const emit = (value: object) => writeSync(fd, JSON.stringify(value) + '\n');
  try {
    emit({ type: 'config', mode, baselineHead: '5d1f83ed9db821c445f295eb15e365491740acea',
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
      sourceSha256: Object.fromEntries(sourceFiles.map(file => [file, hash(readFileSync(file, 'utf8'))])),
      node: process.version, os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model,
      startedAt: new Date().toISOString(), warmups: 2, runs: 5, verificationCutoffMilliseconds: limit,
      execution: 'serial children, no tests/build in parallel; elapsed excludes position creation and process startup' });
    emit({ type: 'position', id: 'see-deadline-branching',
      origin: 'composed from existing SEE multiple-recapture/opened-lance tests; not the unavailable review position',
      reproduction: 'createSeeDeadlinePosition()', state: createSeeDeadlinePosition() });
    for (const moveOrdering of ['static-exchange', 'standard']) for (const time of [100, 1000]) {
      await new Promise<void>((resolve, reject) => {
        const child = fork(fileURLToPath(import.meta.url), ['child', String(time), moveOrdering],
          { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, NODE_OPTIONS: '' } });
        let pending: Record<string, unknown> | undefined;
        let stderr = '', cutOff = false;
        let timer = setTimeout(terminate, limit);
        function terminate() {
          cutOff = true;
          emit({ ...pending, type: 'sample', outcome: 'verification-cutoff', verificationCutoffMilliseconds: limit,
            result: null, note: 'No search result returned; wall limit also includes parent scheduling delay.' });
          child.kill();
        }
        child.stderr?.on('data', data => { stderr += String(data); });
        child.on('message', message => {
          const item = message as Record<string, unknown>;
          clearTimeout(timer);
          if (item.type === 'started') { pending = item; timer = setTimeout(terminate, limit); }
          else { emit(item); pending = undefined; timer = setTimeout(terminate, limit); }
        });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('exit', (code, signal) => {
          clearTimeout(timer);
          emit({ type: 'child-exit', moveOrdering, timeLimitMilliseconds: time, code, signal, cutOff, stderr });
          if (code !== 0 && !cutOff) reject(new Error(`Measurement failed: ${stderr}`)); else resolve();
        });
      });
    }
    emit({ type: 'end', finishedAt: new Date().toISOString() });
  } finally { closeSync(fd); }
}
