import { mkdirSync, writeFileSync, symlinkSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { prepare } from './stage-w1b-runner.mjs';
import { read } from './stage-w1b-preflight.mjs';
const [outArg,rootArg]=process.argv.slice(2),out=resolve(outArg),root=resolve(rootArg);mkdirSync(out);mkdirSync(root);
const source=join(root,'source');mkdirSync(source);
const files={
 'package.json':'{"type":"module"}\n',
 'package-lock.json':'{"fixture":"same-lock-in-both-targets"}\n',
 'state.txt':'clean\n',
 'setup.js':"import {writeFileSync} from 'node:fs';writeFileSync(new URL('./state.txt',import.meta.url),'changed by collection setup\\n');\n",
 'tiny.test.js':"import {it,expect} from 'vitest';it('never run',()=>expect(1).toBe(1));\n",
 'vitest.config.mjs':`export default {cacheDir:${JSON.stringify(join(root,'cache'))},test:{environment:'node',maxWorkers:2,cache:false,setupFiles:['./setup.js']}};\n`,
};
for(const [f,b] of Object.entries(files))writeFileSync(join(source,f),b);
const git=(...args)=>execFileSync('git',['-C',source,...args],{encoding:'utf8'}).trim();
git('init');git('-c','core.autocrlf=false','add','.');git('-c','user.name=W1b fixture','-c','user.email=fixture@example.invalid','commit','-m','setup side effect control');
const head=git('rev-parse','HEAD'),targets=[];
for(const name of ['a','b']) {
 const dir=join(root,name);mkdirSync(dir);
 for(const f of Object.keys(files))writeFileSync(join(dir,f),execFileSync('git',['-C',source,'show',`${head}:${f}`]));
 symlinkSync(resolve('node_modules'),join(dir,'node_modules'),'junction');targets.push({repo:source,dir,head});
}
const plan={targets,filters:[],expected:{pool:'forks',maxWorkers:2,testTimeout:5000,cache:false}},run=join(out,'run');
for(const name of ['temp','npm-cache','cache']) mkdirSync(join(root,name),{recursive:true});
plan.environment={TEMP:join(root,'temp'),TMP:join(root,'temp'),npm_config_cache:join(root,'npm-cache')};plan.isolationPaths=[join(root,'cache')];
writeFileSync(join(out,'plan.json'),JSON.stringify(plan,null,2));
const result=prepare(plan,run),events=readdirSync(run).filter(f=>f.startsWith('event-')).map(f=>read(join(run,f)));
const starts=events.filter(e=>e.phase==='run'&&e.action==='spawn').length;
assert.equal(result.status,'UNKNOWN');assert.match(result.reason,/blob mismatch|changed/);assert.equal(starts,0);
writeFileSync(join(out,'outcome.json'),JSON.stringify({result,collectionChildren:events.filter(e=>e.phase==='collect').length,comparisonChildren:starts,setupSideEffects:targets.map(t=>({dir:t.dir,state:readFileSync(join(t.dir,'state.txt'),'utf8')})),note:'Collection is now checked after each target; later targets need not execute setup. Modified fixture bytes are retained.'},null,2));
console.log(JSON.stringify({result,comparisonChildren:starts}));
