// Execute extracted, byte-preserved installed Vitest methods on synthetic files.
// No product test or old/new comparison is launched.
import fs from 'node:fs';
import vm from 'node:vm';
import {resolve,relative,dirname,join} from 'node:path';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {hash} from './stage-w1b-preflight.mjs';
const out=resolve(process.argv[2]),root=resolve(process.argv[3]);fs.mkdirSync(root);
const apiPath=resolve('node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js'),seqPath=resolve('node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js'),api=fs.readFileSync(apiPath,'utf8'),seq=fs.readFileSync(seqPath,'utf8');
const cacheSource=api.slice(api.indexOf('class ResultsCache {'),api.indexOf('class VitestCache {')),sortStart=seq.indexOf('\tasync sort(files) {'),sortSource=seq.slice(sortStart,seq.indexOf('\n\t// Calculate distributed shard range',sortStart));
const ResultsCache=vm.runInNewContext(cacheSource+'\nResultsCache',{fs,resolve,relative,dirname,existsSync:fs.existsSync,rm:fs.promises.rm,Vitest:{version:'4.1.11'}}),sort=vm.runInNewContext('({'+sortSource+'}).sort',{relative});
const cache=new ResultsCache(console);cache.setConfig(root,{dir:root});
const file=(name,duration,state)=>({filepath:join(root,name),projectName:'',result:{duration,state}});
const snapshots=[];async function save(name,files){cache.updateResults(files);await cache.writeToCache();snapshots.push({name,base64:fs.readFileSync(join(root,'results.json')).toString('base64'),sha256:hash(fs.readFileSync(join(root,'results.json'))),content:JSON.parse(fs.readFileSync(join(root,'results.json')))});}
await save('first',[file('a.test.ts',5,'pass'),file('b.test.ts',10,'pass')]);
const project={name:'',config:{sequence:{groupOrder:0},isolate:true}},specs=['a.test.ts','b.test.ts'].map(n=>({moduleId:join(root,n),project})),context={config:{root},cache:{getFileTestResults:k=>cache.getResults(k)}};
const order=async()=>Array.from(await sort.call({ctx:context},specs),s=>relative(root,s.moduleId));
const first=await order();await save('failure-change',[file('a.test.ts',5,'fail')]);const failure=await order();await save('duration-change',[file('a.test.ts',20,'pass')]);const duration=await order();
assert.deepEqual(first,['b.test.ts','a.test.ts']);assert.deepEqual(failure,['a.test.ts','b.test.ts']);assert.deepEqual(duration,['a.test.ts','b.test.ts']);
const restored=new ResultsCache(console);restored.setConfig(root,{dir:root});await restored.readFromCache();assert.equal(restored.getResults(':a.test.ts').duration,20);
fs.writeFileSync(join(out,'cache-semantic-sources.json.gz'),gzipSync(JSON.stringify([apiPath,seqPath].map(path=>{const b=fs.readFileSync(path);return {path,base64:b.toString('base64'),sha256:hash(b)};}))),{flag:'wx'});
fs.writeFileSync(join(out,'cache-semantics.json'),JSON.stringify({status:'PASS',scope:'source-backed synthetic semantic experiment, not historical execution proof',version:'4.1.11',cacheSource,sortSource,snapshots,orders:{first,failure,duration},readReuse:'PASS',fields:{id:'project name + root-relative file path (not individual assertion ID)',failed:'file.result.state === fail',duration:'file.result.duration || 0, negative clamped to zero',executionCount:'no explicit count field; duration/state are overwritten per latest file result; prior unselected keys persist'},updatePhase:'runFiles after pool.runTests; collection evidence separately evaluated',resultImpact:'cached prior outcomes are not assertion substitutes in these methods; failure/duration change sequencing; downstream timing effect cannot be excluded',safeAllowance:'NOT_ESTABLISHED',comparisonSpawns:0},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PASS',orders:{first,failure,duration},safeAllowance:'NOT_ESTABLISHED'}));
