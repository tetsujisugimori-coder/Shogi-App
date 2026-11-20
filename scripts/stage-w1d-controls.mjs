// Retained derivatives only; never writes into the supplied normal recording.
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { hash, read, tree } from './stage-w1b-preflight.mjs';
const runner=fileURLToPath(new URL('./stage-w1b-runner.mjs',import.meta.url));
const write=(p,o)=>writeFileSync(p,JSON.stringify(o,null,2)+'\n');
export const mutations=[
  ...[
    ['status',a=>a.status='FAIL'],['counts',a=>a.counts.passed--],
    ['tests',a=>a.tests[0].status='failed'],['invalid',a=>a.invalid.push('contradiction')],
    ['incomplete',a=>a.incomplete.push('missing')],['failures',a=>a.failures.push({kind:'test',name:'same'})],
    ['plausible',a=>{a.counts.passed--;a.counts.failed++;a.tests[0].status='failed';a.status='FAIL';}],
  ].map(([n,f])=>['assessment-'+n,p=>{const a=read(join(p,'trial-0/assessment.json'));f(a.assessment);write(join(p,'trial-0/assessment.json'),a);}]),
  ['exit-disagreement',p=>{const a=read(join(p,'trial-0/assessment.json'));a.exitCode=1;write(join(p,'trial-0/assessment.json'),a);} ],
  ...['mode','filters','preflightSha256','inventorySha256','target','runId','trialId','command','output','environment','observation','dir','isolationPlan','environmentTrees','expectedSettings'].flatMap(field=>[false,true].map(rehash=>[
    `request-${field}-${rehash?'rehash':'only'}`,p=>{
      const path=join(p,'trial-0/request.json'),q=read(path);
      q[field]=field==='mode'?'collect':field==='filters'?['different.test.ts']:field==='command'?['createVitest','test','different']:typeof q[field]==='string'?'changed-'+q[field]:{changed:true};write(path,q);
      if(rehash){const a=read(join(p,'trial-0/assessment.json'));a.bindings['request.json']=hash(readFileSync(path));write(join(p,'trial-0/assessment.json'),a);}
    }
  ])),
  ['collect-request-rehash',p=>{const path=join(p,'collect-0/request.json'),q=read(path);q.filters=['changed'];write(path,q);} ],
];
const starts=p=>readdirSync(p).filter(f=>f.startsWith('event-')).map(f=>read(join(p,f))).filter(e=>e.action==='spawn'&&e.phase==='run').length;
export function cli(dir) {
  const before=starts(dir),r=spawnSync(process.execPath,[runner,'verify',dir],{encoding:'utf8'});
  return {command:[process.execPath,runner,'verify',dir],stdout:r.stdout,stderr:r.stderr,exitCode:r.status,signal:r.signal,error:r.error?.message??null,result:JSON.parse(r.stdout),newComparisonSpawns:starts(dir)-before};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [phase,normalArg,rootArg,evidenceArg]=process.argv.slice(2),normal=resolve(normalArg),root=resolve(rootArg),evidence=resolve(evidenceArg);
  mkdirSync(evidence,{recursive:true});
  if(phase==='red') {
    mkdirSync(root);cpSync(normal,join(root,'normal'),{recursive:true,errorOnExist:true,force:false});
    for(const [name,mutate] of mutations){const dir=join(root,name);cpSync(normal,dir,{recursive:true,errorOnExist:true,force:false});mutate(dir);}
  }
  const outcomes=[];
  for(const name of ['normal',...mutations.map(([n])=>n)]) {
    const dir=join(root,name),inputs=tree(dir),r=cli(dir);
    const row={name,expected:name==='normal'?'PASS / exit 0':'INVALID / exit 1',classification:phase==='red'&&name!=='normal'?(r.result.status==='PASS'?'RED_FALSE_ACCEPT':'EXISTING_PROTECTION'):phase,...r,inputs};
    outcomes.push(row);
    writeFileSync(join(evidence,`${phase}-${name}.json.gz`),gzipSync(JSON.stringify(row)));
    if(phase==='red') {
      // Exact retained inputs, compressed to avoid committing repeated large JSON.
      writeFileSync(join(evidence,`input-${name}.json.gz`),gzipSync(JSON.stringify(inputs.map(e=>e.type==='file'?{...e,base64:readFileSync(join(dir,e.path)).toString('base64')}:e))));
    }
    if(phase!=='red'){assert.equal(r.result.status,name==='normal'?'PASS':'INVALID',name);assert.equal(r.exitCode,name==='normal'?0:1,name);}
    assert.equal(r.newComparisonSpawns,0);
  }
  write(join(evidence,phase+'-outcomes.json'),outcomes.map(({inputs,...r})=>r));
  console.log(JSON.stringify(outcomes.map(({name,classification,result,exitCode})=>({name,classification,status:result.status,exitCode}))));
}
