// Portable admission regressions. Fixtures are retained, never recursively deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspect, tree, contains } from './stage-w1b-preflight.mjs';
const root=mkdtempSync(join(process.env.W1C_FIXTURES??tmpdir(),'shogi-w1c-'));
const runner=fileURLToPath(new URL('./stage-w1b-runner.mjs',import.meta.url));
function fixture() {
  const dir=mkdtempSync(join(root,'case-'));
  writeFileSync(join(dir,'package.json'),'{"type":"module"}\n');
  writeFileSync(join(dir,'package-lock.json'),'{}\n');
  writeFileSync(join(dir,'source.txt'),'line one\nline two\n');
  const git=(...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  git('init');git('-c','core.autocrlf=false','add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','raw source');
  const head=git('rev-parse','HEAD'),repo=dir+'-repo';mkdirSync(repo);renameSync(join(dir,'.git'),join(repo,'.git'));
  mkdirSync(join(dir,'node_modules/vitest'),{recursive:true});writeFileSync(join(dir,'node_modules/vitest/package.json'),'{"version":"4.1.11"}');
  return {dir,repo,head};
}
test('normal raw source accepted and manifests reproducible',()=>{const t=fixture();assert.deepEqual(inspect(t.repo,t.dir,t.head),inspect(t.repo,t.dir,t.head));});
test('path containment respects directory boundary',()=>{assert.equal(contains(join(root,'a'),join(root,'ab')),false);assert.equal(contains(root,join(root,'a')),true);assert.equal(contains(root,resolve(root,'..')),false);});
for(const [name,mutate] of [
 ['CRLF raw blob mismatch',t=>writeFileSync(join(t.dir,'source.txt'),'line one\r\nline two\r\n')],
 ['untracked empty directory',t=>mkdirSync(join(t.dir,'unknown-empty'))],
 ['untracked regular file',t=>writeFileSync(join(t.dir,'unknown'),'extra')],
 ['tracked file becomes directory',t=>{renameSync(join(t.dir,'source.txt'),t.dir+'-saved-source');mkdirSync(join(t.dir,'source.txt'));}],
]) test(name,()=>{
  const t=fixture();mutate(t);
  const plan={targets:[t,t],filters:[],expected:{pool:'forks',maxWorkers:2,testTimeout:5000,cache:true}};
  const input=join(t.dir,'..',`${t.dir.split(/[\\/]/).at(-1)}-plan.json`),out=input+'-output';writeFileSync(input,JSON.stringify(plan));
  const r=spawnSync(process.execPath,[runner,'prepare',input,out],{encoding:'utf8'});
  assert.equal(existsSync(out),false,'W1h rejects invalid source before output creation');
  const starts=(existsSync(out)?readdirSync(out):[]).filter(f=>f.startsWith('event-')).map(f=>JSON.parse(readFileSync(join(out,f)))).filter(e=>e.phase==='run'&&e.action==='spawn').length;
  writeFileSync(input+'-outcome.json',JSON.stringify({name,expected:'UNKNOWN, exit 1, comparison starts 0',stdout:r.stdout,stderr:r.stderr,exitCode:r.status,comparisonStarts:starts}));
  assert.equal(r.status,1);const result=JSON.parse(r.stdout);assert.equal(result.status,'UNKNOWN');assert.match(result.reason,/blob mismatch|untracked snapshot|not regular source/);assert.equal(starts,0);
});
test('dependency contents AND empty directories affect the seal',()=>{const t=fixture(),before=inspect(t.repo,t.dir,t.head);writeFileSync(join(t.dir,'node_modules/payload'),'changed');assert.notEqual(inspect(t.repo,t.dir,t.head).dependenciesSha256,before.dependenciesSha256);const next=inspect(t.repo,t.dir,t.head);mkdirSync(join(t.dir,'node_modules/cache-empty'));assert.notEqual(inspect(t.repo,t.dir,t.head).dependenciesSha256,next.dependenciesSha256);});
test('internal symlinks and cycles rejected',{skip:process.platform==='win32'&&!process.env.W1C_WINDOWS_LINKS},()=>{const t=fixture();symlinkSync(t.dir,join(t.dir,'cycle'),process.platform==='win32'?'junction':'dir');assert.throws(()=>inspect(t.repo,t.dir,t.head),/symlink|junction/);assert.throws(()=>tree(t.dir),/symlink|junction/);});
console.log(`Retained portable fixtures: ${root}`);
