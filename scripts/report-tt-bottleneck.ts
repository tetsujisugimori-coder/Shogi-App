// Offline reports only: all timing data comes from saved, audited rows.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { json, parse } from './benchmarks/partialRootMatches';
import { percentile } from './audit-tt-bottleneck';
const root=resolve(process.argv[2]);
const load=(name:string)=>parse(readFileSync(join(root,name),'utf8'));
const summary=load('run1/summary.json');
const groups=summary.groups;
const pct=(a:number,b:number)=>(100*(b/a-1)).toFixed(2);
const lines=['| Position | Mode | OFF p50 ms | old TT p50 ms | current TT p50 ms | C/B change |',
  '|---|---|---:|---:|---:|---:|'];
for(const g of groups.filter((g:any)=>g.variant==='A')) {
  const b=groups.find((x:any)=>x.position===g.position&&x.kind===g.kind&&x.variant==='B');
  const c=groups.find((x:any)=>x.position===g.position&&x.kind===g.kind&&x.variant==='C');
  lines.push(`|${g.position}|${g.kind}|${g.p50Ms.toFixed(3)}|${b.p50Ms.toFixed(3)}|${c.p50Ms.toFixed(3)}|${pct(b.p50Ms,c.p50Ms)}%|`);
}
const totals=[];
for(const kind of ['fixed','iterative','100ms','1000ms','fixed+iterative']) for(const variant of ['A','B','C']) {
  const g=groups.filter((g:any)=>g.variant===variant&&(g.kind===kind||kind==='fixed+iterative'&&['fixed','iterative'].includes(g.kind)));
  totals.push({kind,variant,n:g.reduce((n:number,x:any)=>n+x.n,0),
    totalMs:g.reduce((n:number,x:any)=>n+x.totalMs,0),cpuMs:g.reduce((n:number,x:any)=>n+x.cpuMs,0),
    ordinaryNodes:g.reduce((n:number,x:any)=>n+x.ordinaryNodes,0),qNodes:g.reduce((n:number,x:any)=>n+x.qNodes,0),
    statistics:Object.fromEntries(['lookups','hits','misses','exactReuses','identityGenerations','stores','evictions','nonExactStoreRejects','sizeStoreRejects'].map(k=>[k,
      g.some((x:any)=>x.statistics[k]===undefined)?null:g.reduce((n:number,x:any)=>n+x.statistics[k],0)]))});
}
writeFileSync(join(root,'comparison.json'),json({totals})+'\n');
writeFileSync(join(root,'comparison.md'),lines.join('\n')+'\n');
const diag=load('diagnostic/summary.json');
const stageLines=['Inclusive diagnostic milliseconds; n=1 measured call per position, warmup excluded. Overlapping stages must not be summed.',
  '', '| Position | key A | full identity C | probe E inclusive | clone H | store G inclusive | FIFO I |','|---|---:|---:|---:|---:|---:|---:|'];
for(const g of diag.groups.filter((g:any)=>g.variant==='P')) {
  const p=g.diagnostic[0];
  stageLines.push(`|${g.position}|${['A-coarse-key','C-full-identity','E-probe-inclusive','H-clone-result','G-store-inclusive','I-fifo-capacity-map'].map(k=>p[k].ms.toFixed(3)).join('|')}|`);
}
const overhead=load('overhead/summary.json');
stageLines.push('', 'Wrapper overhead control: independent C/P processes, neither uses CPU sampling, n=7; positive change means P is slower.',
  '', '| Position | C p50 ms | P p50 ms | change | paired delta min / p50 / max ms |','|---|---:|---:|---:|---:|');
for(const c of overhead.groups.filter((g:any)=>g.variant==='C')) {
  const p=overhead.groups.find((g:any)=>g.variant==='P'&&g.position===c.position);
  const deltas=p.distributionMs.map((v:number,i:number)=>v-c.distributionMs[i]);
  stageLines.push(`|${c.position}|${c.p50Ms.toFixed(3)}|${p.p50Ms.toFixed(3)}|${pct(c.p50Ms,p.p50Ms)}%|${Math.min(...deltas).toFixed(3)} / ${percentile(deltas,.5).toFixed(3)} / ${Math.max(...deltas).toFixed(3)}|`);
}
writeFileSync(join(root,'stages.md'),stageLines.join('\n')+'\n');
const profilePath=join(root,'diagnostic/C.cpuprofile');
const profile=parse((existsSync(profilePath)?readFileSync(profilePath):gunzipSync(readFileSync(profilePath+'.gz'))).toString());
const nodes=new Map<number,any>(profile.nodes.map((n:any)=>[n.id,n]));
const samples=new Map<string,number>();
assert.equal(profile.samples.length,profile.timeDeltas.length);
for(let i=0;i<profile.samples.length;i++) {
  const frame=nodes.get(profile.samples[i]).callFrame;
  const name=`${frame.functionName||'(anonymous)'} ${frame.url}`;
  samples.set(name,(samples.get(name)??0)+profile.timeDeltas[i]);
}
const frames=[...samples.entries()].map(([frame,microseconds])=>({frame:frame.replaceAll('\\','/'),sampledMs:microseconds/1000})).sort((a,b)=>b.sampledMs-a.sampledMs);
writeFileSync(join(root,'cpu-samples.json'),json({scope:'Whole diagnostic C worker process, including imports, IPC, preparation and idle; sampled self time, not exclusive search wall time.',frames})+'\n');
console.log(json({totals,topFrames:frames.slice(0,15)}));
