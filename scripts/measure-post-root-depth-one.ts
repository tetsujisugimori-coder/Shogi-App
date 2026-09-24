import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { resolveSearchEvaluationPreset } from '../src/domain/shogi/searchEvaluationPresets';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { summarize, TARGETS, type PostRootSample } from './benchmarks/postRootDepthOne';

const args = process.argv.slice(2);
assert.ok(args[0] === '--out' && args[1]?.endsWith('.jsonl') &&
  (args.length === 2 || (args.length === 3 && args[2] === '--smoke')),
  'Usage: npm run measure:post-root-depth-one -- --out PATH.jsonl [--smoke]');
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
  emit({ type: 'config', schema: 'post-root-depth-one-v1', head, dirty: status !== '', status,
    startedAt: new Date().toISOString(), source: SOURCE, sourceSha256,
    node: process.version, os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model ?? 'unknown',
    settings, warmups, runs, smoke, execution: 'protected input; one process; synchronous serial; alternating OFF/ON order; ON root-breakdown disabled',
    timing: 'API elapsed is from API start to its final internal clock; call elapsed brackets the API; post-root exclusive phases and residual end at depth-one completion/interruption; quiescence is exclusive of q-* phases; deadline gap is from exact start+100 to first check using the search clock' });
  const samples: PostRootSample[] = [];
  for (const position of positions) {
    emit({ type: 'position', id: position.id, band: position.band,
      stateSha256: position.stateSha256, positionKeySha256: position.positionKeySha256,
      historyLength: position.historyLength, sourceResult: position.sourceResult });
    for (let index = 0; index < warmups + runs; index++) {
      for (const probe of index % 2 ? [true, false] : [false, true]) {
        const input = protectSearchInput(position.state);
        const diagnostics = probe ? new SearchDiagnostics(false, false) : undefined;
        const start = performance.now();
        const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot,
          settings.maxDepth, settings.timeLimitMilliseconds, evaluation, performance.now.bind(performance),
          { moveOrdering: settings.moveOrdering, quiescence: settings.quiescence }, diagnostics);
        const callElapsedMilliseconds = performance.now() - start;
        assert.equal(input.wasMutated(), false, `${position.id}: input mutated`);
        const row: PostRootSample = { type: 'sample', positionId: position.id,
          phase: index < warmups ? 'warmup' : 'measurement', run: index < warmups ? index + 1 : index - warmups + 1,
          probe, apiElapsedMilliseconds: result.elapsedMilliseconds, callElapsedMilliseconds,
          resultSource: result.resultSource, completedDepth: result.completedDepth,
          timedOut: result.timedOut, action: result.selectedAction,
          diagnostics: diagnostics ? { startedAt: diagnostics.startedAt, phases: diagnostics.phases, finished: diagnostics.finished!,
            depthOne: diagnostics.depthOne, deadline: diagnostics.deadlineObservation,
            interruptedPhase: diagnostics.interruptedPhase } : null };
        samples.push(row);
        emit(row);
      }
    }
  }
  const summary = summarize(samples);
  if (!smoke) emit({ type: 'summary', rows: summary });
  emit({ type: 'end', endedAt: new Date().toISOString() });
  const lines = ['# Root生成後の深さ1診断', '',
    `HEAD ${head}、dirty=${status !== ''}、Node ${process.version}、${platform()} ${release()} ${arch()}、${cpus()[0]?.model ?? 'unknown'}。`,
    `保存棋譜SHA256 ${sourceSha256}。${positions.length}局面、100ms、最大深さ4、標準評価・並べ替え、静止追加1手。ウォームアップ${warmups}、本測定${runs}、OFF/ON交互。`,
    'OFFのAPI内時間・fallback・深さ・手を主結果とする。ONはroot内部の詳細記録を無効にして深さ1の工程と期限確認を記録した補助資料。両者の時間を混ぜて改善率を算出しない。両側とも期限まで動くため、総時間の差から診断負荷は推定できない。',
    '工程msは入れ子の子工程を除外した排他的時間。静止探索の欄は q-* を除く残余で、q-legal/q-evaluate は別欄。post-rootはroot合法手生成の終了から深さ1完了または中断まで。post-root-otherは同区間から全排他工程を引いた残余。API内時間は探索内開始から返却直前、呼出全体時間は呼出直前から戻り直後。期限間隔は開始+100msから最初の期限確認までの同一時計の差で、内訳はJSONLのdeadline.activities。',
    '', '| 局面 | OFF API中央値ms | OFF呼出中央値ms | fallback | ON候補総数 | ON完了候補（各回） | ON探索ノード（各回） | ON静止回数（各回） | ON post-root中央値ms | ON着手ms | ON合法手ms | ON評価ms | ON静止残余ms | ON期限確認間隔中央値/最大ms |',
    '| --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  const details: string[] = [];
  for (const row of summary) {
    if (row.offSamples === 0) continue;
    const fmt = (value: number | null) => value?.toFixed(2) ?? '—';
    lines.push(`| ${row.positionId} | ${fmt(row.offApiMedianMilliseconds)} | ${fmt(row.offCallMedianMilliseconds)} | ${row.offFallback}/${row.offSamples} | ${row.rootCandidates} | ${row.completedCandidates.join(',')} | ${row.visitedNodes.join(',')} | ${row.quiescenceCalls.join(',')} | ${fmt(row.postRootMedianMilliseconds)} | ${fmt(row.executeMedianMilliseconds)} | ${fmt(row.legalMedianMilliseconds)} | ${fmt(row.evaluationMedianMilliseconds)} | ${fmt(row.quiescenceMedianMilliseconds)} | ${fmt(row.checkGapMedianMilliseconds)}/${fmt(row.checkGapMaxMilliseconds)} |`);
    details.push(`- ${row.positionId}: OFF完了深さ ${row.offDepths.join(',')}、OFF選択手 ${JSON.stringify(row.offActions)}。ON処理中候補 ${row.currentCandidates.map(value => value ?? 'なし').join(',')}、中断段階 ${row.interruptedStages.join(',')}。ON root中央値/最大 ${fmt(row.onRootMedianMilliseconds)}/${fmt(row.onRootMaxMilliseconds)}ms。期限超過から確認までの工程合計（${row.onSamples}回） ${JSON.stringify(row.deadlineActivitiesMilliseconds)}。q-legal中央値 ${fmt(row.qLegalMedianMilliseconds)}ms、q-evaluate中央値 ${fmt(row.qEvaluateMedianMilliseconds)}ms。`);
  }
  lines.push('', '## 各局面の終了段階と期限後の処理', '', ...details,
    '', ...(smoke ? [] : [`4局面ともONのpost-root工程では静止探索の合法手生成中央値が着手適用・評価より大きい（局面順${summary.map(row => row.qLegalMedianMilliseconds?.toFixed(2)).join(',')}ms）。次の最適化調査は静止探索の合法手生成1箇所を提案する。これは診断ONでの局所費用であり、OFFの完了深さや棋力の改善量は推定しない。`]),
    '各回の候補進捗、工程、期限時刻、確認時刻、区間中の工程と選択手はJSONLに保存した。診断時計の追加読取り、実行順序、OS/JIT/GCで値は変動し得る。GC寄与はこの計測だけでは確定しない。棋力改善は評価していない。', '');
  lines.push('## 再実行', '',
    '`npm run measure:post-root-depth-one -- --out docs/benchmarks/別名.jsonl`（既存出力は上書きしない）',
    '`npm run audit:post-root-depth-one -- docs/benchmarks/別名.jsonl`',
    '`npm run check`、`git diff --check`。測定はほかのテスト・buildと並列に実行しない。', '');
  writeSync(reportFd, lines.join('\n'));
  console.log(`${out}: ${samples.length} serial samples`);
} finally {
  closeSync(fd);
  if (reportFd !== undefined) closeSync(reportFd);
}
