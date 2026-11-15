// Offline CLI regressions: portable recordings, no product execution or junctions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutations, cli } from './stage-w1d-controls.mjs';
import { read, hash, tree } from './stage-w1b-preflight.mjs';
import { assess } from './stage-w1b-summary.mjs';
const root=mkdtempSync(join(process.env.W1D_FIXTURES??tmpdir(),'shogi-w1d-'));
const write=(p,o)=>writeFileSync(p,JSON.stringify(o,null,2)+'\n');
const seed=fileURLToPath(new URL('../docs/benchmarks/game-blunder-w1c-20261115/accepted-final',import.meta.url));
const baseline=join(root,'baseline');cpSync(seed,baseline,{recursive:true});
// Rebase the saved Windows recording onto native paths; do not run its commands.
const convert=o=>typeof o==='string'&&win32.isAbsolute(o)?join(root,'virtual',...o.replaceAll('\\','/').slice(3).split('/')):Array.isArray(o)?o.map(convert):o&&typeof o==='object'?Object.fromEntries(Object.entries(o).map(([k,v])=>[k,convert(v)])):o;
for(const e of tree(baseline).filter(e=>e.path.endsWith('.json')))write(join(baseline,e.path),convert(read(join(baseline,e.path))));
const preflight=read(join(baseline,'preflight.json')),ready=read(join(baseline,'ready.json'));
const sha=p=>hash(readFileSync(p));
ready.preflightSha256=sha(join(baseline,'preflight.json'));
for(const [i,t] of ready.trials.entries()) {
  const collection=join(baseline,`collect-${i}`),trial=join(baseline,`trial-${i}`);
  t.request.preflightSha256=ready.preflightSha256;
  // Collection settings are compared structurally and by their raw file hash.
  t.settings=read(join(collection,'settings.json'));
  t.inventorySha256=sha(join(collection,'inventory.json'));t.settingsSha256=sha(join(collection,'settings.json'));
  write(join(collection,'request.json'),t.request);
  const q=read(join(trial,'request.json'));Object.assign(q,{...t.request,mode:'run',output:join(preflight.output,`trial-${i}`),inventorySha256:t.inventorySha256,expectedSettings:t.settings});write(join(trial,'request.json'),q);
  const r=read(join(trial,'runtime.json'));Object.assign(r,{preflightSha256:ready.preflightSha256,inventorySha256:t.inventorySha256});write(join(trial,'runtime.json'),r);
  const a=read(join(trial,'assessment.json'));Object.assign(a,{preflightSha256:ready.preflightSha256,inventorySha256:t.inventorySha256});
  a.assessment=assess({exitCode:a.exitCode,runtime:r,provenanceVerified:true},read(join(trial,'vitest.json')),read(join(collection,'inventory.json')),[]);
  assert.equal(a.assessment.status,'PASS');
  for(const f of Object.keys(a.bindings))a.bindings[f]=sha(join(trial,f));write(join(trial,'assessment.json'),a);
}
write(join(baseline,'ready.json'),ready);write(join(baseline,'ready.sha256.json'),{sha256:sha(join(baseline,'ready.json'))});
test('normal recording with two trials and duplicate names passes',()=>{const r=cli(baseline);assert.equal(r.exitCode,0,r.stdout);assert.equal(r.result.status,'PASS');assert.equal(r.result.results.length,2);});
for(const [name,mutate] of mutations)test(name,()=>{const p=join(root,name);cpSync(baseline,p,{recursive:true});mutate(p);const r=cli(p);write(join(root,name+'-outcome.json'),r);assert.equal(r.result.status,'INVALID',r.stdout);assert.equal(r.exitCode,1);assert.equal(r.newComparisonSpawns,0);});
console.log(`Retained W1d portable fixtures: ${resolve(root)}`);
