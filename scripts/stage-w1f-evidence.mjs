import fs from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {hash,tree} from './stage-w1b-preflight.mjs';
const [mode,outArg,destination]=process.argv.slice(2),out=resolve(outArg),write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
if(mode==='archive'){
 for(let i=0;i<2;i++){const p=join(out,'probe',`${i}-raw-events.jsonl`),b=fs.readFileSync(p),gz=gzipSync(b);fs.writeFileSync(p+'.gz',gz,{flag:'wx'});assert.deepEqual(gunzipSync(gz),b);}
 const code=fs.readdirSync('scripts').filter(n=>/^stage-w1f-/.test(n)||n==='stage-w1e-contract.mjs').map(n=>({path:'scripts/'+n,sha256:hash(fs.readFileSync('scripts/'+n))}));write(join(out,'implementation-source.json'),{scope:'post-observation source readback; not a pre-run authenticated source seal',files:code});
}else{
 const git=(...args)=>execFileSync('git',args,{maxBuffer:256*1024*1024}),head=git('rev-parse','HEAD').toString().trim(),prefix=relative(process.cwd(),out).replaceAll('\\','/'),get=p=>mode==='git'?git('show',`${head}:${prefix}/${p}`):fs.readFileSync(join(out,p));
 const manifest='evidence-manifest-final.json',readback='evidence-readback-final.json';
 const entries=mode==='seal-final'?tree(out).filter(e=>e.type==='file'&&!e.path.endsWith('.jsonl')&&![manifest,readback].includes(e.path)):JSON.parse(get(manifest)).entries;
 if(mode==='seal-final')write(join(out,manifest),{algorithm:'SHA-256 raw bytes; raw JSONL represented by lossless gzip',entries});
 let bodies=0;function bodyCheck(v){if(!v||typeof v!=='object')return;if(typeof v.base64==='string'&&v.sha256){assert.equal(hash(Buffer.from(v.base64,'base64')),v.sha256);bodies++;}for(const x of Object.values(v))if(typeof x==='object')bodyCheck(x);}
 const opaqueJson=[];
 for(const e of entries){const b=get(e.path);assert.equal(hash(b),e.sha256,e.path);if(e.path.endsWith('.jsonl.gz'))for(const line of gunzipSync(b).toString().trim().split('\n'))bodyCheck(JSON.parse(line));else if(e.path.endsWith('.gz'))bodyCheck(JSON.parse(gunzipSync(b)));else if(e.path.endsWith('.json')){let v;try{v=JSON.parse(b);}catch(error){if(!(error instanceof SyntaxError))throw error;opaqueJson.push({path:e.path,reason:'raw retained malformed JSON fixture; integrity only, not JSON validity'});continue;}bodyCheck(v);}}
 const result={head,tree:git('rev-parse','HEAD^{tree}').toString().trim(),method:mode==='git'?'binary Git blob readback in independent process':'filesystem readback in independent process',files:entries.length,bodies,mismatches:0,opaqueJson,manifestSha256:hash(get(manifest)),limits:'byte integrity is not historical execution authenticity'};
 write(mode==='git'?resolve(destination):join(out,readback),result);console.log(JSON.stringify(result));
}
