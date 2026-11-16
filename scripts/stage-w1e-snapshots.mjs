// Fresh raw Git-blob export. No checkout filters, archive attributes, or old snapshot copies.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { hash, digest, read, tree, inspect, requirePair } from './stage-w1b-preflight.mjs';
import {saveState} from './stage-w1e-observation.mjs';
const [rootArg,outArg]=process.argv.slice(2),root=resolve(rootArg),out=resolve(outArg),repo=process.cwd();
mkdirSync(root);mkdirSync(out);
const write=(p,o)=>writeFileSync(p,JSON.stringify(o,null,2)+'\n',{flag:'wx'});
const protectedPaths=read('docs/benchmarks/game-blunder-w1b-review-20261115/protected-before.json');
write(join(out,'protected-before.json'),protectedPaths.map(x=>({path:x.path,sha256:hash(readFileSync(x.path))})));
const oldSnapshots=['old','new'].map(label=>({label,entries:tree(resolve('../stage-w1-snapshots',label))}));
write(join(out,'old-snapshots-before.json'),oldSnapshots.map(x=>({label:x.label,entries:x.entries.length,sha256:digest(x.entries)})));
const heads={old:'e1ccb1a2412e7faa86c2c1f60fdad1dca154023a',new:'2a8a57b6ff207831c77ce62d27d3151eba7c1dc3'},targets=[];
const npm=process.env.W1C_NPM_CLI??join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
if(process.version!=='v24.20.0'||execFileSync(process.execPath,[npm,'--version'],{encoding:'utf8'}).trim()!=='11.17.0')throw Error('W1c Windows build requires Node v24.20.0 / npm 11.17.0; supply W1C_NPM_CLI');
for(const [label,head] of Object.entries(heads)) {
  const dir=join(root,label);mkdirSync(dir);
  const entries=execFileSync('git',['ls-tree','-r','-z',head],{encoding:'utf8',maxBuffer:64*1024*1024}).split('\0').filter(Boolean).map(line=>{
    const m=/^100(?:644|755) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(line);if(!m)throw Error('unsupported source type');return {oid:m[1],path:m[2]};
  });
  const batch=spawnSync('git',['cat-file','--batch'],{input:entries.map(e=>e.oid).join('\n')+'\n',maxBuffer:256*1024*1024});
  if(batch.status!==0)throw Error('Git blob export failed');
  let offset=0;const manifest=[];
  for(const e of entries) {
    const end=batch.stdout.indexOf(10,offset),header=batch.stdout.subarray(offset,end).toString().split(' '),size=Number(header[2]);
    if(header[0]!==e.oid||header[1]!=='blob'||!Number.isSafeInteger(size))throw Error('invalid Git batch response');
    const b=batch.stdout.subarray(end+1,end+1+size);offset=end+size+2;
    const p=join(dir,e.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,b,{flag:'wx'});
    manifest.push({...e,sha256:hash(b)});
  }
  const actual=tree(dir),files=actual.filter(e=>e.type==='file');
  if(files.length!==manifest.length||manifest.some(e=>hash(readFileSync(join(dir,e.path)))!==e.sha256))throw Error('export mismatch');
  write(join(out,`${label}-source-manifest.json`),{head,method:'git cat-file --batch binary buffers',files:manifest,sha256:digest(manifest),inventory:actual});
  const cache=join(root,`${label}-install-cache`),temp=join(root,`${label}-install-temp`);mkdirSync(cache);mkdirSync(temp);
  const args=['--use-system-ca',npm,'ci','--cache',cache,'--no-audit','--no-fund','--fetch-retries=0','--fetch-timeout=30000'];
  const started=new Date().toISOString(),r=spawnSync(process.execPath,args,{cwd:dir,env:{...process.env,TEMP:temp,TMP:temp},encoding:'utf8',maxBuffer:64*1024*1024});
  writeFileSync(join(out,`${label}-install-stdout.txt`),r.stdout??'',{flag:'wx'});writeFileSync(join(out,`${label}-install-stderr.txt`),r.stderr??'',{flag:'wx'});
  write(join(out,`${label}-install.json`),{head,started,finished:new Date().toISOString(),command:[process.execPath,...args],exitCode:r.status,error:r.error?.message??null,node:process.version,npm:execFileSync(process.execPath,[npm,'--version'],{encoding:'utf8'}).trim(),cache,temp,cacheSha256:digest(tree(cache)),tempSha256:digest(tree(temp))});
  if(r.status!==0)throw Error(`npm ci failed for ${label}`);
  const observed=inspect(repo,dir,head);saveState(out,label+'-S0',{dependencies:join(dir,'node_modules'),temp,cache},{target:{repo,dir,head},observation:observed,scope:'post npm-ci; source inspection precedes this endpoint inventory'});write(join(out,`${label}-post-install.json`),observed);
  write(join(out,`${label}-dependency-manifest.json`),tree(join(dir,'node_modules')));
  targets.push({repo,dir,head});
}
const observations=targets.map(t=>inspect(repo,t.dir,t.head));
let equality;try{requirePair(observations);equality={status:'PASS'};}catch(e){equality={status:'UNKNOWN',reason:String(e)};}
write(join(out,'snapshot-comparison.json'),{equality,observations:observations.map(({source,...o})=>o)});
const temp=join(root,'execution-temp'),cache=join(root,'execution-npm-cache');mkdirSync(temp);mkdirSync(cache);
write(join(out,'limited-plan.json'),{targets,filters:['src/test/game-blunder-pilot.test.ts'],expected:{pool:'forks',maxWorkers:2,testTimeout:5000,cache:true},environment:{TEMP:temp,TMP:temp,npm_config_cache:cache}});
console.log(JSON.stringify({root,out,equality,sourceCounts:observations.map(o=>o.source.length)}));
