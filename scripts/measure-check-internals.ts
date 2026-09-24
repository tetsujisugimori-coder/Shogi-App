import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { resolveSearchEvaluationPreset } from '../src/domain/shogi/searchEvaluationPresets';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { TARGETS, median } from './benchmarks/postRootDepthOne';
import type { CheckStage } from '../src/domain/shogi/checkInternalsDiagnostics';

const args = process.argv.slice(2);
assert.ok(args[0] === '--out' && args[1]?.endsWith('.jsonl') &&
  (args.length === 2 || (args.length === 3 && args[2] === '--smoke')),
  'Usage: npm run measure:check-internals -- --out PATH.jsonl [--smoke]');
const out = resolve(args[1]);
const smoke = args.includes('--smoke');
const warmups = smoke ? 1 : 2;
const runs = smoke ? 1 : 5;
const { positions, sourceSha256 } = replayPositions(SOURCE, smoke ? TARGETS.slice(0, 1) : TARGETS);
const evaluation = resolveSearchEvaluationPreset('standard');
const options = { moveOrdering: 'standard' as const,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
const stages: readonly CheckStage[] = ['check', 'king', 'attackSearch', 'piece', 'pattern', 'step', 'ray'];
const parentPhases = ['q-board-simulate', 'q-board-own-check', 'q-drop-board-setup',
  'q-drop-own-check', 'q-drop-pawn-mate'] as const;
mkdirSync(dirname(out), { recursive: true });
const fd = openSync(out, 'wx');
const emit = (value: object) => writeSync(fd, JSON.stringify(value) + '\n');
try {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  emit({ type: 'config', schema: 'check-internals-v2', head, startedAt: new Date().toISOString(),
    source: SOURCE, sourceSha256, node: process.version,
    os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model ?? 'unknown',
    settings: { maxDepth: 4, timeLimitMilliseconds: 100, evaluation: 'standard',
      moveOrdering: 'standard', quiescence: options.quiescence }, warmups, runs, smoke,
    execution: 'one process, synchronous serial; OFF timed first, then fixed depth-one ON; each position rotates per run',
    timing: 'Internal inclusive is wall time within each stage. Exclusive is parent inclusive minus measured direct children; do not sum nested inclusive stages. Maximum single is inclusive. Fine-grained timing overhead is included in parent residual.' });
  for (const position of positions) emit({ type: 'position', id: position.id, band: position.band,
    stateSha256: position.stateSha256, positionKeySha256: position.positionKeySha256,
    historyLength: position.historyLength, sourceResult: position.sourceResult,
    rootCandidates: getLegalActions(position.state).length });

  const off: Array<{ positionId: string; phase: string; apiElapsedMilliseconds: number;
    resultSource: string; completedDepth: number; action: unknown;
    evaluation: number | null; rootCandidates: number }> = [];
  for (let index = 0; index < warmups + runs; index++) for (const position of positions) {
    const input = protectSearchInput(position.state);
    const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot,
      4, 100, evaluation, performance.now.bind(performance), options);
    assert.equal(input.wasMutated(), false);
    const row = { type: 'off', positionId: position.id,
      phase: index < warmups ? 'warmup' : 'measurement',
      run: index < warmups ? index + 1 : index - warmups + 1,
      apiElapsedMilliseconds: result.elapsedMilliseconds, resultSource: result.resultSource,
      completedDepth: result.completedDepth, action: result.selectedAction,
      evaluation: result.selectedEvaluation,
      rootCandidates: getLegalActions(position.state).length };
    off.push(row); emit(row);
  }

  const fixed: Array<{ positionId: string; phase: string; apiElapsedMilliseconds: number;
    action: unknown; evaluation: number | null;
    diagnostics: Pick<SearchDiagnostics, 'phases' | 'qLegalCounts' | 'finished'>;
    board: ReturnType<NonNullable<SearchDiagnostics['checkInternals']>['board']['snapshot']>;
    drop: ReturnType<NonNullable<SearchDiagnostics['checkInternals']>['drop']['snapshot']> }> = [];
  const fixedPlain: Array<{ positionId: string; phase: string; apiElapsedMilliseconds: number }> = [];
  for (let index = 0; index < warmups + runs; index++) for (const position of positions) {
    const phase = index < warmups ? 'warmup' : 'measurement';
    const run = index < warmups ? index + 1 : index - warmups + 1;
    const profile = () => {
      const input = protectSearchInput(position.state);
      const diagnostics = new SearchDiagnostics(false, false, true);
      const result = analyzeAlphaBetaSearch(input.snapshot, 1, evaluation,
        performance.now.bind(performance), options, diagnostics);
      assert.equal(input.wasMutated(), false);
      const row = { type: 'fixed', positionId: position.id, phase, run,
        apiElapsedMilliseconds: result.elapsedMilliseconds,
        action: result.selectedAction, evaluation: result.selectedEvaluation,
        diagnostics: { phases: diagnostics.phases, qLegalCounts: diagnostics.qLegalCounts,
          finished: diagnostics.finished },
        board: diagnostics.checkInternals!.board.snapshot(),
        drop: diagnostics.checkInternals!.drop.snapshot() };
      fixed.push(row); emit(row);
      return result;
    };
    const plain = () => {
      const input = protectSearchInput(position.state);
      const start = performance.now();
      const result = analyzeAlphaBetaSearch(input.snapshot, 1, evaluation, undefined, options);
      const elapsed = performance.now() - start;
      assert.equal(input.wasMutated(), false);
      fixedPlain.push({ positionId: position.id, phase, apiElapsedMilliseconds: elapsed });
      return { result, elapsed };
    };
    const [profiled, unprofiled] = index % 2 ? [profile(), plain()] : (() => {
      const unprofiled = plain(); return [profile(), unprofiled] as const;
    })();
    assert.deepEqual(profiled.selectedAction, unprofiled.result.selectedAction);
    assert.equal(profiled.selectedEvaluation, unprofiled.result.selectedEvaluation);
    emit({ type: 'fixed-plain-check', positionId: position.id, phase, run,
      apiElapsedMilliseconds: unprofiled.elapsed, sameAction: true, sameEvaluation: true });
  }
  emit({ type: 'end', endedAt: new Date().toISOString() });

  const lines = ['# 王手判定内部の分解計測', '',
    `基準HEAD: ${head}。保存棋譜SHA256: ${sourceSha256}。`,
    `環境: ${platform()} ${release()} ${arch()}、${cpus()[0]?.model ?? 'unknown'}、Node ${process.version}。`,
    `条件: ${positions.map(p => p.id).join('、')}、標準評価・標準手順序・静止探索追加1手・最大深さ4・100ms。同期直列、ウォームアップ${warmups}回、本測定${runs}回。`,
    '診断OFFは通常の100ms探索。診断ONは固定深さ1を完走する補助測定であり、100ms以内の完走を意味しない。両者のAPI時間から改善率を算出しない。固定深さ1のONとOFFも交互に対測定し、診断負荷の参考値にする。',
    '呼出経路: 盤上手は getQuiescenceLegalActionsWithDiagnostics → getLegalMoves → 局所盤面シミュレーション → isKingInCheckProfiled。持駒打ちは同じ列挙から getLegalDropSquares → validateDrop → 打った後の盤面 → isKingInCheckProfiled。どちらも findKingSquare → boolean専用攻撃元探索 → isPieceAttackingInternal → getPieceAttackPattern / step / ray を使う。通常の isKingInCheck → isSquareAttackedBy も最初の攻撃者で終了する。正確な countSquareAttackersBy は維持する。',
    '時間は各項目の中央値。排他時間は直接の子の包含時間を差し引く。最大単発は包含時間。親子の包含時間を合算しない。個々の駒に時計を置くため、子計時や集計処理の負荷は親の残余に含まれる。',
    '', '| 局面 | OFF API中央値ms | fallback | 完了深さ | 選択手 | root候補 | 固定深さ1 OFF/ON API中央値ms |',
    '| --- | ---: | ---: | --- | --- | ---: | ---: |'];
  const f = (n: number | null) => n?.toFixed(2) ?? '—';
  for (const position of positions) {
    const o = off.filter(row => row.positionId === position.id && row.phase === 'measurement');
    const d = fixed.filter(row => row.positionId === position.id && row.phase === 'measurement');
    const plain = fixedPlain.filter(row => row.positionId === position.id && row.phase === 'measurement');
    lines.push(`| ${position.id} | ${f(median(o.map(x => x.apiElapsedMilliseconds)))} | ${o.filter(x => x.resultSource === 'fallback').length}/${o.length} | ${o.map(x => x.completedDepth).join(',')} | ${JSON.stringify(o[0].action)} | ${o[0].rootCandidates} | ${f(median(plain.map(x => x.apiElapsedMilliseconds)))}/${f(median(d.map(x => x.apiElapsedMilliseconds)))} |`);
  }
  lines.push('', 'PR #170後の既存工程との関係: 以下の各局面では q-board-own-check が q-board-simulate より大きく、q-drop-own-check も q-drop-board-setup より大きい。各own-checkの内部は同じ呼出元のcheck包含 → king + attackSearch、attackSearch包含 → piece + 走査残余、piece包含 → pattern + step + ray + 残余として読む。',
    'dropの王手確認回数は4局面ともboardより多い。ただしdrop候補生成全体や100ms探索へこの固定深さ1の時間比を外挿しない。');
  for (const position of positions) {
    const own = fixed.filter(row => row.positionId === position.id && row.phase === 'measurement');
    lines.push('', `## ${position.id}: 固定深さ1診断ON`, '',
      '| 呼出元・項目 | 回数（各本） | 排他中央値ms | 包含中央値ms | 最大単発ms |',
      '| --- | --- | ---: | ---: | ---: |');
    for (const origin of ['board', 'drop'] as const) {
      const parent = origin === 'board' ? 'q-board-own-check' : 'q-drop-own-check';
      const p = own.map(row => row.diagnostics.phases[parent]);
      lines.push(`| ${parent} | ${p.map(x => x.calls).join(',')} | ${f(median(p.map(x => x.milliseconds)))} | ${f(median(p.map(x => x.inclusiveMilliseconds ?? 0)))} | ${f(Math.max(...p.map(x => x.maxMilliseconds ?? 0)))} |`);
      for (const stage of stages) {
        const rows = own.map(row => row[origin].timing[stage]);
        lines.push(`| ${origin}.${stage} | ${rows.map(x => x.calls).join(',')} | ${f(median(rows.map(x => x.exclusiveMilliseconds)))} | ${f(median(rows.map(x => x.inclusiveMilliseconds)))} | ${f(Math.max(...rows.map(x => x.maxMilliseconds)))} |`);
      }
      const counts = own.map(row => row[origin]);
      lines.push(`| ${origin} counts | checks ${counts.map(x => x.checks)} | scans ${counts.map(x => x.attackScans)} | squares ${counts.map(x => x.scannedSquares)} | pieces / calls ${counts.map(x => `${x.opponentPieces}/${x.pieceCalls}`)}; early exits ${counts.map(x => x.earlyExits)} |`);
    }
    lines.push('', '| 既存工程 | 排他中央値ms | 呼出回数（各本） |', '| --- | ---: | --- |');
    for (const phase of parentPhases) lines.push(`| ${phase} | ${f(median(own.map(x => x.diagnostics.phases[phase].milliseconds)))} | ${own.map(x => x.diagnostics.phases[phase].calls).join(',')} |`);
  }
  const attackSearchTotal = positions.reduce((sum, position) => sum +
    (median(fixed.filter(row => row.positionId === position.id && row.phase === 'measurement')
      .map(row => row.board.timing.attackSearch.inclusiveMilliseconds +
        row.drop.timing.attackSearch.inclusiveMilliseconds)) ?? 0), 0);
  lines.push('', `4局面のboard+drop別attackSearch包含中央値の合計は ${f(attackSearchTotal)}ms。細粒度計時負荷を含む。`,
    '攻撃元探索は攻撃者発見時に早期終了する。scansと実走査マス、早期終了件数、piece呼出数から実態を確認する。',
    '固定深さ1のON/OFF時間差は大きく、既存の探索診断と今回の高頻度計時の両方を含む。board/dropのprofiled check包含時間とq-own-check包含時間の差は呼出ラッパー、時計・集計負荷を含む。attackSearch排他にも子呼出計時の負荷が残るため、細粒度の値は概数として扱い、81マス走査の件数と併せて判断する。',
    '', `生データ: ${out.replaceAll('\\', '/')}`, '', '再実行: `npm run measure:check-internals -- --out docs/benchmarks/別名.jsonl`。既存ファイルは上書きしない。',
    '`npm run audit:check-internals -- docs/benchmarks/別名.jsonl`、`npm run check`、`git diff --check`。', '');
  const reportFd = openSync(out.slice(0, -6) + '.md', 'wx');
  try { writeSync(reportFd, lines.join('\n')); } finally { closeSync(reportFd); }
  console.log(`${out}: ${positions.length} positions, ${runs} measured runs`);
} finally { closeSync(fd); }
