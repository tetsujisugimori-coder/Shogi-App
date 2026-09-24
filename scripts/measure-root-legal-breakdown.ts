import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { resolveSearchEvaluationPreset } from '../src/domain/shogi/searchEvaluationPresets';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { ROOT_LEGAL_TARGETS } from './benchmarks/rootLegalTargets';

const args = process.argv.slice(2);
const values: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--out', '--positions', '--warmups', '--runs', '--stage-timing'].includes(args[i]) && args[i + 1] && !values[args[i]]);
  values[args[i]] = args[i + 1];
}
assert.ok(values['--out']?.endsWith('.jsonl'), 'Usage: --out PATH.jsonl [--positions g1-p115,g3-p55] [--warmups 2] [--runs 5] [--stage-timing on|off]');
const integer = (name: string, fallback: number, min: number) => {
  const value = values[name] === undefined ? fallback : Number(values[name]);
  assert.ok(Number.isSafeInteger(value) && value >= min, `${name} must be an integer >= ${min}`);
  return value;
};
const warmups = integer('--warmups', 2, 0);
const runs = integer('--runs', 5, 1);
const stageTiming = values['--stage-timing'] ?? 'on';
assert.ok(stageTiming === 'on' || stageTiming === 'off');
const ids = values['--positions']?.split(',') ?? ROOT_LEGAL_TARGETS.slice(0, 4).map(target => `g${target.game}-p${target.ply}`);
assert.equal(new Set(ids).size, ids.length);
const targets = ids.map(id => {
  const target = ROOT_LEGAL_TARGETS.find(item => `g${item.game}-p${item.ply}` === id);
  assert.ok(target, `unknown position ${id}`);
  return target;
});
const { positions, sourceSha256 } = replayPositions(SOURCE, targets);
const out = resolve(values['--out']);
assert.ok(!existsSync(out) && !existsSync(out.slice(0, -6) + '.md'), 'output already exists');
mkdirSync(dirname(out), { recursive: true });
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trim();
const config = { maxDepth: 4, timeLimitMilliseconds: 100, evaluationPreset: 'standard',
  moveOrdering: 'standard', quiescenceMoveOrdering: 'original', maxTacticalDepth: 1 } as const;
const rows: object[] = [{ type: 'config', schema: 'root-legal-breakdown-v2', startedAt: new Date().toISOString(),
  head, dirty: status !== '', status, node: process.version, os: `${platform()} ${release()} ${arch()}`,
  cpu: cpus()[0]?.model ?? 'unknown', config, warmups, runs, stageTiming, sourceSha256,
  execution: 'synchronous serial, OFF/ON alternating order per run',
  timing: 'call time brackets the search API; root total is inclusive; phase milliseconds are exclusive; per-type drop totals are inclusive of stage timing; residual=root total-piece moves-hand drops; maxima are single invocations' }];
const evaluation = resolveSearchEvaluationPreset('standard');
type RootTiming = { totalMilliseconds: number; pieceCalls: number; pieceMilliseconds: number;
  pieceMaxMilliseconds: number; dropCalls: number; dropMilliseconds: number;
  dropMaxMilliseconds: number; residualMilliseconds: number; byType: SearchDiagnostics['rootDrops'] };
const samples: Array<{ positionId: string; phase: string; probe: boolean; callElapsedMilliseconds: number;
  resultSource: string; root: null | RootTiming }> = [];
for (const position of positions) {
  const input = protectSearchInput(position.state);
  const plain = getLegalActions(input.snapshot);
  const countProbe = new SearchDiagnostics(false);
  const withProbe = getLegalActions(input.snapshot, countProbe);
  assert.deepEqual(withProbe, plain, `${position.id}: legal action content/order`);
  assert.equal(input.wasMutated(), false);
  const legalActionsSha256 = sha(plain);
  rows.push({ type: 'position', id: position.id, stateSha256: position.stateSha256,
    positionKeySha256: position.positionKeySha256, historyLength: position.historyLength,
    legalActionCount: plain.length, legalActionsSha256, sourceActualMilliseconds: position.sourceActualMilliseconds });
  for (let index = 0; index < warmups + runs; index++) {
    for (const enabled of index % 2 ? [true, false] : [false, true]) {
      const protectedInput = protectSearchInput(position.state);
      const diagnostics: SearchDiagnostics | undefined = enabled ? new SearchDiagnostics(stageTiming === 'on') : undefined;
      const start = performance.now();
      const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(protectedInput.snapshot,
        config.maxDepth, config.timeLimitMilliseconds, evaluation, performance.now.bind(performance),
        { moveOrdering: config.moveOrdering, quiescence: { maxTacticalDepth: config.maxTacticalDepth,
          moveOrdering: config.quiescenceMoveOrdering } }, diagnostics);
      const end = performance.now();
      assert.equal(protectedInput.wasMutated(), false, `${position.id}: input changed`);
      const rootTotal: number = diagnostics?.phases['root-legal'].maxMilliseconds ?? 0;
      const piece: SearchDiagnostics['phases']['root-piece-moves'] | undefined = diagnostics?.phases['root-piece-moves'];
      const drop: SearchDiagnostics['phases']['root-hand-drops'] | undefined = diagnostics?.phases['root-hand-drops'];
      const root: RootTiming | null = diagnostics ? { totalMilliseconds: rootTotal,
        pieceCalls: piece!.calls, pieceMilliseconds: piece!.milliseconds, pieceMaxMilliseconds: piece!.maxMilliseconds ?? 0,
        dropCalls: drop!.calls, dropMilliseconds: drop!.milliseconds, dropMaxMilliseconds: drop!.maxMilliseconds ?? 0,
        residualMilliseconds: rootTotal - piece!.milliseconds - drop!.milliseconds,
        byType: diagnostics.rootDrops } : null;
      if (root) {
        assert.ok(root.residualMilliseconds >= -0.5);
        assert.equal(Object.values(root.byType).reduce((sum, entry) => sum + entry.calls, 0), root.dropCalls);
        for (const entry of Object.values(root.byType))
          assert.equal(entry.candidates, entry.legal + Object.values(entry.rejected).reduce((a, b) => a + b, 0));
      }
      const row = { type: 'sample', positionId: position.id,
        phase: index < warmups ? 'warmup' : 'measurement', run: index < warmups ? index + 1 : index - warmups + 1,
        probe: enabled, callElapsedMilliseconds: end - start, apiElapsedMilliseconds: result.elapsedMilliseconds,
        excessMilliseconds: end - start - config.timeLimitMilliseconds,
        completedDepth: result.completedDepth, resultSource: result.resultSource,
        timedOut: result.timedOut, action: result.selectedAction, root,
        diagnostics: diagnostics?.finished ? { phases: diagnostics.phases, ...diagnostics.finished,
          longestCheckInterval: diagnostics.longestCheckInterval, crossedDeadlinePhase: diagnostics.crossedDeadlinePhase } : null };
      rows.push(row);
      samples.push(row);
    }
  }
}
rows.push({ type: 'end', endedAt: new Date().toISOString() });
writeFileSync(out, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' });
const median = (numbers: number[]) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const lines = ['# Root合法手生成の内訳', '',
  `コード ${head}、dirty=${status !== ''}、Node ${process.version}、${platform()} ${release()} ${arch()}、${cpus()[0]?.model ?? 'unknown'}。`,
  `設定 ${JSON.stringify(config)}。ウォームアップ${warmups}回、本測定${runs}回、stageTiming=${stageTiming}。詳細は同名JSONL。`,
  'root全体は包含時間。移動と打ちの合計は排他的区間、残余はroot全体から差し引いた値。駒種別打ち時間と工程時間は包含関係なので重ねて加算しない。最大は単一呼出し、合計は全呼出し。',
  '', '| 局面 | 診断 | 本測定数 | 呼出中央値ms | 最大超過ms | fallback | root中央値ms | 移動中央値ms | 打ち中央値ms | 残余中央値ms |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
for (const position of positions) for (const probe of [false, true]) {
  const own = samples.filter(sample => sample.phase === 'measurement' && sample.positionId === position.id && sample.probe === probe);
  const m = (key: 'totalMilliseconds' | 'pieceMilliseconds' | 'dropMilliseconds' | 'residualMilliseconds') =>
    probe ? median(own.map(sample => sample.root![key])).toFixed(2) : '—';
  lines.push(`| ${position.id} | ${probe ? 'ON' : 'OFF'} | ${own.length} | ${median(own.map(s => s.callElapsedMilliseconds)).toFixed(2)} | ${Math.max(...own.map(s => s.callElapsedMilliseconds - 100)).toFixed(2)} | ${own.filter(s => s.resultSource === 'fallback').length} | ${m('totalMilliseconds')} | ${m('pieceMilliseconds')} | ${m('dropMilliseconds')} | ${m('residualMilliseconds')} |`);
}
lines.push('', '以下の合計は診断ONの本測定反復を通算した値。最大は全反復の単一呼出し最大。工程時間は打ち生成時間に含まれる。',
  '', '| 局面 | 工程 | 呼出 | 合計ms | 単一最大ms | 候補 | 合法 | 却下理由 |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
for (const position of positions) {
  const own = samples.filter(s => s.phase === 'measurement' && s.positionId === position.id && s.probe);
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const root = own.map(s => s.root!);
  const row = (name: string, calls: number, total: number, maximum: number,
    candidates: number | string = '—', legal: number | string = '—', reasons = '—') =>
    lines.push(`| ${position.id} | ${name} | ${calls} | ${total.toFixed(2)} | ${maximum.toFixed(2)} | ${candidates} | ${legal} | ${reasons} |`);
  row('root全体', root.length, sum(root.map(r => r.totalMilliseconds)), Math.max(...root.map(r => r.totalMilliseconds)));
  row('盤上移動', sum(root.map(r => r.pieceCalls)), sum(root.map(r => r.pieceMilliseconds)), Math.max(...root.map(r => r.pieceMaxMilliseconds)));
  row('持駒打ち', sum(root.map(r => r.dropCalls)), sum(root.map(r => r.dropMilliseconds)), Math.max(...root.map(r => r.dropMaxMilliseconds)));
  row('残余', root.length, sum(root.map(r => r.residualMilliseconds)), Math.max(...root.map(r => r.residualMilliseconds)));
  for (const type of Object.keys(root[0].byType) as Array<keyof SearchDiagnostics['rootDrops']>) {
    const entries = root.map(r => r.byType[type]);
    const calls = sum(entries.map(e => e.calls));
    if (!calls) continue;
    const reasons: Record<string, number> = {};
    for (const entry of entries) for (const [reason, count] of Object.entries(entry.rejected))
      reasons[reason] = (reasons[reason] ?? 0) + count;
    row(`${type}打ち`, calls, sum(entries.map(e => e.milliseconds)), Math.max(...entries.map(e => e.maxMilliseconds)),
      sum(entries.map(e => e.candidates)), sum(entries.map(e => e.legal)), JSON.stringify(reasons));
    for (const stage of ['drop-board-setup', 'own-check', 'pawn-drop-mate'] as const) {
      const stages = entries.map(e => e.stages[stage]);
      const count = sum(stages.map(e => e.calls));
      if (count) row(`${type}/${stage}`, count, sum(stages.map(e => e.milliseconds)),
        Math.max(...stages.map(e => e.maxMilliseconds ?? 0)));
    }
  }
}
lines.push('', '各試行の完了深さ、fallback、選択手はJSONLに保存。診断ON-OFF差は測定負荷だけを表さない。');
if (positions.length === 4) {
  const measured = samples.filter(s => s.phase === 'measurement' && s.probe).map(s => s.root!);
  const total = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0);
  const rootTotal = total(measured.map(r => r.totalMilliseconds));
  const dropTotal = total(measured.map(r => r.dropMilliseconds));
  const setupTotal = total(measured.flatMap(r => Object.values(r.byType).map(e => e.stages['drop-board-setup'].milliseconds)));
  lines.push('', `診断ONの本測定20回ではroot全体${rootTotal.toFixed(2)}ms、持駒打ち${dropTotal.toFixed(2)}ms、打ち判定用盤面準備${setupTotal.toFixed(2)}ms。v1の盤面全体の深い複製工程とは処理範囲が異なる。`,
    'PR #158のg1-p93では415.56msの期限確認間隔に複数の持駒打ち生成が含まれ、打ち生成の合計は360.60msだった。今回その長い尾は再現しておらず、当時の工程内部時間やOS・JIT・GC等の寄与は未確定。単一呼出しの最大値だけで415.56msを説明しない。4局の手数上限打切から勝敗・棋力は推定しない。');
}
writeFileSync(out.slice(0, -6) + '.md', lines.join('\n') + '\n', { flag: 'wx' });
console.log(`${out}: ${positions.length} positions, ${samples.length} samples`);
