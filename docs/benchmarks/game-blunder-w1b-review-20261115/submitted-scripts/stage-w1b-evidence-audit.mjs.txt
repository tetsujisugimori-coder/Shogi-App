import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { hash, read, tree, digest } from './stage-w1b-preflight.mjs';
const evidence=resolve(process.argv[2]);
const before=read(join(evidence,'protected-before.json'));
const after=before.map(x=>({path:x.path,sha256:hash(readFileSync(x.path))}));
writeFileSync(join(evidence,'protected-after.json'),JSON.stringify(after,null,2)+'\n');
const prior=read('docs/benchmarks/game-blunder-windows-stage-w1b-20261112/protected-before.json');
const oldRoot='docs/benchmarks/game-blunder-windows-stage-w1-20261112',manifest=read(join(oldRoot,'evidence-manifest.json'));
const rawMismatch=manifest.files.filter(x=>hash(readFileSync(join(oldRoot,x.path)))!==x.sha256);
const canonicalScriptMismatch=manifest.scripts.filter(x=>hash(readFileSync(x.path,'utf8').replaceAll('\r\n','\n'))!==x.sha256);
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',maxBuffer:64*1024*1024}).trim();
const snapshots=[];
for(const [label,head] of Object.entries(manifest.sourceHeads)) {
  const dir=resolve('../stage-w1-snapshots',label);
  const entries=git('ls-tree','-r','-z',head).split('\0').filter(Boolean).map(s=>{const m=/^\d+ blob (\w+)\t([\s\S]+)$/.exec(s);return {oid:m[1],path:m[2]};});
  const batch=spawnSync('git',['cat-file','--batch'],{input:entries.map(e=>e.oid).join('\n')+'\n',maxBuffer:256*1024*1024});
  if(batch.status!==0)throw Error('git batch failed');
  let offset=0;const mismatches=[];
  for(const e of entries) {
    const end=batch.stdout.indexOf(10,offset),size=Number(batch.stdout.subarray(offset,end).toString().split(' ')[2]);
    const expected=batch.stdout.subarray(end+1,end+1+size);offset=end+size+2;
    const path=join(dir,e.path);
    if(!existsSync(path)){mismatches.push({path:e.path,reason:'missing'});continue;}
    const actual=readFileSync(path);
    if(!actual.equals(expected)) {
      const canon=b=>b.toString('utf8').replaceAll('\r\n','\n');
      mismatches.push({path:e.path,reason:canon(actual)===canon(expected)?'CRLF-only checkout conversion':'OTHER_OR_MIXED',expectedSha256:hash(expected),actualSha256:hash(actual),actualCRLF:(actual.toString().match(/\r\n/g)??[]).length,expectedCRLF:(expected.toString().match(/\r\n/g)??[]).length});
    }
  }
  const tracked=new Set(entries.map(e=>e.path)),extras=[];
  const walk=(d=dir,rel='')=>{for(const e of readdirSync(d,{withFileTypes:true})){const r=rel+e.name,p=join(d,e.name);if(r==='node_modules')continue;if(e.isDirectory())walk(p,r+'/');else if(!tracked.has(r))extras.push(r);}};walk();
  const deps=tree(join(dir,'node_modules'));
  snapshots.push({label,head,dir,tracked:entries.length,mismatches,extras,dependencyCount:deps.length,dependenciesSha256:digest(deps)});
}
const report={at:new Date().toISOString(),protectedCount:after.length,originalFiles:after.filter(x=>x.path.startsWith(oldRoot+'/')).length,oldScripts:5,beforeAfterMismatches:after.filter((x,i)=>x.sha256!==before[i].sha256),previous103ManifestMismatches:after.filter((x,i)=>x.path!==prior[i].path||x.sha256!==prior[i].sha256),originalManifest:{rawFiles:manifest.files.length,rawMismatch,canonicalScripts:manifest.scripts.length,canonicalScriptMismatch,note:'Original manifest excludes itself and explicitly normalizes only the five script entries. This audit also compares all 103 raw bytes without normalization.'},snapshots,note:'CRLF classification is attribution only. Runner still rejects all raw blob differences. core.autocrlf=true is system Git configuration; snapshots also contain collection leftovers. No original snapshot was repaired.'};
writeFileSync(join(evidence,'preservation-and-snapshot-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({protected:report.protectedCount,beforeAfterMismatches:report.beforeAfterMismatches.length,previous103Mismatches:report.previous103ManifestMismatches.length,originalManifestMismatches:rawMismatch.length+canonicalScriptMismatch.length,snapshots:snapshots.map(s=>({label:s.label,mismatches:s.mismatches.length,other:s.mismatches.filter(x=>x.reason!=='CRLF-only checkout conversion').length,extras:s.extras.length,dependencies:s.dependencyCount}))}));
