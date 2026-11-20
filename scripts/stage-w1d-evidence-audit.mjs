import { readFileSync, writeFileSync, readdirSync, lstatSync, readlinkSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { hash, read, tree, digest } from './stage-w1b-preflight.mjs';
const [mode,outArg,extra]=process.argv.slice(2),out=resolve(outArg);
const write=(p,o)=>writeFileSync(p,JSON.stringify(o,null,2)+'\n',{flag:'wx'});
if(mode==='pack') {
 const root=resolve(extra),files=[];
 function walk(d=root){for(const n of readdirSync(d).sort()){if(n==='.git')continue;const p=join(d,n),s=lstatSync(p),path=relative(root,p).replaceAll('\\','/');if(s.isSymbolicLink())files.push({path,type:'link',target:readlinkSync(p)});else if(s.isDirectory()){files.push({path,type:'directory'});walk(p);}else{const b=readFileSync(p);files.push({path,type:'file',sha256:hash(b),base64:b.toString('base64')});}}}
 walk();const name=root.split(/[\\/]/).at(-1);writeFileSync(join(out,name+'.json.gz'),gzipSync(JSON.stringify({root,scope:'Retained fixture bytes, excluding reproducible .git metadata; links recorded without traversal.',files})),{flag:'wx'});
} else if(mode==='seal') {
 const entries=tree(out).filter(e=>e.type==='file'&&!['evidence-manifest.json','evidence-readback.json'].includes(e.path));
 write(join(out,'evidence-manifest.json'),{algorithm:'SHA-256 raw bytes',entries});
 let gzipFiles=0,archivedFiles=0;
 for(const e of entries){assert.equal(hash(readFileSync(join(out,e.path))),e.sha256);if(e.path.endsWith('.gz')){gzipFiles++;const v=JSON.parse(gunzipSync(readFileSync(join(out,e.path))));const files=Array.isArray(v)?v:v.files??[];for(const f of files)if(f.base64!==undefined){assert.equal(hash(Buffer.from(f.base64,'base64')),f.sha256);archivedFiles++;}}}
 write(join(out,'evidence-readback.json'),{at:new Date().toISOString(),source:'independent filesystem read after manifest serialization',files:entries.length,gzipFiles,archivedFiles,mismatches:0,manifestSha256:hash(readFileSync(join(out,'evidence-manifest.json')))});
 console.log(JSON.stringify({files:entries.length,gzipFiles,archivedFiles,mismatches:0}));
} else if(mode==='git') {
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),treeSha=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),prefix=relative(process.cwd(),out).replaceAll('\\','/'),manifest=JSON.parse(execFileSync('git',['show',`${head}:${prefix}/evidence-manifest.json`],{maxBuffer:64*1024*1024}));
 let gz=0,archiveFiles=0;
 for(const e of manifest.entries){const b=execFileSync('git',['show',`${head}:${prefix}/${e.path}`],{maxBuffer:64*1024*1024});assert.equal(hash(b),e.sha256,e.path);if(e.path.endsWith('.gz')){gz++;const v=JSON.parse(gunzipSync(b));for(const f of Array.isArray(v)?v:v.files??[])if(f.base64!==undefined){assert.equal(hash(Buffer.from(f.base64,'base64')),f.sha256);archiveFiles++;}}}
 const red=JSON.parse(execFileSync('git',['show',`${head}:${prefix}/offline/red-outcomes.json`],{maxBuffer:64*1024*1024})),green=JSON.parse(execFileSync('git',['show',`${head}:${prefix}/offline/final-outcomes.json`],{maxBuffer:64*1024*1024}));
 for(const r of red){const g=green.find(x=>x.name===r.name);assert.ok(g);assert.equal(g.result.status,r.name==='normal'?'PASS':'INVALID');assert.equal(g.newComparisonSpawns,0);
   const load=phase=>JSON.parse(gunzipSync(execFileSync('git',['show',`${head}:${prefix}/offline/${phase}-${r.name}.json.gz`],{maxBuffer:64*1024*1024})));
   assert.deepEqual(load('red').inputs,load('final').inputs,`same input RED/GREEN: ${r.name}`);
 }
 const report={at:new Date().toISOString(),head,tree:treeSha,readFrom:'git show HEAD:path binary buffers',files:manifest.entries.length,gzipFiles:gz,archivedFiles:archiveFiles,mismatches:0,redFalseAccepts:red.filter(x=>x.classification==='RED_FALSE_ACCEPT').length,existingProtections:red.filter(x=>x.classification==='EXISTING_PROTECTION').length,greenRejected:green.filter(x=>x.result.status==='INVALID').length};
 write(resolve(extra),report);console.log(JSON.stringify(report));
}
