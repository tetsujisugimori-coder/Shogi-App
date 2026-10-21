// Rebuild reports from audited run1 raw data. Existing outputs must agree.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = dirname(fileURLToPath(import.meta.url));
const run = join(root,'run1');
const bytes = existsSync(join(run,'raw.jsonl')) ? readFileSync(join(run,'raw.jsonl')) : gunzipSync(readFileSync(join(run,'raw.jsonl.gz')));
const rawHash = createHash('sha256').update(bytes).digest('hex');
const audited = JSON.parse(readFileSync(join(run,'summary.json'),'utf8'));
assert.equal(rawHash,audited.rawSha256);
const rows = bytes.toString().trim().split('\n').map(s=>JSON.parse(s)).filter(r=>r.phase==='measurement');
const ids = JSON.parse(readFileSync(join(run,'plan.json'),'utf8')).positions.map(p=>p.id).filter(id=>id!=='long-legal-history');
assert.equal(ids.length,12);
const quantile=(xs,q)=>[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*q)-1];
const sum=(rs,fn)=>rs.reduce((total,r)=>total+fn(r),0);
const hist=(xs)=>Object.fromEntries([...new Set(xs)].sort().map(v=>[v,xs.filter(x=>x===v).length]));
const stat=(rs,key)=>key.startsWith('max')?Math.max(...rs.map(r=>r.statistics[key]??0)):sum(rs,r=>r.statistics[key]??0);
const aggregate=rs=>({ n:rs.length,totalMs:sum(rs,r=>r.callMs),p50Ms:quantile(rs.map(r=>r.callMs),.5),p95Ms:quantile(rs.map(r=>r.callMs),.95),
  maxOverrunMs:Math.max(...rs.map(r=>r.overrunMs??0)),maxRss:Math.max(...rs.map(r=>r.rssAfter),...rs.map(r=>r.rssBefore)),
  ordinaryNodes:sum(rs,r=>r.result.visitedPositionCount??0),qNodes:sum(rs,r=>r.result.quiescenceVisitedPositionCount??0),
  totalOrdinaryNodes:sum(rs,r=>r.result.totalVisitedPositionCount??r.result.visitedPositionCount??0),
  totalQNodes:sum(rs,r=>r.result.totalQuiescenceVisitedPositionCount??r.result.quiescenceVisitedPositionCount??0),
  depth:hist(rs.map(r=>r.result.completedDepth??r.result.depth)),source:hist(rs.map(r=>r.result.resultSource??r.kind)),
  statistics:Object.fromEntries([...new Set(rs.flatMap(r=>Object.keys(r.statistics)))].map(k=>[k,stat(rs,k)])) });
const basic=rows.filter(r=>ids.includes(r.position)&&r.depth===4);
const modes=Object.fromEntries(['fixed','iterative','100ms','1000ms'].map(kind=>[kind,Object.fromEntries(['A','B','C'].map(v=>[v,aggregate(basic.filter(r=>r.kind===kind&&r.variant===v))]))]));
const deterministic=Object.fromEntries(['A','B','C'].map(v=>[v,aggregate(basic.filter(r=>['fixed','iterative'].includes(r.kind)&&r.variant===v))]));
const perPosition=ids.map(id=>({ id,...Object.fromEntries(['fixed','iterative'].map(kind=>[kind,Object.fromEntries(['A','B','C'].map(v=>[v,aggregate(basic.filter(r=>r.position===id&&r.kind===kind&&r.variant===v))]))])) }));
const reduction=(before,after)=>100*(1-after/before);
const report={rawSha256:rawHash,base12:{modes,deterministic,perPosition},additional:audited.groups.filter(g=>g.position==='long-legal-history'||g.depth===5),
  deterministicTimeReductionPercent:reduction(deterministic.B.totalMs,deterministic.C.totalMs),
  deterministicIdentityReductionPercent:reduction(deterministic.B.statistics.identityGenerations,deterministic.C.statistics.identityGenerations),
  fixedIdentityReductionPercent:reduction(modes.fixed.B.statistics.identityGenerations,modes.fixed.C.statistics.identityGenerations) };
const fmt=n=>n.toFixed(3), pct=n=>n.toFixed(2)+'%';
const lines=['# 機械再集計（基本12局面、本測定3回）','',
  'A=固定main OFF、B=固定main旧TT ON、C=改善TT ON。p95はnearest rank。局面別n=3のp95は最大値。全体は異質局面のプール値。通常/qのtotal系は完了反復だけを含み、TT統計は中断反復も含む。時限の時間差と生成数差は完了深さ/仕事量の差も含み、同一仕事の速度向上・生成削減を意味しない。','',
  '| 条件 | A p50/p95 ms | B p50/p95 ms | C p50/p95 ms | B→C合計時間削減 | identity B→C（削減率） |',
  '| --- | ---: | ---: | ---: | ---: | ---: |'];
for(const [kind,m] of Object.entries(modes)) lines.push(`| ${kind} | ${fmt(m.A.p50Ms)}/${fmt(m.A.p95Ms)} | ${fmt(m.B.p50Ms)}/${fmt(m.B.p95Ms)} | ${fmt(m.C.p50Ms)}/${fmt(m.C.p95Ms)} | ${pct(reduction(m.B.totalMs,m.C.totalMs))} | ${m.B.statistics.identityGenerations}→${m.C.statistics.identityGenerations} (${pct(reduction(m.B.statistics.identityGenerations,m.C.statistics.identityGenerations))}) |`);
lines.push('',`固定＋無期限反復の合計実時間 B=${fmt(deterministic.B.totalMs)}ms → C=${fmt(deterministic.C.totalMs)}ms、削減 ${pct(report.deterministicTimeReductionPercent)}。identity ${deterministic.B.statistics.identityGenerations}→${deterministic.C.statistics.identityGenerations} (${pct(report.deterministicIdentityReductionPercent)})。時限の生成回数は仕事量/深さも変わるため、同じ仕事の削減率ではない。`,'',
  '| 局面 | 固定d4 p50 A ms | B ms | C ms | B→C時間削減 | 反復p50 B→C ms |',
  '| --- | ---: | ---: | ---: | ---: | ---: |');
for(const p of perPosition) lines.push(`| ${p.id} | ${fmt(p.fixed.A.p50Ms)} | ${fmt(p.fixed.B.p50Ms)} | ${fmt(p.fixed.C.p50Ms)} | ${pct(reduction(p.fixed.B.p50Ms,p.fixed.C.p50Ms))} | ${fmt(p.iterative.B.p50Ms)}→${fmt(p.iterative.C.p50Ms)} |`);
lines.push('','| 時限/variant | 完了深さ分布 | source分布 | 最大超過 ms | RSS参考最大 MiB |','| --- | --- | --- | ---: | ---: |');
for(const kind of ['100ms','1000ms']) for(const v of ['A','B','C']) { const m=modes[kind][v]; lines.push(`| ${kind}/${v} | ${JSON.stringify(m.depth)} | ${JSON.stringify(m.source)} | ${fmt(m.maxOverrunMs)} | ${(m.maxRss/1024/1024).toFixed(1)} |`); }
lines.push('','各セルのp50/p95、通常/qノード、完了深さ、exact再利用、全TT統計、RSS/CPUはreport.jsonおよびrun1/summary.jsonを参照。RSSは同一processで各呼出し前後に観測した値の最大であり、OS high-water値やvariant単独の保持量の差ではない。','');
for(const [name,data] of [['report.json',JSON.stringify(report)+'\n'],['results.md',lines.join('\n')]]) {
  const target=join(root,name);
  if(existsSync(target)) assert.equal(readFileSync(target,'utf8'),data); else writeFileSync(target,data,{flag:'wx'});
}
console.log(JSON.stringify({timeReductionPercent:report.deterministicTimeReductionPercent,identityReductionPercent:report.deterministicIdentityReductionPercent,fixedIdentityReductionPercent:report.fixedIdentityReductionPercent}));
