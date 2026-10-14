import fs from 'node:fs';
import assert from 'node:assert/strict';
const directory=process.argv[2]??'docs/benchmarks/no-legal-review';
const conditions=['main','before','after'];
const data=Object.fromEntries(conditions.map(c=>[c,[1,2].map(i=>JSON.parse(fs.readFileSync(`${directory}/${c}-${i}.json`,'utf8')))]));
const fixture=data.main[0].metadata.fixtureSha256;
for(const runs of Object.values(data)) for(const run of runs) assert.equal(run.metadata.fixtureSha256,fixture);
const median=values=>{const a=values.slice().sort((x,y)=>x-y);return a.length?a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2:null;};
const rows=(c,id,kind)=>data[c].flatMap(d=>d.rows.filter(r=>r.case===id&&r.kind===kind));
const ids=[...new Set(data.before[0].rows.map(r=>r.case))];
const lines=['# PR182 合法応手・探索比較の実測集計','',
  '2巡×各条件2 warmup+5本（合計10本）。条件順は before→main→after / after→main→before。下表は10本の中央値、単位ms。microは各標本100呼出しの平均値の中央値。',
  '',`Fixture SHA256: \`${fixture}\``,
  '', '| 局面 | 指標 | main | 変更前PR | 修正後 |','|---|---|---:|---:|---:|'];
for(const id of ids) for(const kind of ['move','drop','response','fixed']) {
  const values=conditions.map(c=>median(rows(c,id,kind).map(r=>r.perCallMilliseconds??r.wallMilliseconds)));
  lines.push(`| ${id} | ${kind} | ${values.map(v=>v===null?'N/A':v.toFixed(6)).join(' | ')} |`);
}
lines.push('','| 局面 | 予算 | 条件 | 実時間中央値ms | 完了深さ分布 | 訪問局面数中央値（最深/全反復） | fallback | 最大超過ms |','|---|---|---|---:|---|---|---:|---:|');
for(const id of ids) for(const kind of ['100ms','1000ms']) for(const c of conditions) {
  const own=rows(c,id,kind);const depth={};own.forEach(r=>depth[r.depth]=(depth[r.depth]??0)+1);
  lines.push(`| ${id} | ${kind} | ${c} | ${median(own.map(r=>r.wallMilliseconds)).toFixed(3)} | ${JSON.stringify(depth)} | ${median(own.map(r=>r.visited))}/${median(own.map(r=>r.totalVisited))} | ${own.filter(r=>r.source==='fallback').length}/${own.length} | ${Math.max(...own.map(r=>r.excessMilliseconds)).toFixed(3)} |`);
}
let timedPairs=0;
for(const id of ids) {
  const fixed=rows('before',id,'fixed').map(r=>r.signature);
  assert.equal(new Set(fixed).size,1);
  for(const r of rows('after',id,'fixed')) assert.equal(r.signature,fixed[0],`${id}: fixed result`);
  for(const kind of ['100ms','1000ms']) for(const a of rows('after',id,kind)) {
    const b=rows('before',id,kind).find(r=>r.depth===a.depth);
    if(b){assert.equal(a.signature,b.signature,`${id} ${kind} depth ${a.depth}`);timedPairs++;}
  }
}
const beforeAudit=JSON.parse(fs.readFileSync(`${directory}/review-before-audit.json`));
const afterAudit=JSON.parse(fs.readFileSync(`${directory}/repo-audit.json`));
assert.deepEqual(beforeAudit.rows,afterAudit.rows);
lines.push('',`固定深さ2の評価・選択手・PV・訪問数は全50本で変更前と一致。同じ完了深さで比較可能な時間制限結果${timedPairs}本も一致。全${beforeAudit.rows.reduce((n,r)=>n+r.actions,0)} root合法手の順序と、各着手後stateの全フィールドのハッシュも一致。`,
  '', 'responseは選択した最初の盤上移動後（盤上移動がなければ駒打ち後）のhasLegalResponseを独立に測定した時間であり、探索中の応手確認の累積時間・CPU占有率ではない。メインとの速度差と仕様上の勝敗差は混同しない。個別標本は対応JSONを参照。');
lines.push('', '## 中盤の追加比較', '', '最初の2巡で中盤の時間が大きく揺れたため、同じfixture・設定で10 warmup+10標本を追加。実行順はbefore→after→main。元の標本を削除・置換していない。', '', '| 指標 | main | 変更前PR | 修正後 |', '|---|---:|---:|---:|');
const middle=Object.fromEntries(conditions.map(c=>[c,JSON.parse(fs.readFileSync(`${directory}/middle-${c}.json`))]));
for(const d of Object.values(middle)) assert.equal(d.metadata.fixtureSha256,fixture);
for(const kind of ['move','drop','response','fixed','100ms','1000ms']) {
  lines.push(`| ${kind} | ${conditions.map(c=>median(middle[c].rows.filter(r=>r.kind===kind).map(r=>r.perCallMilliseconds??r.wallMilliseconds)).toFixed(6)).join(' | ')} |`);
}
for(const c of conditions) for(const kind of ['100ms','1000ms']) {
  const own=middle[c].rows.filter(r=>r.kind===kind); const depths={};own.forEach(r=>depths[r.depth]=(depths[r.depth]??0)+1);
  lines.push('', `${c} ${kind}: 深さ${JSON.stringify(depths)}、fallback ${own.filter(r=>r.source==='fallback').length}/${own.length}、最大実時間超過${Math.max(...own.map(r=>r.excessMilliseconds)).toFixed(3)}ms。`);
}
const middleFixed=middle.before.rows.filter(r=>r.kind==='fixed')[0].signature;
for(const r of middle.after.rows.filter(r=>r.kind==='fixed')) assert.equal(r.signature,middleFixed);
lines.push('', '追加比較の固定深さ10本も結果一致。中盤100msは変更前・修正後とも10本すべて深さ2。実測は応手確認の短縮を支持するが、プロセス間・ウォームアップ量の影響が大きく、全体の改善率・悪化率を断定しない。100msの短時間探索に著しい一貫した悪化は検出していない。ただしfew-responsesの修正後2標本は深さ2であり、全標本同等以上とは主張しない。');
fs.writeFileSync(`${directory}/summary.md`,lines.join('\n')+'\n');
console.log(lines.join('\n'));
