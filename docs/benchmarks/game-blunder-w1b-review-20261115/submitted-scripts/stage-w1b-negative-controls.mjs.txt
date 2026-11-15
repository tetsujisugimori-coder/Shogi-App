import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { prepare, launch, verify } from './stage-w1b-runner.mjs';
import { read } from './stage-w1b-preflight.mjs';
const [planFile,outArg,normalArg]=process.argv.slice(2),plan=read(planFile),out=resolve(outArg),normal=resolve(normalArg);
mkdirSync(out);
const write=(p,o)=>writeFileSync(p,JSON.stringify(o,null,2)+'\n');
const starts=p=>readdirSync(p).filter(f=>/^event-/.test(f)).map(f=>read(join(p,f))).filter(e=>e.action==='spawn'&&e.phase==='run').length;
const rows=[];
const blocked=(name,dir,result,before=0)=>{const after=starts(dir);assert.notEqual(result.status,'PASS');assert.notEqual(result.status,'READY');assert.equal(after,before);rows.push({name,result,comparisonChildrenBefore:before,comparisonChildrenAfter:after});};
const noConfig=structuredClone(plan);delete noConfig.expected.cache;
const missing=join(out,'missing-config');blocked('missing effective setting',missing,prepare(noConfig,missing));
assert.equal(readdirSync(missing).filter(f=>/^event-/.test(f)).length,0);
// Fake dependency trees are used only for admission rejection; never executed.
const fake=structuredClone(plan);
for(let i=0;i<2;i++) {
  const dir=join(dirname(plan.targets[0].dir),`negative-fake-target-${i}`);mkdirSync(dir);
  for(const f of ['package.json','package-lock.json','vitest.config.mjs','tiny.test.js'])copyFileSync(join(plan.targets[i].dir,f),join(dir,f));
  mkdirSync(join(dir,'node_modules/vitest'),{recursive:true});write(join(dir,'node_modules/vitest/package.json'),{version:'4.1.11'});writeFileSync(join(dir,'node_modules/payload'),String(i));fake.targets[i].dir=dir;
}
const deps=join(out,'dependency-mismatch');blocked('dependency mismatch',deps,prepare(fake,deps));
assert.equal(readdirSync(deps).filter(f=>/^event-/.test(f)).length,0);
const source=join(out,'source-mismatch'),sourcePath=join(plan.targets[0].dir,'tiny.test.js'),sourceBytes=readFileSync(sourcePath);
try {writeFileSync(sourcePath,Buffer.concat([sourceBytes,Buffer.from('// changed\n')]));blocked('source mismatch',source,prepare(plan,source));assert.equal(readdirSync(source).filter(f=>/^event-/.test(f)).length,0);} finally {writeFileSync(sourcePath,sourceBytes);}
const gate=join(out,'prepared-negative');assert.equal(prepare(plan,gate).status,'READY');
function tamper(name,path,bytes) {
  const saved=readFileSync(path);try {writeFileSync(path,bytes);blocked(name,gate,launch(gate));} finally {writeFileSync(path,saved);}
}
tamper('preflight modified',join(gate,'preflight.json'),'{}');
tamper('inventory modified',join(gate,'collect-0/inventory.json'),'{}');
tamper('settings modified',join(gate,'collect-0/settings.json'),'{}');
tamper('source changed after collection',sourcePath,Buffer.concat([sourceBytes,Buffer.from('// after collection\n')]));
const ready=read(join(gate,'ready.json'));ready.trials[0].trialId=ready.trials[1].trialId;
tamper('another trial identity',join(gate,'ready.json'),JSON.stringify(ready));
// Pre-existing result directory is refused before starting any comparison process.
mkdirSync(join(gate,'trial-0'));copyFileSync(join(normal,'trial-1/runtime.json'),join(gate,'trial-0/runtime.json'));
blocked('reused result before launch',gate,launch(gate));
const baseline=verify(normal);assert.equal(baseline.status,'PASS',JSON.stringify(baseline));
const runtimePath=join(normal,'trial-0/runtime.json'),saved=readFileSync(runtimePath);
try {copyFileSync(join(normal,'trial-1/runtime.json'),runtimePath);const result=verify(normal);assert.equal(result.status,'INVALID');rows.push({name:'another trial result offline',result,comparisonChildrenStarted:0});} finally {writeFileSync(runtimePath,saved);}
assert.equal(verify(normal).status,'PASS');
write(join(out,'outcomes.json'),rows);console.log(JSON.stringify(rows));
