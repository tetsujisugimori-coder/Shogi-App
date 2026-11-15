// Read-only audit; save a new report, never repair original evidence or snapshots.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { hash, read, tree, digest } from './stage-w1b-preflight.mjs';
const out=resolve(process.argv[2]),destination=resolve(process.argv[3]);
const before=read(join(out,'protected-before.json'));
const after=before.map(x=>({path:x.path,sha256:hash(readFileSync(x.path))}));
const prior=read('docs/benchmarks/game-blunder-w1b-review-20261115/protected-before.json');
const snapshots=read(join(out,'old-snapshots-before.json')).map(s=>{const entries=tree(resolve('../stage-w1-snapshots',s.label));return {...s,afterEntries:entries.length,afterSha256:digest(entries),unchanged:s.sha256===digest(entries)};});
const report={at:new Date().toISOString(),protectedCount:after.length,beforeAfterMismatches:after.filter((x,i)=>x.sha256!==before[i].sha256),priorManifestMismatches:after.filter((x,i)=>x.path!==prior[i].path||x.sha256!==prior[i].sha256),after,oldSnapshots:snapshots,scope:'Raw byte/directory consistency, not historical execution authenticity.'};
writeFileSync(destination,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({protectedCount:after.length,mismatches:report.beforeAfterMismatches.length,priorMismatches:report.priorManifestMismatches.length,oldSnapshots:snapshots.map(x=>({label:x.label,unchanged:x.unchanged}))}));
if(after.length!==103||report.beforeAfterMismatches.length||report.priorManifestMismatches.length||snapshots.some(s=>!s.unchanged))process.exitCode=1;
