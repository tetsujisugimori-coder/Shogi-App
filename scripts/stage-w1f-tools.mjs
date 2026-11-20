// Preparation/evidence utilities; no real comparison execution path.
import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {inventory} from './stage-w1e-observation.mjs';
import {tree,hash,digest} from './stage-w1b-preflight.mjs';
const [mode,arg]=process.argv.slice(2),out=resolve(arg);
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const retained=root=>inventory(root).map(({path,type,sha256,target})=>({path,type,...(sha256?{sha256}:{}),...(target?{target}:{})}));
if(mode==='preserve'){
 const roots=fs.readdirSync(resolve('..')).filter(n=>/^(stage-w1|w1)/.test(n)&&!n.startsWith('stage-w1f')).map(n=>resolve('..',n)).filter(p=>fs.lstatSync(p).isDirectory());
 roots.push(resolve('.tmp-tests'));for(const n of fs.readdirSync('docs/benchmarks'))if(/w1/.test(n)&&!n.includes('w1f'))roots.push(resolve('docs/benchmarks',n));
 const values=roots.map(root=>({root,entries:retained(root)}));fs.writeFileSync(join(out,'protected-before.json.gz'),gzipSync(JSON.stringify(values)),{flag:'wx'});
}else if(mode==='readback'){
 const before=JSON.parse(gunzipSync(fs.readFileSync(join(out,'protected-before.json.gz'))));const checks=before.map(x=>({root:x.root,entries:x.entries.length,unchanged:digest(retained(x.root))===digest(x.entries)}));write(join(out,'protected-after.json'),{checks,allUnchanged:checks.every(c=>c.unchanged)});if(checks.some(c=>!c.unchanged))throw Error('PROTECTED_CHANGED');
}else if(mode==='probe-source'){
 let s=fs.readFileSync('scripts/stage-w1e-probe.mjs','utf8');
 s=s.replace("import fs,{promises as fsp}","import {observe} from './stage-w1f-observer.mjs';\nimport fs,{promises as fsp}");
 const start=s.indexOf('  const inside='),end=s.indexOf('  const state=',start);
 s=s.slice(0,start)+`  const observer=observe({out:join(out,\`\${i}-raw-events.jsonl\`),roots:[env.TEMP,join(root,'node_modules/.vite-temp'),join(root,'node_modules/.vite')],runId:plan.runId,trialId:plan.trialId,head:t.head,preSeal:plan.preSeals[i]});\n`+s.slice(end);
 s=s.replace('for(const restore of originals.reverse())restore();','const instrumentation=observer.finish({cleanupErrors}); events.push({instrumentation});');
 fs.writeFileSync('scripts/stage-w1f-probe.mjs',s,{flag:'wx'});
}else if(mode==='plan'){
 const p=JSON.parse(fs.readFileSync(join(out,'limited-plan.json')));p.runId='stage-w1f-20261116';p.trialId='fresh-pair-1';p.preSeals=['old','new'].map(n=>hash(fs.readFileSync(join(out,'build-retry',n+'-post-install.json'))));write(join(out,'probe-plan.json'),p);
}
