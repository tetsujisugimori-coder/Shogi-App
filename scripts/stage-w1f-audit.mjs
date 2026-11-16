import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {hash,digest,inspect,physical} from './stage-w1b-preflight.mjs';
import {cacheIdentity,cachePair} from './stage-w1f-cache.mjs';
import {analyzeEvents} from './stage-w1f-events.mjs';
const out=resolve(process.argv[2]),read=p=>JSON.parse(fs.readFileSync(p)),plan=read(join(out,'probe-plan.json'));
const suffix=process.argv[3]??'';
const write=(p,v)=>fs.writeFileSync(join(out,p.replace('.json',suffix+'.json')),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const norm=(v,root)=>typeof v==='string'?v.replaceAll('\\','/').replaceAll(root.replaceAll('\\','/'),'<snapshot>'):Array.isArray(v)?v.map(x=>norm(x,root)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,norm(x,root)])):v;
const targets=[];
const configs=[];
for(let i=0;i<2;i++){
 const t=plan.targets[i],load=s=>JSON.parse(gunzipSync(fs.readFileSync(join(out,'probe',`${i}-${s}.json.gz`)))),states=['S1','S2','S3','close'].map(load),raw=fs.readFileSync(join(out,'probe',`${i}-raw-events.jsonl`)),events=raw.toString().trim().split('\n').filter(Boolean).map(JSON.parse),cli=read(join(out,'probe',`${i}-cli.json`));
 const expected={runId:plan.runId,trialId:plan.trialId,head:t.head,preSeal:plan.preSeals[i],pid:states[0].pid,started:states[0].at,finished:events.at(-1)?.wall};
 // Instrumentation begins before S1; use the parent's recorded invocation window.
 const parent=read(join(out,'probe-cli','result.json'));expected.started=parent.started;expected.finished=parent.finished;
 const eventAnalysis=analyzeEvents(events,expected);write(`${i}-event-analysis.json`,eventAnalysis);
 const cache=cacheIdentity(states[1].settings,t.dir),post=inspect(t.repo,t.dir,t.head),pre=read(join(out,'build-retry',`${i?'new':'old'}-post-install.json`));
 configs.push(norm(states[1].fullConfig,t.dir));
 const cacheStages=states.map(s=>({stage:s.stage,entries:s.trees.dependencies.entries.filter(e=>e.absolute.startsWith(cache.absolute)).map(({absolute,type,sha256,size})=>({absolute,type,sha256,size}))}));
 targets.push({head:t.head,root:t.dir,physical:physical(t.dir),pid:expected.pid,cache,settings:states[1].settings,settingsNormalized:norm(states[1].settings,t.dir),sourceUnchanged:post.sourceSha256===pre.sourceSha256,lock:post.lockSha256,dependenciesBefore:pre.dependenciesSha256,dependenciesAfter:post.dependenciesSha256,vitest:post.vitest,inventory:read(join(out,'probe',`${i}-inventory.json`)),fullConfigHash:digest(states[1].fullConfig),fullConfigNormalizedHash:digest(norm(states[1].fullConfig,t.dir)),cacheStages,rawEventsSha256:hash(raw),eventAnalysis,cliExit:cli.exitCode,cleanup:read(join(out,'probe',`${i}-events.json`)),instrumentationLimits:'native, workers and other processes UNKNOWN; no uninstrumented timing baseline'});
}
const configCachePair=cachePair(...targets.map(t=>t.cache));
const differences=[];
function diff(a,b,path){if(digest([a])===digest([b]))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[k],b[k],path+'.'+k);}else differences.push({path,old:a,new:b});}
diff(...configs,'config');write('config-diff.json',{status:'UNKNOWN',rule:'only snapshot prefix normalized; no difference is permitted by this diagnostic',differences});
const checks={cacheConfiguration:configCachePair,settingsEqual:digest(targets[0].settingsNormalized)===digest(targets[1].settingsNormalized),normalizedFullConfigEqual:targets[0].fullConfigNormalizedHash===targets[1].fullConfigNormalizedHash,source:targets.every(t=>t.sourceUnchanged),lock:targets[0].lock===targets[1].lock,initialDependencies:targets[0].dependenciesBefore===targets[1].dependenciesBefore,inventoryEqual:digest(norm(targets[0].inventory,targets[0].root))===digest(norm(targets[1].inventory,targets[1].root)),unusedOutput:!fs.existsSync(join(out,'real-comparison'))};
write('observation-analysis.json',{targets,checks,fullConfigEquivalence:'UNKNOWN: serialization cannot establish closure/native equivalence',cacheSemantics:'NOT_ESTABLISHED: failure/duration changes can change scheduler order'});
write('gate.json',{status:'NOT_READY',outcome:'B',comparison:'NOT_TESTED',comparisonSpawns:{old:0,new:0},S4:'NOT_TESTED',S5:'NOT_TESTED',checks,blocking:['exclusive writer and native lifecycle UNKNOWN','complete effective config equivalence UNKNOWN','result cache semantic safety NOT_ESTABLISHED','real admission independent review not established'],R8:'UNKNOWN',H1:'UNKNOWN',H2:'UNKNOWN',H3:'UNKNOWN',H4:'UNKNOWN',merge:'NO',draft:true,scope:'no real comparison spawn API; OS-wide process absence not asserted'});
console.log(JSON.stringify({checks,eventCounts:targets.map(t=>t.eventAnalysis.events),renameChains:targets.map(t=>t.eventAnalysis.renames.filter(r=>r.observedChain).length),comparisonSpawns:0}));
