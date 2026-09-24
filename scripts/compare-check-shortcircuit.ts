import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const [beforePath, afterPath, legalBeforePath, legalAfterPath,
  fixedBeforePath, fixedAfterPath, reportPath] = process.argv.slice(2);
assert.ok(beforePath && afterPath && legalBeforePath && legalAfterPath &&
  fixedBeforePath && fixedAfterPath,
  'Usage: tsx scripts/compare-check-shortcircuit.ts BEFORE.jsonl AFTER.jsonl LEGAL_BEFORE.jsonl LEGAL_AFTER.jsonl FIXED_BEFORE.jsonl FIXED_AFTER.jsonl [REPORT.md]');
const readRows = (path: string): any[] => readFileSync(path, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const before = readRows(beforePath);
const after = readRows(afterPath);
const legalBefore = readRows(legalBeforePath);
const legalAfter = readRows(legalAfterPath);
const fixedBefore = readRows(fixedBeforePath);
const fixedAfter = readRows(fixedAfterPath);
const configBefore = before[0];
const configAfter = after[0];
assert.equal(configBefore.schema, 'check-internals-v1');
assert.equal(configAfter.schema, 'check-internals-v2');
assert.equal(configBefore.head, legalBefore[0].head);
assert.equal(configAfter.head, legalAfter[0].head);
assert.equal(configBefore.sourceSha256, configAfter.sourceSha256);
assert.equal(configBefore.sourceSha256, legalBefore[0].sourceSha256);
assert.equal(configAfter.sourceSha256, legalAfter[0].sourceSha256);
for (const field of ['settings', 'warmups', 'runs', 'smoke', 'node', 'os', 'cpu'])
  assert.deepEqual(configBefore[field], configAfter[field], `changed measurement condition: ${field}`);
assert.equal(configBefore.runs, 5);
assert.equal(configBefore.warmups, 2);
assert.equal(fixedBefore[0].schema, 'check-shortcircuit-fixed-v1');
assert.equal(fixedAfter[0].schema, 'check-shortcircuit-fixed-v1');
assert.equal(fixedBefore[0].head, configBefore.head);
assert.equal(fixedAfter[0].head, configAfter.head);
assert.equal(fixedBefore[0].sourceSha256, configBefore.sourceSha256);
assert.equal(fixedAfter[0].sourceSha256, configAfter.sourceSha256);
for (const field of ['settings', 'warmups', 'runs', 'node', 'os', 'cpu'])
  assert.deepEqual(fixedBefore[0][field], fixedAfter[0][field], `changed isolated fixed condition: ${field}`);
assert.equal(fixedBefore[0].warmups, 2);
assert.equal(fixedBefore[0].runs, 5);
assert.equal(before.at(-1)?.type, 'end');
assert.equal(after.at(-1)?.type, 'end');
assert.equal(fixedBefore.at(-1)?.type, 'end');
assert.equal(fixedAfter.at(-1)?.type, 'end');
assert.deepEqual(legalBefore.slice(1), legalAfter.slice(1), 'legal action contents/order or position changed');

const positions = before.filter(row => row.type === 'position');
assert.equal(positions.length, 4);
assert.deepEqual(positions.map(row => row.id), ['g1-p115', 'g3-p55', 'g4-p89', 'g1-p93']);
const median = (values: number[]) => {
  assert.ok(values.length > 0 && values.every(Number.isFinite));
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const fmt = (value: number) => value.toFixed(2);
const measurement = (rows: any[], type: string, positionId: string) =>
  rows.filter(row => row.type === type && row.positionId === positionId && row.phase === 'measurement');
const same = (a: unknown, b: unknown, label: string) =>
  assert.deepEqual(a, b, label);
const aggregate = (row: any) => {
  const board = row.board;
  const drop = row.drop;
  return {
    checks: board.checks + drop.checks,
    searches: board.attackScans + drop.attackScans,
    squares: board.scannedSquares + drop.scannedSquares,
    pieces: board.pieceCalls + drop.pieceCalls,
    exits: (board.earlyExits ?? 0) + (drop.earlyExits ?? 0),
  };
};
const action = (value: unknown) => JSON.stringify(value);
const depthCounts = (rows: any[]) => [...new Set(rows.map(row => row.completedDepth))]
  .sort((a, b) => a - b).map(depth => `${depth}×${rows.filter(row => row.completedDepth === depth).length}`).join(', ');
const lines = [
  '# 王手判定のboolean早期終了 Before / After', '',
  `Before: \`${configBefore.head}\`。After: \`${configAfter.head}\`。`,
  `棋譜 SHA-256: \`${configBefore.sourceSha256}\`。${configAfter.os}、${configAfter.cpu}、Node ${configAfter.node}。`,
  '4局面とも標準評価・標準手順序・静止探索追加1手・最大深さ4・100ms。各側とも1プロセス内で同期直列、ウォームアップ2回・本測定5回。BeforeとAfterは別プロセス・別時刻に実行。',
  '100ms通常探索は診断OFF。攻撃元探索の件数は固定深さ1の診断ON。固定深さ1完走時間は診断を混ぜない独立プロセスで両側同じスクリプトを走らせた。',
  '', '## 王手確認と攻撃元探索（固定深さ1・診断ON）', '',
  '| 局面 | checks / searches 前→後 | 実走査マス 前→後 | 平均マス/回 前→後 | piece判定 前→後 | 早期終了 後 |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
];
const fixedRows: string[] = [];
const timedRows: string[] = [];
const actionRows: string[] = [];
for (const position of positions) {
  const id = position.id;
  const afterPosition = after.find(row => row.type === 'position' && row.id === id);
  assert.deepEqual(position, afterPosition, `${id}: position metadata`);
  const legal = legalBefore.find(row => row.type === 'position' && row.id === id);
  const fixedBeforePosition = fixedBefore.find(row => row.type === 'position' && row.id === id);
  const fixedAfterPosition = fixedAfter.find(row => row.type === 'position' && row.id === id);
  assert.deepEqual(fixedBeforePosition, fixedAfterPosition, `${id}: isolated position metadata`);
  for (const field of ['stateSha256', 'positionKeySha256', 'historyLength'])
    assert.equal(position[field], legal[field], `${id}: ${field}`);
  for (const field of ['stateSha256', 'positionKeySha256', 'historyLength', 'sourceResult'])
    assert.equal(position[field], fixedBeforePosition[field], `${id}: isolated ${field}`);
  assert.equal(position.rootCandidates, legal.legalCount);
  const bFixed = measurement(before, 'fixed', id);
  const aFixed = measurement(after, 'fixed', id);
  const bPlain = measurement(fixedBefore, 'sample', id);
  const aPlain = measurement(fixedAfter, 'sample', id);
  const bTimed = measurement(before, 'off', id);
  const aTimed = measurement(after, 'off', id);
  for (const group of [bFixed, aFixed, bPlain, aPlain, bTimed, aTimed]) assert.equal(group.length, 5);
  for (const row of [...bPlain, ...aPlain]) {
    same(row.action, bFixed[0].action, `${id}: isolated fixed action changed`);
    assert.equal(row.evaluation, bFixed[0].evaluation, `${id}: isolated fixed evaluation changed`);
  }
  const b = aggregate(bFixed[0]);
  const a = aggregate(aFixed[0]);
  for (const row of bFixed) same(aggregate(row), b, `${id}: before counters vary`);
  for (const row of aFixed) same(aggregate(row), a, `${id}: after counters vary`);
  assert.equal(b.checks, a.checks, `${id}: check count changed`);
  assert.equal(b.searches, a.searches, `${id}: search count changed`);
  assert.equal(b.squares, b.searches * 81, `${id}: before scan count`);
  assert.ok(a.squares < b.squares, `${id}: scan count did not decrease`);
  assert.ok(a.pieces <= b.pieces, `${id}: piece calls increased`);
  assert.ok(a.exits > 0 && a.exits <= a.searches);
  lines.push(`| ${id} | ${b.checks}/${b.searches} → ${a.checks}/${a.searches} | ${b.squares.toLocaleString()} → ${a.squares.toLocaleString()} (${fmt((1 - a.squares / b.squares) * 100)}%減) | ${fmt(b.squares / b.searches)} → ${fmt(a.squares / a.searches)} | ${b.pieces.toLocaleString()} → ${a.pieces.toLocaleString()} | ${a.exits.toLocaleString()}/${a.searches.toLocaleString()} (${fmt(a.exits / a.searches * 100)}%) |`);
  const bMs = median(bPlain.map(row => row.elapsedMilliseconds));
  const aMs = median(aPlain.map(row => row.elapsedMilliseconds));
  fixedRows.push(`| ${id} | ${fmt(bMs)} | ${fmt(aMs)} | ${fmt((1 - aMs / bMs) * 100)}% | ${action(bFixed[0].action)} | ${bFixed[0].evaluation} |`);
  for (const row of [...bFixed, ...aFixed]) {
    same(row.action, bFixed[0].action, `${id}: fixed-depth action changed`);
    assert.equal(row.evaluation, bFixed[0].evaluation, `${id}: fixed-depth evaluation changed`);
  }
  for (const row of [...bTimed, ...aTimed]) {
    assert.equal(row.rootCandidates, legal.legalCount);
    assert.equal(row.resultSource === 'fallback', row.completedDepth === 0);
    if (row.completedDepth === 0) {
      same(row.action, bTimed[0].action, `${id}: fallback action changed`);
      assert.equal(row.evaluation ?? null, null, `${id}: fallback evaluation`);
    }
  }
  for (const row of aTimed) for (const old of bTimed) if (row.completedDepth === old.completedDepth) {
    same(row.action, old.action, `${id}: same-depth timed action changed`);
    assert.equal(row.evaluation ?? null, old.evaluation ?? null, `${id}: same-depth timed evaluation changed`);
  }
  timedRows.push(`| ${id} | ${fmt(median(bTimed.map(row => row.apiElapsedMilliseconds)))} → ${fmt(median(aTimed.map(row => row.apiElapsedMilliseconds)))} | ${depthCounts(bTimed)} → ${depthCounts(aTimed)} | ${bTimed.filter(row => row.resultSource === 'fallback').length}/5 → ${aTimed.filter(row => row.resultSource === 'fallback').length}/5 | ${legal.legalCount} |`);
  actionRows.push(`| ${id} | ${action(bTimed[0].action)} / ${bTimed[0].evaluation ?? 'null'} | ${[...new Set(aTimed.map(row => `${action(row.action)} / ${row.evaluation ?? 'null'} (深さ${row.completedDepth})`))].join('<br>')} |`);
}
lines.push('', '## 固定深さ1（診断OFF）', '',
  '| 局面 | Before中央値ms | After中央値ms | 時間短縮率 | 選択手（両側同一） | 評価（両側同一） |',
  '| --- | ---: | ---: | ---: | --- | ---: |', ...fixedRows,
  '', '## 100ms通常探索（診断OFF）', '',
  '| 局面 | API中央値ms 前→後 | 完了深さ分布 前→後 | fallback 前→後 | root候補 |',
  '| --- | ---: | --- | ---: | ---: |', ...timedRows,
  '', '| 局面 | Before 選択手 / 評価 | After 選択手 / 評価 |',
  '| --- | --- | --- |', ...actionRows,
  '', '合法手配列の内容・順序、局面状態・履歴長・局面 SHA-256 は4局面すべて一致。固定深さ1の選択手・評価も全本で一致。100msで同じ完了深さの結果は一致し、深さが変わった場合の選択手・評価差は完了深さの差として扱う。入力状態は測定スクリプトで非破壊を確認。',
  '100msのAPI時間は制限時間付近で打ち切られるため、速度改善率の指標として用いない。診断ONと通常探索を交互に測った旧固定深さ1系列ではJIT起因とみられる大きな段差があり、時間比較から除外した。独立系列でも試行間の変動が大きく、数％の差は有効な速度改善と断定できない。1台の測定で棋力や一般的な速度差は主張しない。',
  '結論: 実走査とpiece判定は減ったが、100msで深さ1に届いた局面は0/4。固定深さ1の実時間短縮も確認できなかった。次PRでは攻撃判定以外の高頻度経路を測定して候補を絞る。',
  '', `診断・100ms生データ: \`${beforePath}\`、\`${afterPath}\`。合法手監査: \`${legalBeforePath}\`、\`${legalAfterPath}\`。固定深さ1独立測定: \`${fixedBeforePath}\`、\`${fixedAfterPath}\`。`, '');
if (reportPath) writeFileSync(reportPath, lines.join('\n'), { flag: 'wx' });
console.log(`${reportPath ?? 'audit'}: ${positions.length} positions compared and audited`);
