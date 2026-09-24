import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { resolveSearchEvaluationPreset } from '../src/domain/shogi/searchEvaluationPresets';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { TARGETS } from './benchmarks/postRootDepthOne';
import { CHILD_PHASES, summarizeQLegal, type FixedProbe, type QLegalSample } from './benchmarks/qLegalBreakdown';

const args = process.argv.slice(2);
assert.ok(args[0] === '--out' && args[1]?.endsWith('.jsonl') &&
  (args.length === 2 || (args.length === 3 && args[2] === '--smoke')),
  'Usage: npm run measure:q-legal-breakdown -- --out PATH.jsonl [--smoke]');
const out = resolve(args[1]);
const smoke = args.includes('--smoke');
const warmups = smoke ? 1 : 2;
const runs = smoke ? 1 : 5;
const { positions, sourceSha256 } = replayPositions(SOURCE, smoke ? TARGETS.slice(0, 1) : TARGETS);
const evaluation = resolveSearchEvaluationPreset('standard');
const settings = { maxDepth: 4, timeLimitMilliseconds: 100, evaluation: 'standard',
  moveOrdering: 'standard' as const, quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
mkdirSync(dirname(out), { recursive: true });
const fd = openSync(out, 'wx');
let reportFd: number | undefined;
const emit = (row: object) => writeSync(fd, JSON.stringify(row) + '\n');
try {
  reportFd = openSync(out.slice(0, -6) + '.md', 'wx');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trim();
  emit({ type: 'config', schema: 'q-legal-breakdown-v2', head, dirty: status !== '', status,
    startedAt: new Date().toISOString(), source: SOURCE, sourceSha256,
    node: process.version, os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model ?? 'unknown',
    settings, warmups, runs, smoke, execution: 'protected input; one process; synchronous serial; alternating timed OFF/ON order; one full fixed-depth-one diagnostic after timed samples per position; ON root-breakdown disabled',
    timing: 'All detail uses the injected search clock. q-legal contains q-board-moves and q-hand-drops; those contain their own child stages. phase milliseconds are exclusive, inclusiveMilliseconds and maxMilliseconds include children. Sum exclusive phases only.' });
  const samples: QLegalSample[] = [];
  for (const position of positions) {
    emit({ type: 'position', id: position.id, band: position.band,
      stateSha256: position.stateSha256, positionKeySha256: position.positionKeySha256,
      historyLength: position.historyLength, sourceResult: position.sourceResult });
  }
  // Rotate through positions on each run so process-age effects do not fall on only the last position.
  for (let index = 0; index < warmups + runs; index++) {
    for (const position of positions) {
      for (const probe of index % 2 ? [true, false] : [false, true]) {
        const input = protectSearchInput(position.state);
        const diagnostics = probe ? new SearchDiagnostics(false, false) : undefined;
        const start = performance.now();
        const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot,
          settings.maxDepth, settings.timeLimitMilliseconds, evaluation, performance.now.bind(performance),
          { moveOrdering: settings.moveOrdering, quiescence: settings.quiescence }, diagnostics);
        const callElapsedMilliseconds = performance.now() - start;
        assert.equal(input.wasMutated(), false, `${position.id}: input mutated`);
        const row: QLegalSample = { type: 'sample', positionId: position.id,
          phase: index < warmups ? 'warmup' : 'measurement', run: index < warmups ? index + 1 : index - warmups + 1,
          probe, apiElapsedMilliseconds: result.elapsedMilliseconds, callElapsedMilliseconds,
          resultSource: result.resultSource, completedDepth: result.completedDepth,
          timedOut: result.timedOut, action: result.selectedAction,
          diagnostics: diagnostics ? { startedAt: diagnostics.startedAt, phases: diagnostics.phases,
            qLegalCounts: diagnostics.qLegalCounts, finished: diagnostics.finished!,
            depthOne: diagnostics.depthOne, deadline: diagnostics.deadlineObservation,
            interruptedPhase: diagnostics.interruptedPhase } : null };
        samples.push(row);
        emit(row);
      }
    }
  }
  const fixed: FixedProbe[] = [];
  for (const position of positions) {
    for (let index = 0; index < warmups + runs; index++) {
      const input = protectSearchInput(position.state);
      const diagnostics = new SearchDiagnostics(false, false);
      const result = analyzeAlphaBetaSearch(input.snapshot, 1, evaluation, performance.now.bind(performance),
        { moveOrdering: settings.moveOrdering, quiescence: settings.quiescence }, diagnostics);
      assert.equal(input.wasMutated(), false, `${position.id}: fixed input mutated`);
      const row: FixedProbe = { type: 'fixed-probe', positionId: position.id,
        phase: index < warmups ? 'warmup' : 'measurement',
        run: index < warmups ? index + 1 : index - warmups + 1,
        apiElapsedMilliseconds: result.elapsedMilliseconds,
        action: result.selectedAction, evaluation: result.selectedEvaluation,
        diagnostics: { phases: diagnostics.phases, qLegalCounts: diagnostics.qLegalCounts,
          finished: diagnostics.finished! } };
      fixed.push(row);
      emit(row);
    }
  }
  const summary = summarizeQLegal(samples, fixed);
  if (!smoke) emit({ type: 'summary', rows: summary });
  emit({ type: 'end', endedAt: new Date().toISOString() });
  const lines = ['# 静止探索の合法手生成内訳', '',
    `HEAD ${head}、dirty=${status !== ''}、Node ${process.version}、${platform()} ${release()} ${arch()}、${cpus()[0]?.model ?? 'unknown'}。`,
    `保存棋譜SHA256 ${sourceSha256}。${positions.length}局面、100ms、最大深さ4、標準評価・並べ替え、静止追加1手。ウォームアップ${warmups}、本測定${runs}、OFF/ON交互。`,
    'OFFのAPI内時間・fallback・深さ・手は100ms通常経路の結果。100ms ONも交互に測った。期限内に静止探索へ入らない標本があるため、内訳表は同じ保存局面の固定深さ1を診断ONで完走させた補助測定（各2ウォームアップ+5本）を使う。固定深さ1は100msの完走を意味しない。ONとOFFの時間を混ぜて改善率を算出しない。',
    'q-legal は盤上手 q-board-moves と持駒 q-hand-drops を包含する。盤上手は疑似手、盤面シミュレーション、自玉王手判定を含む。持駒は各種類81マスの合法性検査、盤面準備、自玉王手判定、歩打ち詰め判定を含む。表の排他時間だけを加算し、包含時間を重ねて足さない。最大単発は包含時間である。残余には走査、並べ替え、成りの展開、各種フィルタと計測負荷を含む。',
    '', '| 局面 | 100ms OFF API中央値ms | fallback | 完了深さ | 選択手 | root候補 | 100ms ON q-legal回数 | 固定深さ1 ON API中央値ms | 固定深さ1 ON q-legal回数 | q-legal排他/包含中央値ms | 最大単発ms |',
    '| --- | ---: | ---: | --- | --- | --- | --- | ---: | --- | ---: | ---: |'];
  for (const row of summary) {
    if (row.offSamples === 0) continue;
    const fmt = (value: number | null) => value?.toFixed(2) ?? '—';
    lines.push(`| ${row.positionId} | ${fmt(row.offApiMedianMilliseconds)} | ${row.offFallback}/${row.offSamples} | ${row.offDepths.join(',')} | ${JSON.stringify(row.offActions[0])} | ${row.rootCandidates.join(',')} | ${row.timedQCalls.join(',')} | ${fmt(row.fixedApiMedianMilliseconds)} | ${row.qLegal.calls.join(',')} | ${fmt(row.qLegal.exclusiveMedianMilliseconds)}/${fmt(row.qLegal.inclusiveMedianMilliseconds)} | ${fmt(row.qLegal.maximumSingleMilliseconds)} |`);
  }
  for (const row of summary) {
    if (row.offSamples === 0) continue;
    lines.push('', `## ${row.positionId} の固定深さ1診断ON内訳`, '',
      '| 工程 | 回数（各5回） | 排他中央値ms | 包含中央値ms | 最大単発ms |',
      '| --- | --- | ---: | ---: | ---: |');
    for (const name of CHILD_PHASES) {
      const part = row.phases[name];
      lines.push(`| ${name} | ${part.calls.join(',')} | ${part.exclusiveMedianMilliseconds?.toFixed(2)} | ${part.inclusiveMedianMilliseconds?.toFixed(2)} | ${part.maximumSingleMilliseconds.toFixed(2)} |`);
    }
    lines.push('', `件数: ${JSON.stringify(row.counts)}。`);
  }
  const leafPhases = ['q-board-pseudo', 'q-board-simulate', 'q-board-own-check',
    'q-drop-board-setup', 'q-drop-own-check', 'q-drop-pawn-mate'] as const;
  const ranked = leafPhases.map(name => ({ name, total: summary.reduce((sum, row) =>
    sum + (row.phases[name]?.exclusiveMedianMilliseconds ?? 0), 0) }))
    .sort((a, b) => b.total - a.total);
  lines.push('', `次の一箇所の候補は ${ranked[0].name}。固定深さ1診断ONの4局面別排他中央値の合計は ${ranked[0].total.toFixed(2)}msで、次点 ${ranked[1].name} の ${ranked[1].total.toFixed(2)}msを上回る。各局面の完走対象は同じだが、中央値の合計は一般的な性能改善率ではない。`,
    '診断負荷、JIT、OS、GC、100msでの停止時点は未分離。今回だけで深さ1の100ms完走や棋力改善は保証できない。', '');
  lines.push('## 再実行', '',
    '`npm run measure:q-legal-breakdown -- --out docs/benchmarks/別名.jsonl`（既存出力は上書きしない）',
    '`npm run audit:q-legal-breakdown -- docs/benchmarks/別名.jsonl`',
    '`npm run check`、`git diff --check`。測定はほかのテスト・buildと並列に実行しない。', '');
  writeSync(reportFd, lines.join('\n'));
  console.log(`${out}: ${samples.length} serial samples`);
} finally {
  closeSync(fd);
  if (reportFd !== undefined) closeSync(reportFd);
}
