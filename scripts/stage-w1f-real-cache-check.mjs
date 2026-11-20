import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {actor,identity} from './stage-w1e-contract.mjs';
import {physical,hash} from './stage-w1b-preflight.mjs';
const out=resolve(process.argv[2]),plan=JSON.parse(fs.readFileSync(join(out,'probe-plan.json'))),head='53f913804b1bcd91c88decd0870b26a796d1f32b';
const raw=execFileSync('git',['show',head+':scripts/stage-w1e-contract.mjs']),legacy=join(out,'legacy-contract.mjs.txt');fs.writeFileSync(legacy,raw,{flag:'wx'});
const executable=join(out,'legacy-contract-executable.mjs');fs.writeFileSync(executable,raw.toString().replace("'./stage-w1b-preflight.mjs'",JSON.stringify(pathToFileURL(resolve('scripts/stage-w1b-preflight.mjs')).href)),{flag:'wx'});
const old=await import(pathToFileURL(executable).href),results=[];
for(let i=0;i<2;i++){
 const s=JSON.parse(gunzipSync(fs.readFileSync(join(out,'probe',`${i}-S2.json.gz`))));
 const input={actor:actor(),targets:plan.targets.map(t=>({head:t.head,root:t.dir,physical:physical(t.dir).replaceAll('\\','/'),dependencyPhysical:physical(join(t.dir,'node_modules')).replaceAll('\\','/')})),bindings:{settings:s.settings},outputExists:false};
 // Each target's settings are validated with that snapshot in the first position.
 if(i)input.targets.reverse();
 let reason;try{old.identity(input,input);}catch(e){reason=e.message;}assert.equal(reason,'SETTINGS');assert.equal(identity(input,input).status,'PASS');results.push({scope:'same Windows resolved settings and same physical inputs',input,red:reason,green:'PASS',comparisonSpawns:0});
}
fs.writeFileSync(join(out,'cache-real-red-green.json'),JSON.stringify({baselineHead:head,baselineGitBlob:execFileSync('git',['rev-parse',head+':scripts/stage-w1e-contract.mjs']).toString().trim(),baselineRawSha256:hash(raw),executionCopy:'only dependency import URL substituted; original bytes retained separately',results},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PASS',windowsInputs:2,red:'SETTINGS',green:'PASS',scope:'cache configuration only'}));
