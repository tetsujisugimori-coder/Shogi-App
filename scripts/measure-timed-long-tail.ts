import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { createPositionKey } from '../src/domain/shogi/repetition';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { resolveSearchEvaluationPreset } from '../src/domain/shogi/searchEvaluationPresets';
import { DEFAULT_CONFIG, runMeasurement } from './benchmarks/timedFallbackSelfPlay';
import { replayPositions } from './benchmarks/timedDepthOneDiagnostics';
import { summarizeLongTail, type LongTailSample } from './benchmarks/timedLongTail';

const args = process.argv.slice(2);
const allowed = new Set(['--out', '--pairs', '--max-plies', '--warmups', '--runs', '--probe']);
const values: Record<string, string> = {};
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  if (!allowed.has(key) || !args[index + 1] || values[key] !== undefined) throw new Error(`Invalid argument: ${key}`);
  values[key] = args[index + 1];
}
if (!values['--out']?.endsWith('.jsonl')) throw new Error('Usage: npm run measure:timed-long-tail -- --out PATH.jsonl [--pairs N] [--max-plies N] [--warmups N] [--runs N] [--probe on|off]');
const integer = (key: string, fallback: number, min: number) => {
  const n = values[key] === undefined ? fallback : Number(values[key]);
  if (!Number.isSafeInteger(n) || n < min) throw new Error(`${key} must be an integer >= ${min}`);
  return n;
};
const output = resolve(values['--out']);
const report = output.slice(0, -6) + '.md';
const warmups = integer('--warmups', 1, 0);
const runs = integer('--runs', 3, 1);
const pairCount = integer('--pairs', 2, 1);
const maxPlies = integer('--max-plies', 120, 1);
const probe = values['--probe'] ?? 'on';
if (probe !== 'on' && probe !== 'off') throw new Error('--probe must be on or off');
const config = { ...DEFAULT_CONFIG, pairCount, maxPlies };
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trim();
const { positions: allPositions, sourceSha256 } = replayPositions();
const positions = allPositions.filter(position => ['g1-p115', 'g3-p55', 'g4-p89'].includes(position.id));
assert.equal(positions.length, 3);

let gcObserver: PerformanceObserver | null = null;
let gcReason: string | null = null;
const gcEntries: Array<{ start: number; duration: number; kind: number; flags: number }> = [];
const recordGc = (entries: ReturnType<PerformanceObserver['takeRecords']>) => {
  for (const entry of entries) {
    const detail = (entry as typeof entry & { detail?: { kind?: number; flags?: number } }).detail;
    gcEntries.push({ start: entry.startTime, duration: entry.duration,
      kind: detail?.kind ?? -1, flags: detail?.flags ?? -1 });
  }
};
try {
  gcObserver = new PerformanceObserver(list => recordGc(list.getEntries()));
  gcObserver.observe({ entryTypes: ['gc'] });
} catch (error) { gcReason = String(error); gcObserver?.disconnect(); gcObserver = null; }
const heapAt = () => {
  try { return { at: performance.now(), bytes: process.memoryUsage().heapUsed }; }
  catch { return null; }
};
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
type Before = { heap: ReturnType<typeof heapAt> };
const samples: LongTailSample[] = [];
function capture(input: { id: string; source: 'game' | 'replay'; gameId: string | null; ply: number;
  key: string; historyLength: number; phase: 'warmup' | 'measurement'; run: number;
  result: ReturnType<typeof analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch>;
  start: number; end: number; diagnostics: SearchDiagnostics | null; before: Before }): void {
  const after = heapAt();
  const diag = input.diagnostics;
  const callElapsedMilliseconds = input.end - input.start;
  samples.push({ type: 'sample', source: input.source, id: input.id, gameId: input.gameId,
    ply: input.ply, positionKeySha256: sha(input.key), historyLength: input.historyLength,
    probe: diag !== null, phase: input.phase, run: input.run,
    resultSource: input.result.resultSource, completedDepth: input.result.completedDepth,
    timedOut: input.result.timedOut, apiElapsedMilliseconds: input.result.elapsedMilliseconds,
    callElapsedMilliseconds, excessMilliseconds: callElapsedMilliseconds - config.timeLimitMilliseconds,
    action: input.result.selectedAction,
    diagnostics: diag?.finished ? { phases: diag.phases, ...diag.finished,
      crossedDeadlinePhase: diag.crossedDeadlinePhase, interruptedPhase: diag.interruptedPhase,
      longestCheckInterval: diag.longestCheckInterval, longestOperation: diag.longestOperation } : null,
    interval: { start: input.start, end: input.end },
    gc: { status: gcObserver ? 'available' : 'unavailable', reason: gcReason, events: [] },
    heap: { status: input.before.heap && after ? 'available' : 'unavailable',
      reason: input.before.heap && after ? null : 'process.memoryUsage failed', before: input.before.heap, after },
  });
}

mkdirSync(dirname(output), { recursive: true });
const rawFd = openSync(output, 'wx');
let reportFd: number | undefined;
const emit = (row: object) => writeSync(rawFd, JSON.stringify(row) + '\n');
try {
  reportFd = openSync(report, 'wx');
  emit({ type: 'config', schema: 'long-tail-v1', startedAt: new Date().toISOString(), head,
    dirty: status !== '', status, node: process.version, os: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? 'unknown', config, warmups, runs, probe, sourceSha256,
    execution: 'synchronous-serial; paired self-play then saved-position replay',
    timing: { api: 'search start clock to final clock inside API', call: 'immediately before invocation to immediately after return',
      apiOther: 'API start to API finish minus exclusive named spans; excludes caller and finish after return',
      gc: 'Node PerformanceObserver takeRecords after call; overlap on monotonic performance timeline',
      heap: 'process.memoryUsage.heapUsed samples before and after call; not an in-call peak' } });
  const games = runMeasurement(config, {
    probe: probe === 'on',
    beforeSearch: () => ({ heap: heapAt() } satisfies Before),
    onSearch: (position, result, timing) => capture({ id: '', source: 'game', gameId: null,
      ply: position.history.length + 1, key: createPositionKey(position), historyLength: position.history.length,
      phase: 'measurement', run: 1, result, start: timing.startedAt, end: timing.finishedAt,
      diagnostics: timing.diagnostics, before: timing.before as Before }),
  });
  let offset = 0;
  for (const game of games) {
    for (const ply of game.plies) {
      const sample = samples[offset++];
      assert.equal(sample.positionKeySha256, sha(ply.positionKey));
      assert.equal(sample.ply, ply.ply);
      sample.gameId = `g${game.executionIndex}`;
      sample.id = `g${game.executionIndex}-p${ply.ply}`;
    }
    emit(game);
  }
  assert.equal(offset, samples.length);
  const evaluation = resolveSearchEvaluationPreset('standard');
  for (const position of positions) {
    emit({ type: 'position', id: position.id, stateSha256: position.stateSha256,
      positionKeySha256: position.positionKeySha256, historyLength: position.historyLength,
      sourceActualMilliseconds: position.sourceActualMilliseconds });
    for (let index = 0; index < warmups + runs; index++) {
      for (const enabled of index % 2 ? [true, false] : [false, true]) {
        const input = protectSearchInput(position.state);
        const before: Before = { heap: heapAt() };
        const diagnostics = enabled ? new SearchDiagnostics() : undefined;
        const start = performance.now();
        const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot, config.maxDepth,
          config.timeLimitMilliseconds, evaluation, performance.now.bind(performance),
          { moveOrdering: config.moveOrdering, quiescence: { maxTacticalDepth: config.maxTacticalDepth,
            moveOrdering: config.quiescenceMoveOrdering } }, diagnostics);
        const end = performance.now();
        assert.equal(input.wasMutated(), false);
        capture({ id: position.id, source: 'replay', gameId: null, ply: position.historyLength + 1,
          key: createPositionKey(position.state), historyLength: position.historyLength,
          phase: index < warmups ? 'warmup' : 'measurement', run: index < warmups ? index + 1 : index - warmups + 1,
          result, start, end, diagnostics: diagnostics ?? null, before });
      }
    }
  }
  // Node dispatches GC performance entries on an event-loop turn, while search
  // calls above are intentionally synchronous. Associate them only afterwards.
  await new Promise<void>(resolve => setImmediate(resolve));
  if (gcObserver) recordGc(gcObserver.takeRecords());
  for (const sample of samples) sample.gc.events = gcEntries.filter(entry =>
    entry.start < sample.interval.end && entry.start + entry.duration > sample.interval.start)
    .map(entry => ({ ...entry, overlapsSearch: true }));
  for (const sample of samples) emit(sample);
  const summary = summarizeLongTail(samples);
  emit({ type: 'summary', ...summary });
  emit({ type: 'end', endedAt: new Date().toISOString() });
  const top = samples.filter(sample => sample.phase === 'measurement')
    .sort((a, b) => b.callElapsedMilliseconds - a.callElapsedMilliseconds).slice(0, 10);
  const overlapping = samples.filter(sample => sample.phase === 'measurement' && sample.gc.events.length)
    .flatMap(sample => sample.gc.events.map(event => ({ id: sample.id, ...event }))).slice(0, 10);
  const heapByGame = games.map(game => {
    const own = samples.filter(sample => sample.gameId === `g${game.executionIndex}`);
    return `${game.executionIndex}: ${own[0]?.heap.before?.bytes ?? 'n/a'} → ${own.at(-1)?.heap.after?.bytes ?? 'n/a'} bytes`;
  });
  const lines = ['# 100ms探索の長い尾', '',
    `コード ${head}、dirty=${status !== ''}、Node ${process.version}、${platform()} ${release()} ${arch()}、${cpus()[0]?.model ?? 'unknown'}。`,
    `同期直列${games.length}局、最大${maxPlies}手、保存棋譜3局面のOFF/ON各${warmups}ウォームアップ・${runs}本測定。対局診断${probe}。`,
    'API内実時間は探索内の開始時計から返却直前の時計まで。呼び出し全体は呼出直前から戻り直後まで。api-otherはAPI内時間から排他的工程を差し引く。旧PR #156の保存値は戻り後の診断終了まで含むため比較時は旧定義として扱う。',
    `本測定${summary.samples}件、fallback ${summary.fallback}件、100ms超${summary.over100}件、105ms超${summary.over105}件。最大超過 ${JSON.stringify(summary.maxExcess)}。`,
    `最長期限確認間隔 ${JSON.stringify(summary.longestCheck)}。root内部の最長同期処理 ${JSON.stringify(summary.longestRootInterior)}。静止探索内部の最長同期処理 ${JSON.stringify(summary.longestQuiescenceInterior)}。`,
    `GC観測${summary.gcEvents}イベント、探索時間と重複${summary.gcOverlaps}件、GC欠測${summary.missingGc}件。重複は因果関係を示さない。ヒープ欠測${summary.missingHeap}件。最初と最後のサンプル ${JSON.stringify(summary.heapFirst)} → ${JSON.stringify(summary.heapLast)}。これらは処理中の最大値ではない。`,
    `保存棋譜局面の診断OFF/ON対応差（ON-OFF、ms）: ${JSON.stringify(summary.probePairs)}。単一順序の反復なので計測負荷だけを分離できない。`,
    '', '| 局面 | 由来 | 診断 | 実時間ms | API内ms | 超過ms | 深さ | GC重複 | 前後heap bytes |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...top.map(row => `| ${row.id} | ${row.resultSource} | ${row.probe ? 'ON' : 'OFF'} | ${row.callElapsedMilliseconds.toFixed(2)} | ${row.apiElapsedMilliseconds.toFixed(2)} | ${row.excessMilliseconds.toFixed(2)} | ${row.completedDepth} | ${row.gc.events.length} | ${row.heap.before?.bytes ?? 'n/a'} → ${row.heap.after?.bytes ?? 'n/a'} |`),
    '', `対局別ヒープ前後: ${heapByGame.join('、')}。`,
    `GC重複例（時刻はperformance時間軸のms）: ${JSON.stringify(overlapping)}。`,
    '保存棋譜局面は同一局面を反復する対応測定。診断時計読みと処理区分の追加により結果と時間は変わり得る。手数打切は勝敗・棋力の証拠ではない。'];
  writeSync(reportFd, lines.join('\n') + '\n');
  console.log(`${output}: ${games.length} games, ${summary.samples} measurement samples`);
} finally {
  gcObserver?.disconnect();
  closeSync(rawFd);
  if (reportFd !== undefined) closeSync(reportFd);
}
