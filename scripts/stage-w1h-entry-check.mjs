import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { prepare, launch } from './stage-w1b-runner.mjs';
import { admitTargets } from './stage-w1h-target.mjs';
import { FIXED_HEADS } from './stage-w1g-gate.mjs';
const root = mkdtempSync(resolve(process.env.W1H_TEST_ROOT ?? '../w1h-entry-fixture-'));
const repo=join(root,'repo');mkdirSync(repo);
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',timeout:10000,env:{...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'}}).trim();
git('init');writeFileSync(join(repo,'fixture.txt'),'harmless\n');git('add','.');git('commit','-m','synthetic fixture');
const head=git('rev-parse','HEAD');
const target=h=>({repo,dir:repo,head:h});
const hash=x=>createHash('sha256').update(x).digest('hex');
const snapshot=()=>Object.fromEntries(readdirSync(repo).filter(x=>x!=='.git').map(x=>[x,hash(readFileSync(join(repo,x)))]));
const before=snapshot();
for(const [i,h] of FIXED_HEADS.entries()) {
 test(`fixed ${i} prepare rejected before output creation`,()=>{const out=join(root,`prepare-${i}`);const r=prepare({targets:[target(h),target(head)]},out);assert.equal(r.code,'W1G_FIXED_COMPARISON_BLOCKED');assert.equal(existsSync(out),false);assert.deepEqual(snapshot(),before);});
 for(const mode of ['collect','run']) test(`fixed ${i} direct worker ${mode} rejected before import`,()=>{const request=join(root,`${i}-${mode}.json`);writeFileSync(request,JSON.stringify({mode,target:target(h),dir:repo,output:join(root,'never-created')}));const r=spawnSync(process.execPath,[resolve('scripts/stage-w1b-worker.mjs'),request],{encoding:'utf8',timeout:10000});assert.equal(r.status,1);assert.match(r.stderr,/W1G_FIXED_COMPARISON_BLOCKED/);assert.doesNotMatch(r.stderr,/Cannot find package|MODULE_NOT_FOUND/);assert.equal(existsSync(join(root,'never-created')),false);assert.deepEqual(snapshot(),before);});
 test(`fixed ${i} saved READY launch refused`,()=>{const out=join(root,`ready-${i}`);mkdirSync(out);const pre={runId:'fake',plan:{targets:[target(h),target(head)]}};const pb=JSON.stringify(pre);writeFileSync(join(out,'preflight.json'),pb);const rb=JSON.stringify({runId:'fake',preflightSha256:hash(pb)});writeFileSync(join(out,'ready.json'),rb);writeFileSync(join(out,'ready.sha256.json'),JSON.stringify({sha256:hash(rb)}));const files=readdirSync(out);assert.equal(launch(out).code,'W1G_FIXED_COMPARISON_BLOCKED');assert.deepEqual(readdirSync(out),files);});
}
test('non-fixed synthetic Git identity accepted',()=>assert.doesNotThrow(()=>admitTargets([target(head)])));
for(const h of ['HEAD','--bad','0'.repeat(40),null]) test(`unknown/ref ${h} refused`,()=>assert.throws(()=>admitTargets([target(h)]),/W1H_TARGET_IDENTITY_UNKNOWN/));
test('legacy PowerShell entry stops unconditionally',()=>{const s=readFileSync('scripts/stage-w1-run.ps1','utf8');assert.match(s,/throw 'W1G_FIXED_COMPARISON_BLOCKED'/);assert.doesNotMatch(s,/Start-Process|npm test|vitest run/);});
test('prepare static regression guard precedes mkdir and collection',()=>{const s=readFileSync('scripts/stage-w1b-runner.mjs','utf8').split('export function prepare')[1].split('export function launch')[0];assert.ok(s.indexOf('admitTargets')<s.indexOf('mkdirSync'));assert.ok(s.indexOf('admitTargets')<s.indexOf('child(out,request)'));});
for(const [i,tree] of ['5ced08e0036f955833ca2e12722bfbd595a00afd','3d06ccd81473b78bc3eb721c516693042ae2c118'].entries()) {
 const has=spawnSync('git',['cat-file','-e',tree],{timeout:10000}).status===0;
 test(`same fixed tree ${i} alternate commit blocked`,{skip:has?false:'historical tree unavailable in shallow CI checkout'},()=>{
  const r=spawnSync('git',['commit-tree',tree,'-m','W1h unreferenced safety test object'],{encoding:'utf8',timeout:10000,env:{...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'}});
  assert.equal(r.status,0,r.stderr); const alias=r.stdout.trim();assert.ok(!FIXED_HEADS.includes(alias));
  const t={repo:process.cwd(),dir:repo,head:alias};assert.throws(()=>admitTargets([t]),/W1G_FIXED_COMPARISON_BLOCKED/);
  const out=join(root,`tree-${i}`);assert.equal(prepare({targets:[t,target(head)]},out).code,'W1G_FIXED_COMPARISON_BLOCKED');assert.equal(existsSync(out),false);
 });
}

test('malformed saved READY cannot write before identity admission',()=>{const out=join(root,'malformed');mkdirSync(out);writeFileSync(join(out,'ready.json'),'{}');writeFileSync(join(out,'ready.sha256.json'),'{');const prior=readdirSync(out);assert.equal(launch(out).status,'UNKNOWN');assert.deepEqual(readdirSync(out),prior);});
