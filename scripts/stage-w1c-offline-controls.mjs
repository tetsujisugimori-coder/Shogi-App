import { mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const [normalArg,outArg,planArg]=process.argv.slice(2),normal=resolve(normalArg),out=resolve(outArg);mkdirSync(out);
const runner=fileURLToPath(new URL('./stage-w1b-runner.mjs',import.meta.url));
const starts=p=>readdirSync(p).filter(f=>f.startsWith('event-')).map(f=>JSON.parse(readFileSync(join(p,f)))).filter(e=>e.action==='spawn'&&e.phase==='run').length;
const rows=[];
for(const [name,mutate] of [
 ['interrupted-runtime',p=>writeFileSync(join(p,'trial-0/runtime.json'),'{')],
 ['missing-completion',p=>renameSync(join(p,'comparison.json'),join(p,'retained-comparison.json'))],
 ['another-trial-result',p=>writeFileSync(join(p,'trial-0/runtime.json'),readFileSync(join(p,'trial-1/runtime.json')))],
 ['truncated-log',p=>writeFileSync(join(p,'trial-0/stderr.log'),'truncated control')],
]) {
  const dir=join(out,name);cpSync(normal,dir,{recursive:true,errorOnExist:true,force:false});mutate(dir);const before=starts(dir);
  const r=spawnSync(process.execPath,[runner,'verify',dir],{encoding:'utf8'}),after=starts(dir);
  writeFileSync(join(out,name+'-stdout.txt'),r.stdout??'');writeFileSync(join(out,name+'-stderr.txt'),r.stderr??'');
  const result=JSON.parse(r.stdout);rows.push({name,input:'retained derivative copy of accepted normal',expected:'INVALID / exit 1 / new comparison events 0',actual:result,exitCode:r.status,comparisonEventsBefore:before,comparisonEventsAfter:after,newComparisonEvents:after-before});
  assert.equal(result.status,'INVALID');assert.equal(r.status,1);assert.equal(after,before);
}
const before=starts(normal),r=spawnSync(process.execPath,[runner,'prepare',resolve(planArg),normal],{encoding:'utf8'});
writeFileSync(join(out,'reused-output-stdout.txt'),r.stdout??'');writeFileSync(join(out,'reused-output-stderr.txt'),r.stderr??'');
rows.push({name:'existing output reuse CLI',expected:'exit 1 / new comparison events 0',exitCode:r.status,newComparisonEvents:starts(normal)-before});assert.equal(r.status,1);assert.equal(starts(normal),before);
writeFileSync(join(out,'outcomes.json'),JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify(rows));
