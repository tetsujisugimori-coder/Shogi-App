import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { hash, read, digest, tree } from './stage-w1b-preflight.mjs';
const out=resolve(process.argv[2]),probe=join(out,'probe'),plan=read(join(out,'limited-plan.json'));
const write=(p,o)=>writeFileSync(p,JSON.stringify(o,null,2)+'\n',{flag:'wx'});
const state=(i,s)=>JSON.parse(gunzipSync(readFileSync(join(probe,`${i}-${s}.json.gz`))));
const diff=(a,b)=>{const left=new Map(a.map(e=>[e.path,e])),right=new Map(b.map(e=>[e.path,e]));return [...new Set([...left.keys(),...right.keys()])].filter(p=>digest(left.get(p)??null)!==digest(right.get(p)??null)).map(p=>({path:p,before:left.get(p)??null,after:right.get(p)??null}));};
const states=['S1-before-config','S2-config-loaded','S3-inventory-collected','post-close'];
const rows=[];
for(let i=0;i<2;i++) {
 const label=i?'new':'old',s=states.map(n=>state(i,n)),s0=read(join(out,'build',`${label}-dependency-manifest.json`));
 const S0={stage:'S0-npm-ci-complete',target:plan.targets[i],install:read(join(out,'build',`${label}-install.json`)),observation:read(join(out,'build',`${label}-post-install.json`)),dependencies:s0,scope:'Source/dependencies immediately after npm ci; installation cache/TEMP recorded by hash. Execution trees first fully inventoried at S1.'};
 const s0Path=join(probe,`${i}-S0.json.gz`);
 if(existsSync(s0Path)){if(digest(JSON.parse(gunzipSync(readFileSync(s0Path))))!==digest(S0))throw Error('S0 record changed');}
 else writeFileSync(s0Path,gzipSync(JSON.stringify(S0)),{flag:'wx'});
 rows.push({target:label,S0toS1:diff(s0,s[0].dependencies),transitions:s.slice(1).map((v,j)=>({from:states[j],to:states[j+1],dependencies:diff(s[j].dependencies,v.dependencies),sourceUnchanged:s[j].observation.sourceSha256===v.observation.sourceSha256,executionEnvironmentUnchanged:digest(s[j].environment)===digest(v.environment),installationEnvironmentUnchanged:digest(s[j].installEnvironment)===digest(v.installEnvironment)})),settings:s[1].settings,inventory:read(join(probe,`${i}-inventory.json`)),transient:read(join(probe,`${i}-transient-config.json`)).map(({base64,...e})=>e)});
}
const normalize=(value,root)=>typeof value==='string'?value.replaceAll('\\','/').replaceAll(root.replaceAll('\\','/'),'<snapshot>'):Array.isArray(value)?value.map(v=>normalize(v,root)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalize(v,root)])):value;
const canonical=rows.map((r,i)=>({settings:normalize(r.settings,plan.targets[i].dir),inventory:normalize(r.inventory,plan.targets[i].dir)}));
write(join(out,'state-analysis.json'),{rows,settingsEqual:digest(canonical[0].settings)===digest(canonical[1].settings),inventoryEqual:digest(canonical[0].inventory)===digest(canonical[1].inventory),canonical,policy:{runtimeExclusions:[],status:'NOT_ESTABLISHED',candidate:'Load config in a separate preparatory observation, then seal the complete resulting dependency tree including .vite-temp. No blanket ignore.',blocking:'Vitest writes version/results/duration/failed to results.json on runFiles. Neither asymmetric outputs nor timing-dependent cache transitions have a validated allowance. No comparison launch authorized.'},S4:'NOT_TESTED',S5:'NOT_TESTED',comparisonSpawns:{old:0,new:0}});
// Pin the actual installed implementation bytes supporting the observations.
const impl=join(out,'implementation');mkdirSync(impl);
for(const [key,file,pattern] of [['vite','node_modules/vite/dist/node/chunks/dep-Dm0c1Wj2.js','async function loadConfigFromBundledFile'],['vitest-cache','node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js','async writeToCache()'],['vitest-run','node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js','async runFiles(specs, allTestsRun)']]){
 const p=join(plan.targets[0].dir,file),bytes=readFileSync(p),lines=bytes.toString().split('\n'),start=lines.findIndex(l=>l.includes(pattern));if(start<0)throw Error('implementation not found');
 write(join(impl,key+'.json'),{path:p,sha256:hash(bytes),startLine:start+1,excerpt:lines.slice(start,start+(key==='vite'?45:key==='vitest-cache'?18:45)).join('\n')});
}
console.log(JSON.stringify({settingsEqual:digest(canonical[0].settings)===digest(canonical[1].settings),inventoryEqual:digest(canonical[0].inventory)===digest(canonical[1].inventory),comparisonSpawns:0}));
