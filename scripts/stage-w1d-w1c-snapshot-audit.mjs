import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { inspect, tree, digest, read } from './stage-w1b-preflight.mjs';
const out=resolve(process.argv[2]),previous=resolve('docs/benchmarks/game-blunder-w1c-20261115'),plan=read(join(previous,'limited-plan.json')),rows=[];
for(const [i,t] of plan.targets.entries()){
 const label=i?'new':'old',baseline=read(join(previous,'build-03',label+'-dependency-manifest.json'));
 // W1c recorded exactly one added old-target directory, retained here.
 const expected=i?baseline:[...baseline,{path:'.vite-temp',type:'directory'}].sort((a,b)=>a.path.localeCompare(b.path,'en'));
 const actual=tree(join(t.dir,'node_modules')),observation=inspect(t.repo,t.dir,t.head),initial=read(join(previous,'build-03',label+'-post-install.json'));
 const byPath=v=>[...v].sort((a,b)=>a.path.localeCompare(b.path,'en'));
 rows.push({label,dir:t.dir,head:t.head,sourceUnchanged:observation.sourceSha256===initial.sourceSha256,dependenciesUnchangedFromW1cRecordedFinal:digest(byPath(actual))===digest(byPath(expected)),actualEntries:actual.length,expectedEntries:expected.length,sha256:digest(actual),scope:'W1c build-03 final state; failed build-01/02 roots not rewritten or fully re-audited.'});
}
writeFileSync(join(out,'w1c-snapshots-after.json'),JSON.stringify(rows,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(rows));if(rows.some(r=>!r.sourceUnchanged||!r.dependenciesUnchangedFromW1cRecordedFinal))process.exitCode=1;
