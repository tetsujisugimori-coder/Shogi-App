import fs from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {tree,hash,read} from './stage-w1b-preflight.mjs';
const [mode,arg,destination]=process.argv.slice(2),root=resolve(arg),prefix=relative(process.cwd(),root).replaceAll('\\','/');
let bodies=0;
function verify(v){if(!v||typeof v!=='object')return;if(typeof v.base64==='string'){assert.equal(hash(Buffer.from(v.base64,'base64')),v.sha256);bodies++;}for(const e of Object.values(v))if(typeof e==='object')verify(e);}
const git=(...args)=>execFileSync('git',args,{maxBuffer:256*1024*1024});
const head=git('rev-parse','HEAD').toString().trim(),get=p=>mode==='git'?git('show',`${head}:${prefix}/${p}`):fs.readFileSync(join(root,p));
const entries=mode==='git'?JSON.parse(get('evidence-manifest.json')).entries:tree(root).filter(e=>e.type==='file'&&!['evidence-manifest.json','evidence-readback.json'].includes(e.path));
if(mode==='seal')fs.writeFileSync(join(root,'evidence-manifest.json'),JSON.stringify({algorithm:'SHA-256 raw bytes',entries},null,2)+'\n',{flag:'wx'});
for(const e of entries){const b=get(e.path);assert.equal(hash(b),e.sha256,e.path);if(e.path.endsWith('.gz'))verify(JSON.parse(gunzipSync(b)));else if(e.path.endsWith('.json'))verify(JSON.parse(b));}
const result={at:new Date().toISOString(),method:mode==='git'?'binary git show committed blobs':'filesystem raw readback',head,tree:git('rev-parse','HEAD^{tree}').toString().trim(),files:entries.length,bodies,mismatches:0,manifestSha256:hash(get('evidence-manifest.json'))};
fs.writeFileSync(mode==='git'?resolve(destination):join(root,'evidence-readback.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
