import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const prefix = 'docs/benchmarks/drop-copy-';
const rootNames = ['root-before-a', 'root-after-a', 'root-before-b', 'root-after-b'] as const;
const searchNames = ['before-a', 'after-a', 'before-b', 'after-b', 'before-detail', 'after-detail'] as const;
const read = (name: string) => readFileSync(`${prefix}${name}-20260924.jsonl`, 'utf8')
  .trim().split(/\r?\n/).map(line => JSON.parse(line));
const files = Object.fromEntries([...rootNames, ...searchNames].map(name => [name, read(name)]));
const samples = (name: string, positionId: string, probe?: boolean) => files[name].filter(row =>
  row.type === 'sample' && row.phase === 'measurement' && row.positionId === positionId &&
  (probe === undefined || row.probe === probe));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};
const format = (value: number) => value.toFixed(2);
const ids = ['g1-p115', 'g3-p55', 'g4-p89', 'g1-p93'];
const reference = files['root-before-a'][0];
for (const name of [...rootNames, ...searchNames]) {
  const rows = files[name];
  assert.equal(rows.at(-1).type, 'end');
  assert.equal(rows[0].node, reference.node);
  assert.equal(rows[0].os, reference.os);
  assert.equal(rows[0].cpu, reference.cpu);
  const positions = rows.filter(row => row.type === 'position');
  assert.deepEqual(positions.map(row => row.id), ids);
  for (const id of ids) {
    const base = files['root-before-a'].find(row => row.type === 'position' && row.id === id);
    const current = positions.find(row => row.id === id);
    assert.equal(current.stateSha256, base.stateSha256);
    assert.equal(current.actionsSha256 ?? current.legalActionsSha256, base.actionsSha256);
  }
}
for (const name of rootNames) {
  assert.equal(files[name][0].schema, 'drop-copy-root-v1');
  assert.equal(files[name][0].warmups, 2);
  assert.equal(files[name][0].runs, 12);
  for (const id of ids) {
    assert.equal(samples(name, id).length, 12);
    for (const row of samples(name, id)) assert.equal(row.actionsSha256,
      files[name].find(item => item.type === 'position' && item.id === id).actionsSha256);
  }
}
for (const name of searchNames) {
  assert.equal(files[name][0].warmups, 2);
  assert.equal(files[name][0].runs, 5);
  assert.equal(files[name][0].stageTiming, name.includes('detail') ? 'on' : 'off');
  assert.equal(files[name][0].schema, name.startsWith('before') ? 'root-legal-breakdown-v1' : 'root-legal-breakdown-v2');
  for (const id of ids) for (const probe of [false, true]) assert.equal(samples(name, id, probe).length, 5);
}

const lines = [
  '# 持駒打ち判定の盤面準備: PR #159前後比較', '',
  `同一機 ${reference.os}、${reference.cpu}、${reference.node}。変更前HEAD 2117edb（PR #159）、変更後は作業ツリー差分。保存棋譜4局面と保護入力を使用。すべて同期直列。`,
  '実行順は変更前A→変更後A→変更前B→変更後B。各ファイル内で2回ウォームアップし、局面の先行順を交互にした。',
  '', '## 診断OFFのroot合法手生成', '',
  '各セルは12回の本測定の中央値 [最小, 最大] ms。探索APIとは別に `getLegalActions` 全体を測り、各回の生値はリンク先JSONLのsample行に保存。',
  '', '| 局面 | 変更前A | 変更後A | 変更前B | 変更後B |', '| --- | ---: | ---: | ---: | ---: |',
];
for (const id of ids) {
  const cell = (name: string) => {
    const values = samples(name, id).map(row => row.elapsedMilliseconds);
    return `${format(median(values))} [${format(Math.min(...values))}, ${format(Math.max(...values))}]`;
  };
  lines.push(`| ${id} | ${rootNames.map(cell).join(' | ')} |`);
}
lines.push('', '## 100ms探索API（主結果: 診断OFF）', '',
  '最大深さ4、標準評価・着手順、静止追加1手、100ms制限。各系列2回ウォームアップ後5回。API呼出直前から戻り直後を計測。各セルの時間は5回の生値ms。',
  '', '| 局面 | 版・巡 | 呼出時間ms（5回） | 100ms超過 | fallback | 完了深さ | 選択手一致 |',
  '| --- | --- | --- | ---: | ---: | --- | --- |');
for (const id of ids) {
  const referenceAction = JSON.stringify(samples('before-a', id, false)[0].action);
  for (const name of searchNames.slice(0, 4)) {
    const own = samples(name, id, false);
    const times = own.map(row => format(row.callElapsedMilliseconds)).join(', ');
    const excess = own.filter(row => row.callElapsedMilliseconds > 100).length;
    const fallback = own.filter(row => row.resultSource === 'fallback').length;
    const depths = [...new Set(own.map(row => row.completedDepth))].join(', ');
    const sameAction = own.every(row => JSON.stringify(row.action) === referenceAction);
    lines.push(`| ${id} | ${name} | ${times} | ${excess}/5 | ${fallback}/5 | ${depths} | ${sameAction ? '5/5' : '差あり'} |`);
  }
}
lines.push('', '診断ONは補助工程内訳用であり、上表の診断OFFと混ぜて時間差を計算しない。',
  '', '## 診断ONの工程内訳（補助）', '',
  '| 版 | root合計ms | 打ち生成合計ms | 準備工程名 | 工程回数 | 工程合計ms |',
  '| --- | ---: | ---: | --- | ---: | ---: |');
for (const name of ['before-detail', 'after-detail']) {
  const own = ids.flatMap(id => samples(name, id, true));
  const root = own.reduce((sum, row) => sum + row.root.totalMilliseconds, 0);
  const drops = own.reduce((sum, row) => sum + row.root.dropMilliseconds, 0);
  const stage = name.startsWith('before') ? 'board-clone' : 'drop-board-setup';
  const stages = own.flatMap(row => Object.values(row.root.byType).map((entry: any) => entry.stages[stage]));
  lines.push(`| ${name} | ${format(root)} | ${format(drops)} | ${stage} | ${stages.reduce((sum: number, entry: any) => sum + entry.calls, 0)} | ${format(stages.reduce((sum: number, entry: any) => sum + entry.milliseconds, 0))} |`);
}
lines.push('', '`board-clone` は81マスと各駒の深い複製＋配置、`drop-board-setup` は外側配列・打ち先の行／マス／駒の複製＋配置。処理範囲が異なる値であり、工程時間の差を同一工程の短縮量とはしない。',
  '', '## この局面測定で分かったこと', '',
  '診断OFFのroot合法手生成は全4局面・両巡で、変更後の最大値が変更前の最小値より短い。100ms探索APIは変更前後の本測定80件すべてが100msを超え、fallback・完了深さ0・同じ選択手だった。呼出最大は102.56msで、PR #158の415.56ms級の停止は再現していない。期限付きAPI時間やfallbackの改善はこの測定では確認できず、棋力への効果も推定しない。',
  '', '## 生データ', '',
  ...[...rootNames, ...searchNames].map(name => `- [${name}](drop-copy-${name}-20260924.jsonl)`),
  '', '変更前後の判定・理由・順序のハッシュ、件数、代表IDは [基準JSON](drop-validation-baseline-20260924.json) に記録。`scripts/compare-drop-validation.ts --compare` で最適化後と照合する。',
);
const out = 'docs/benchmarks/drop-copy-comparison-20260924.md';
writeFileSync(out, lines.join('\n') + '\n', { flag: 'wx' });
console.log(out);
