/** Review-only before/after A/B/C runner. Reuses PR212's frozen ten positions
 * and engine APIs; never writes the original measurement directory. */
import assert from 'node:assert/strict';
import {fork,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,statSync,mkdirSync,openSync,writeSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import {cpus,release} from 'node:os';
import * as after from '../src/domain/shogi/twoPlyAlphaBetaAi';
import {SearchDiagnostics} from '../src/domain/shogi/searchDiagnostics';
import {getLegalActions,executeLegalAction} from '../src/domain/shogi/legalActions';
import {evaluateSearchPositionBreakdown} from '../src/domain/shogi/twoPlyMinimaxAi';
import type {BoardState} from '../src/types/shogi';
const BASE='1b45ad1cab7a493223495b911fab944985456a2f';
const [mode,pathArg]=process.argv.slice(2),dir=resolve(pathArg??'.');
const hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const json=(v:unknown)=>JSON.stringify(v,(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v);
const parse=(s:string)=>JSON.parse(s,(_k,v)=>v==='Infinity'?Infinity:v==='-Infinity'?-Infinity:v);
const read=(f:string)=>parse(readFileSync(resolve(dir,f),'utf8'));
const sources=['src/domain/shogi/quiescenceSearch.ts','src/domain/shogi/quietPromotionSelection.ts','src/domain/shogi/twoPlyAlphaBetaAi.ts','src/test/shogi-selective-review.test.ts','src/test/fixtures/selective-review-before.json','scripts/measure-selective-review.ts'];
const options=(v:string):after.AlphaBetaSearchOptions=>({moveOrdering:'standard',useTranspositionTable:false,usePreviousIterationPv:false,killerMoves:false,quiescence:{maxTacticalDepth:1,moveOrdering:'original',maxCheckEvasionExtensions:0,...(v==='A'?{includeQuietPromotions:false}:v==='B'?{includeQuietPromotions:true}:{selectiveQuietPromotions:{maxCandidates:1}})}});
function auditPv(state:BoardState,result:ReturnType<typeof after.analyzeAlphaBetaSearch>|ReturnType<typeof after.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch>){
 assert.ok(getLegalActions(state).some(a=>json(a)===json(result.selectedAction)));let leaf=state;
 for(const a of result.principalVariation){assert.ok(getLegalActions(leaf).some(x=>json(x)===json(a)));const e=executeLegalAction(leaf,a);assert.equal(e.type,'applied');if(e.type==='applied')leaf=e.state;}
 if(result.evaluationBreakdown)assert.deepEqual(result.evaluationBreakdown,evaluateSearchPositionBreakdown(leaf,state.turn));
}
if(mode==='prepare'){
 mkdirSync(dir,{recursive:false});
 const original='docs/benchmarks/selective-promotions-20261024/';
 const protectedFiles=execFileSync('git',['ls-files',original],{encoding:'utf8'}).trim().split('\n');
 const originalHashes=Object.fromEntries(protectedFiles.map(p=>[p,hash(readFileSync(p))]));
 const oldPlan=parse(readFileSync(original+'run2/plan.json','utf8'));
 const archive=execFileSync('git',['archive',BASE,'src'],{maxBuffer:20*1024*1024});writeFileSync(resolve(dir,'before-src.tar.gz'),gzipSync(archive));
 const sourceHashes=Object.fromEntries(sources.map(f=>{const b=readFileSync(f);writeFileSync(resolve(dir,f.replaceAll('/','__')+'.gz'),gzipSync(b));return[f,hash(b)];}));
 const plan={baseline:BASE,sourceHashes,archiveHash:hash(archive),originalHashes,positions:oldPlan.performance,
  conditions:[{limit:null,depth:1,repeats:1},{limit:null,depth:4,repeats:1},{limit:100,depth:4,repeats:3},{limit:1000,depth:4,repeats:3}],
  warmups:1,variants:['A','B','C'],versions:['before','after'],globalMs:900000,taskMs:30000,maxBytes:40*1024*1024,reserve:256*1024,
  diagnostics:'OFF in timing matrix; separate ON d1/100/1000 probes; fixed diagnostics must match plain results',
  createdAt:new Date().toISOString()};
 writeFileSync(resolve(dir,'plan.json'),json(plan)+'\n',{flag:'wx'});console.log(json({prepared:dir,positions:plan.positions.length}));
}else if(mode==='child'){
 const plan=read('plan.json');const before:typeof after=await import(pathToFileURL(resolve('.diagnostic-temp/p212-before/src/domain/shogi/twoPlyAlphaBetaAi.ts')).href);
 const send=(v:unknown)=>process.send?.(JSON.parse(json(v)));const begun=performance.now();
 function sample(p:{id:string;state:BoardState},version:string,variant:string,c:{limit:number|null;depth:number},run:number,diagnostic:boolean){
  assert.ok(performance.now()-begun<plan.globalMs-1000);const meta={id:p.id,version,variant,...c,run,diagnostic,phase:run===0?'warmup':'measurement'};
  send({type:'started',...meta});const engine=version==='before'?before:after, d=diagnostic?new SearchDiagnostics():undefined,saved=json(p.state),start=performance.now();
  const result=c.limit===null?engine.analyzeAlphaBetaSearch(p.state,c.depth,undefined,undefined,options(variant),d):engine.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(p.state,c.depth,c.limit,undefined,()=>performance.now(),options(variant),d);
  const actualMs=performance.now()-start;assert.equal(json(p.state),saved);auditPv(p.state,result);
  send({type:'sample',...meta,actualMs,overrun:c.limit===null?null:Math.max(0,actualMs-c.limit),result,selection:d?{...d.quietPromotions,...d.phases['q-select-promotions']}:null});
 }
 for(const p of plan.positions)for(const c of plan.conditions)for(let run=0;run<=c.repeats;run++){
  const variants=run%2?['C','B','A']:['A','B','C'];for(const variant of variants)for(const version of (run+plan.positions.indexOf(p))%2?['after','before']:['before','after'])sample(p,version,variant,c,run,false);
 }
 for(const p of plan.positions)for(const limit of [null,100,1000])for(const variant of plan.variants)for(const version of plan.versions)sample(p,version,variant,{limit,depth:limit===null?1:4},1,true);
 send({type:'end',at:new Date().toISOString()});
}else if(mode==='run'){
 const plan=read('plan.json');for(const[f,h]of Object.entries(plan.sourceHashes))assert.equal(hash(readFileSync(f)),h);
 const fd=openSync(resolve(dir,'raw.jsonl'),'wx');let bytes=readdirSync(dir).reduce((n,f)=>n+statSync(resolve(dir,f)).size,0),stopped=false,ended=false,pending:unknown=null,stderr='';
 const emit=(v:unknown,reserved=false)=>{const line=json(v)+'\n';assert.ok(bytes+Buffer.byteLength(line)<=plan.maxBytes-(reserved?0:plan.reserve));writeSync(fd,line);bytes+=Buffer.byteLength(line);};
 emit({type:'environment',node:process.version,os:release(),cpu:cpus()[0]?.model,at:new Date().toISOString(),planHash:hash(readFileSync(resolve(dir,'plan.json')))});
 const child=fork(fileURLToPath(import.meta.url),['child',dir],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
 const stop=(reason:string)=>{if(stopped)return;stopped=true;emit({type:'failure',reason,pending},true);child.kill('SIGKILL');};
 let watchdog=setTimeout(()=>stop('task-timeout'),plan.taskMs);const global=setTimeout(()=>stop('global-timeout'),plan.globalMs);
 child.stderr?.on('data',d=>stderr=(stderr+String(d)).slice(-32000));
 child.on('message',(m:{type:string})=>{if(stopped)return;clearTimeout(watchdog);try{emit(m);}catch{stop('storage');return;}pending=m.type==='started'?m:null;if(m.type==='end')ended=true;watchdog=setTimeout(()=>stop('task-timeout'),plan.taskMs);});
 await new Promise<void>((done,reject)=>{child.on('error',e=>stop(e.message));child.on('exit',(code,signal)=>{clearTimeout(watchdog);clearTimeout(global);emit({type:'exit',code,signal,ended,stderr,at:new Date().toISOString()},true);closeSync(fd);console.log(json({code,ended,bytes}));if(code===0&&ended)done();else reject(Error('incomplete; raw preserved'));});});
}else if(mode==='audit'){
 const plan=read('plan.json');if(readdirSync(dir).includes('manifest.json'))for(const[f,h]of Object.entries(read('manifest.json')))assert.equal(hash(readFileSync(resolve(dir,f))),h);
 for(const[f,h]of Object.entries(plan.originalHashes))assert.equal(hash(readFileSync(f)),h,'old evidence changed: '+f);
 for(const[f,h]of Object.entries(plan.sourceHashes))assert.equal(hash(gunzipSync(readFileSync(resolve(dir,f.replaceAll('/','__')+'.gz')))),h);
 assert.equal(hash(gunzipSync(readFileSync(resolve(dir,'before-src.tar.gz')))),plan.archiveHash);
 const raw=readFileSync(resolve(dir,'raw.jsonl'),'utf8').trim().split('\n').map(parse);assert.equal(raw.at(-1).code,0);assert.equal(raw.at(-1).ended,true);assert.equal(raw.filter(r=>r.type==='failure').length,0);
 const ss=raw.filter(r=>r.type==='sample');assert.equal(ss.length,900);assert.equal(raw.filter(r=>r.type==='started').length,900);
 const strip=({elapsedMilliseconds:_ms,...r}:Record<string,unknown>)=>r;
 for(const p of plan.positions)for(const c of plan.conditions)for(const variant of plan.variants)for(let run=0;run<=c.repeats;run++){
  const pair=plan.versions.map((version:string)=>ss.filter(s=>s.id===p.id&&s.limit===c.limit&&s.depth===c.depth&&s.variant===variant&&s.version===version&&s.run===run&&!s.diagnostic));assert.ok(pair.every((c:unknown[])=>c.length===1));
  if(c.limit===null)assert.deepEqual(strip(pair[0][0].result),strip(pair[1][0].result),'fixed before/after mismatch');
 }
 for(const s of ss){auditPv(plan.positions.find((p:{id:string})=>p.id===s.id).state,s.result);if(s.diagnostic&&s.limit===null){const plain=ss.find(r=>!r.diagnostic&&r.limit===null&&r.depth===1&&r.version===s.version&&r.variant===s.variant&&r.id===s.id&&r.run===1)!;assert.deepEqual(strip(s.result),strip(plain.result));}}
 const summary=[];
 for(const diagnostic of [false,true])for(const condition of ['d1','d4','100ms','1000ms'])for(const variant of plan.variants)for(const version of plan.versions){
  const cell=ss.filter(s=>s.phase==='measurement'&&s.diagnostic===diagnostic&&s.variant===variant&&s.version===version&&(s.limit===null?'d'+s.depth:s.limit+'ms')===condition);if(!cell.length)continue;
  summary.push({diagnostic,condition,variant,version,n:cell.length,actualMs:cell.reduce((n,s)=>n+s.actualMs,0),maxOverrun:Math.max(...cell.map(s=>s.overrun??0)),depth:cell.reduce((n,s)=>n+(s.result.completedDepth??s.result.depth),0),q:cell.reduce((n,s)=>n+s.result.quiescenceVisitedPositionCount,0),normal:cell.reduce((n,s)=>n+s.result.visitedPositionCount,0),selection:diagnostic?{considered:cell.reduce((n,s)=>n+s.selection.considered,0),added:cell.reduce((n,s)=>n+s.selection.added,0),milliseconds:cell.reduce((n,s)=>n+s.selection.milliseconds,0)}:null,sources:Object.fromEntries(['completed-iteration','partial-root','fallback'].map(k=>[k,cell.filter(s=>s.result.resultSource===k).length]))});
 }
 const pairs=[];for(const limit of [100,1000])for(const variant of plan.variants){const cell=ss.filter(s=>!s.diagnostic&&s.phase==='measurement'&&s.limit===limit&&s.variant===variant&&s.version==='after');const changes=cell.map(s=>{const b=ss.find(r=>!r.diagnostic&&r.id===s.id&&r.run===s.run&&r.limit===limit&&r.variant===variant&&r.version==='before')!;return{id:s.id,run:s.run,depth:s.result.completedDepth-b.result.completedDepth,actionChanged:json(s.result.selectedAction)!==json(b.result.selectedAction),pvChanged:json(s.result.principalVariation)!==json(b.result.principalVariation)};});pairs.push({limit,variant,better:changes.filter(c=>c.depth>0).length,worse:changes.filter(c=>c.depth<0).length,same:changes.filter(c=>c.depth===0).length,changes});}
 const output={valid:true,samples:ss.length,fixedExactComparisons:120,oldProtectedFiles:Object.keys(plan.originalHashes).length,summary,pairs};writeFileSync(resolve(dir,'summary.json'),json(output)+'\n');
 const lines=['# P212 P2 修正前後（raw再集計）','','基準 '+BASE+'。診断OFF本体とON別プローブを分離。','', '|診断|条件|方式|版|n|API合計ms|最大超過ms|深さ合計|通常/q|対象/追加|選別ms|','|---|---|---|---|---:|---:|---:|---:|---|---|---:|'];for(const r of summary)lines.push(`|${r.diagnostic?'ON':'OFF'}|${r.condition}|${r.variant}|${r.version}|${r.n}|${r.actualMs.toFixed(3)}|${r.maxOverrun.toFixed(3)}|${r.depth}|${r.normal}/${r.q}|${r.selection?r.selection.considered+'/'+r.selection.added:'N/A'}|${r.selection?.milliseconds.toFixed(3)??'N/A'}|`);lines.push('','|ms|方式|修正前比 深さ改善/悪化/同じ|','|---|---|---|');for(const p of pairs)lines.push(`|${p.limit}|${p.variant}|${p.better}/${p.worse}/${p.same}|`);writeFileSync(resolve(dir,'results.md'),lines.join('\n')+'\n');
 const manifest=Object.fromEntries(readdirSync(dir).filter(f=>f!=='manifest.json').sort().map(f=>[f,hash(readFileSync(resolve(dir,f)))]));writeFileSync(resolve(dir,'manifest.json'),json(manifest)+'\n');assert.ok(readdirSync(dir).reduce((n,f)=>n+statSync(resolve(dir,f)).size,0)<=plan.maxBytes);console.log(json({valid:true,samples:ss.length,summaryHash:hash(json(output)+'\n')}));
}else throw Error('prepare|run|audit DIR');
