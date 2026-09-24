import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { resolveSearchEvaluationPreset } from '../src/domain/shogi/searchEvaluationPresets';
import { POSITION_IDS, replayPositions, summarizeSamples, type Sample } from './benchmarks/timedDepthOneDiagnostics';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--out');
if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('Usage: npm run measure:timed-depth-one -- --out PATH.jsonl [--smoke]');
const smoke = args.includes('--smoke');
const output = resolve(args[outputIndex + 1]);
if (!output.endsWith('.jsonl')) throw new Error('Output must end in .jsonl');
const unknown = args.filter((value, index) => value !== '--out' && value !== '--smoke' && index !== outputIndex + 1);
if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(' ')}`);
const reportPath = output.slice(0, -6) + '.md';
const warmups = smoke ? 1 : 2;
const measurements = smoke ? 1 : 5;
const { positions: allPositions, sourceSha256 } = replayPositions();
const positions = smoke ? allPositions.slice(0, 1) : allPositions;
const evaluation = resolveSearchEvaluationPreset('standard');
const options = { moveOrdering: 'standard' as const, quiescence: {
  maxTacticalDepth: 1, moveOrdering: 'original' as const } };

mkdirSync(dirname(output), { recursive: true });
const rawFd = openSync(output, 'wx');
let reportFd: number | undefined;
const emit = (row: object) => writeSync(rawFd, JSON.stringify(row) + '\n');
try {
  reportFd = openSync(reportPath, 'wx');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trim();
  emit({ type: 'config', startedAt: new Date().toISOString(), head, dirty: status !== '', status,
    source: 'docs/benchmarks/timed-fallback-100ms-20260924.jsonl', sourceSha256,
    node: process.version, os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model ?? 'unknown',
    execution: 'one-process-synchronous-serial-position-mode-probe-run', warmups, measurements,
    settings: { timeLimitMilliseconds: 100, maxDepth: 4, fixedDepth: 1, evaluation: 'standard', ...options },
    accounting: 'v2: exclusive nested spans; apiOther is API start to in-API finish minus measured spans; call time ends immediately after API return; legacy PR #156 files use v1 post-return finish',
  });
  for (const position of positions) emit({ type: 'position', id: position.id, band: position.band,
    game: Number(position.id.match(/^g(\d+)/)![1]), ply: position.historyLength + 1,
    historyLength: position.historyLength, stateSha256: position.stateSha256,
    positionKeySha256: position.positionKeySha256, sourceResult: position.sourceResult,
    sourceActualMilliseconds: position.sourceActualMilliseconds });
  const samples: Sample[] = [];
  for (const position of positions) {
    for (const mode of ['timed', 'fixed'] as const) {
      for (let index = 0; index < warmups + measurements; index++) {
        for (const probe of index % 2 === 0 ? [false, true] : [true, false]) {
          const diagnostics = probe ? new SearchDiagnostics() : undefined;
          const input = protectSearchInput(position.state);
          const start = performance.now();
          const result = mode === 'timed'
            ? analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot, 4, 100, evaluation,
              performance.now.bind(performance), options, diagnostics)
            : analyzeAlphaBetaSearch(input.snapshot, 1, evaluation,
              performance.now.bind(performance), options, diagnostics);
          const actualElapsedMilliseconds = performance.now() - start;
          assert.equal(input.wasMutated(), false);
          const finished = diagnostics?.finished;
          const sample: Sample = { type: 'sample', positionId: position.id, band: position.band, mode, probe,
            phase: index < warmups ? 'warmup' : 'measurement', run: index < warmups ? index + 1 : index - warmups + 1,
            actualElapsedMilliseconds, apiElapsedMilliseconds: result.elapsedMilliseconds,
            completedDepth: 'completedDepth' in result ? result.completedDepth : result.depth,
            resultSource: 'resultSource' in result ? result.resultSource : 'fixed-complete',
            timedOut: 'timedOut' in result ? result.timedOut : false,
            action: result.selectedAction, evaluation: result.selectedEvaluation, pv: result.principalVariation,
            diagnostics: diagnostics && finished ? { phases: diagnostics.phases, ...finished,
              crossedDeadlinePhase: diagnostics.crossedDeadlinePhase,
              interruptedPhase: diagnostics.interruptedPhase } : null };
          samples.push(sample);
          emit(sample);
      }
      }
    }
    // Fixed-depth behavior must be invariant for every position and all runs.
    const fixed = samples.filter(s => s.positionId === position.id && s.mode === 'fixed');
    for (const sample of fixed.slice(1)) {
      assert.deepEqual([sample.action, sample.evaluation, sample.pv],
        [fixed[0].action, fixed[0].evaluation, fixed[0].pv], `${position.id}: diagnostic changed fixed result`);
    }
  }
  const summary = summarizeSamples(samples);
  emit({ type: 'summary', rows: summary });
  emit({ type: 'end', endedAt: new Date().toISOString() });
  const lines = ['# 深さ1・期限超過の工程診断', '',
    `コードSHA: ${head}。保存棋譜SHA256: ${sourceSha256}。${positions.length}局面、ウォームアップ${warmups}回、本測定${measurements}回。`,
    '実対局と同じ再帰Proxyで保護した探索入力を、呼び出し時計の外で構築します。時間は入れ子を差し引いた排他的な区分です。API内実時間は探索内の開始から返却直前まで、呼び出し全体の実時間は呼出直前から戻り直後まで。api-otherはAPI内実時間から排他的工程を差し引いた値です。PR #156の保存値は戻り後のfinishまでを含む旧定義です。',
    'deadlineをまたいだ工程と、次の確認で中断を検知した工程は異なり得ます。', '',
    '| 局面帯 | 条件 | 診断 | 本測定 | 深さ1完走 | fallback | 実時間中央値ms | 最大ms | 105ms超 |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const row of summary.filter(r => r.samples)) lines.push(`| ${row.band} | ${row.mode} | ${row.probe ? 'ON' : 'OFF'} | ${row.samples} | ${row.depthOneCompletion} | ${row.fallback} | ${row.actualMedianMilliseconds?.toFixed(2) ?? 'n/a'} | ${row.actualMaxMilliseconds.toFixed(2)} | ${row.over105Count} |`);
  lines.push('', '## 工程別中央値（診断ON、ms）', '',
    '| 局面帯 | 条件 | root合法手 | 通常合法手 | 通常並べ替え | SEE | 通常着手適用 | 通常その他 | 静止探索 | APIその他 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of summary.filter(r => r.probe && r.samples)) {
    const v = row.phaseMedianMilliseconds!;
    lines.push(`| ${row.band} | ${row.mode} | ${v['root-legal']?.toFixed(2)} | ${v['normal-legal']?.toFixed(2)} | ${v['normal-order']?.toFixed(2)} | ${v.see?.toFixed(2)} | ${v['normal-execute']?.toFixed(2)} | ${v['normal-other']?.toFixed(2)} | ${v.quiescence?.toFixed(2)} | ${row.apiOtherMedianMilliseconds?.toFixed(2)} |`);
  }
  lines.push('', 'SEEは標準並べ替えでは呼ばれません。局面反復は独立した対局標本ではありません。OS、JIT、GC、同期処理の中断不能区間のため各中央値は当該PCでの観測です。', '');
  writeSync(reportFd, lines.join('\n'));
  console.log(`${output}: ${samples.length} samples; fixed-depth action/evaluation/PV identical`);
} finally {
  closeSync(rawFd);
  if (reportFd !== undefined) closeSync(reportFd);
}
