import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const out=resolve(process.argv[2]);mkdirSync(out);
const npm=join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const checks=[
 ['related-summary',[resolve('scripts/stage-w1b-summary-check.mjs')]],
 ['related-w1',[resolve('scripts/stage-w1-summary-check.mjs')]],
 ['related-product',[npm,'test','--','game-blunder','match-journal']],
 ['lock',[npm,'run','verify:lock']],
 ['typecheck',[npm,'run','lint']],
 ['build',[npm,'run','build']],
 // All 98 tracked product suites live here. Temporary fixtures are preserved.
 ['full-product',[npm,'test','--','src/test']],
];
const rows=[];
for(const [name,args] of checks) {
 const started=new Date().toISOString();console.log(`Starting ${name}`);
 const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:64*1024*1024});
 writeFileSync(join(out,`${name}-stdout.txt`),r.stdout??'');writeFileSync(join(out,`${name}-stderr.txt`),r.stderr??'');
 rows.push({name,command:[process.execPath,...args],cwd:process.cwd(),started,finished:new Date().toISOString(),exitCode:r.status,signal:r.signal,error:r.error?.message??null});
 writeFileSync(join(out,'results.json'),JSON.stringify(rows,null,2)+'\n');console.log(`${name}: exit ${r.status}`);
}
process.exitCode=rows.every(r=>r.exitCode===0)?0:1;
