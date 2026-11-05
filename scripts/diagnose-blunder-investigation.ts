import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {getLegalActions} from '../src/domain/shogi/legalActions';
import {analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch,areLegalActionsEqual} from '../src/domain/shogi/twoPlyAlphaBetaAi';
import {SearchDiagnostics} from '../src/domain/shogi/searchDiagnostics';
import {sha256} from './benchmarks/journalIO';
import {extract,apply} from './benchmarks/gameBlunderPilot';
import {fixedCandidate,stableKey,fixedOptions} from './benchmarks/gameBlunderFixed';
const [out,priorFile,v3File,...paths]=process.argv.slice(2);
assert.ok(out&&priorFile&&v3File&&paths.length,'NEW_DIR PILOT_JSON V3_JSON JOURNAL...');
mkdirSync(resolve(out),{recursive:false});
const file=join(resolve(out),'observations.jsonl');writeFileSync(file,'',{flag:'wx'});
const save=(x:unknown)=>appendFileSync(file,JSON.stringify(x,(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?{nonfinite:String(v)}:v)+'\n');
const before=paths.map(p=>sha256(readFileSync(p))), prior=JSON.parse(readFileSync(priorFile,'utf8')) as {results:{id:string;verdict:string;alternative:import('../src/domain/shogi/legalActions').LegalAction|null}[]};
const v3=JSON.parse(readFileSync(v3File,'utf8')) as {rows:{id:string;classification:{labels:string[]};judgment:{verdict:string}}[]};
const setup=performance.now(),data=extract(paths), restoreMs=performance.now()-setup;
assert.ok(data.games.every(g=>g.audit.status==='complete')); assert.equal(data.candidates.length,56);
const selection=prior.results.map(r=>{const c=data.candidates.find(x=>x.id===r.id);assert.ok(c);return {c,prior:r};}); assert.equal(selection.length,24);
const flags=['A','B','C','D','E','F'];
const counts={features:Object.fromEntries(flags.map(f=>[f,v3.rows.filter(r=>r.classification.labels.includes(f)).length])),overlap:v3.rows.filter(r=>r.classification.labels.length>1).length,
  noFeature:v3.rows.filter(r=>r.classification.labels.length===0).length,indeterminate:v3.rows.filter(r=>r.judgment.verdict==='INDETERMINATE').length,notRun:v3.rows.filter(r=>r.judgment.verdict==='NOT_RUN').length};
const began=performance.now();
save({type:'plan',baseHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:true,sourceHashes:Object.fromEntries(['scripts/diagnose-blunder-investigation.ts','scripts/benchmarks/gameBlunderFixed.ts'].map(p=>[p,sha256(readFileSync(p))])),before,paths,restoreMs,
  selection:selection.map(x=>x.c.id),limits:{positions:24,timeMs:1000,maxDepth:4,fixedPositions:4,fixedDepth:2,nodeLimit:1500,perFixedSoftMs:3000,experimentSoftMs:180000,repetitions:2},counts});
for(const {c} of selection){
  if(performance.now()-began>=180000){save({type:'timed',id:c.id,status:'not-run',reason:'experiment-soft-limit'});continue;}
  let phase='legal';const t=performance.now();
  try {
    const legal=getLegalActions(c.state),legalMs=performance.now()-t;
    phase='preparation';const prep=performance.now(),diag=new SearchDiagnostics(false,false),preparationMs=performance.now()-prep;
    phase='search';const s=performance.now(),result=analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(c.state,4,1000,{pieceSafetyMode:c.mode},()=>performance.now(),c.conditions.options,diag),searchMs=performance.now()-s;
    phase='normalization';const norm=performance.now();
    const row={type:'timed',id:c.id,journal:c.path,ply:c.move.ply,mode:c.mode,conditions:c.conditions,legalMs,preparationMs,searchMs,rootLegalCount:legal.length,
      status:result.timedOut?'deadline':'complete',lastPhase:diag.interruptedPhase,lastStage:diag.interruptedStage,deadline:diag.deadlineObservation,depthOne:diag.depthOne,
      phases:diag.phases,completedDepth:result.completedDepth,source:result.resultSource,validCompletedIteration:result.resultSource==='completed-iteration'&&result.completedDepth>0,
      result,normalizationMs:performance.now()-norm};save(row);
  } catch(e){save({type:'timed',id:c.id,status:'error',lastPhase:phase,error:String(e)});}
}
for(const {c,prior:p} of selection.filter(x=>x.prior.verdict==='SUSPECTED')) {
  if(!p.alternative){save({type:'fixed',id:c.id,status:'invalid',reason:'missing historical alternative'});continue;}
  const legal=getLegalActions(c.state),actual=legal.find(a=>areLegalActionsEqual(a,c.move.action)),alt=legal.find(a=>areLegalActionsEqual(a,p.alternative!));
  if(!actual||!alt){save({type:'fixed',id:c.id,status:'invalid',reason:'illegal candidate'});continue;}
  const children=[actual,alt].map(a=>{const after=apply(c.state,a);return {action:a,legalReplies:getLegalActions(after),status:after.status};});
  save({type:'candidates',id:c.id,journal:c.path,ply:c.move.ply,player:c.state.turn,children});
  for(const q of [0,1] as const)for(const [kind,a] of [['actual',actual],['alternative',alt]] as const)for(let rep=0;rep<2;rep++){
    if(performance.now()-began>=180000){save({type:'fixed',id:c.id,kind,q,rep,status:'not-run',reason:'experiment-soft-limit'});continue;}
    const r=fixedCandidate(c.state,a,c.mode,q);
    save({type:'fixed',id:c.id,journal:c.path,ply:c.move.ply,kind,q,rep,mode:c.mode,depth:2,limits:{nodes:1500,ms:3000},options:fixedOptions(q),stableKey:stableKey(r),...r});
  }
}
const after=paths.map(p=>sha256(readFileSync(p)));save({type:'end',after,unchanged:JSON.stringify(before)===JSON.stringify(after),elapsedMs:performance.now()-began});assert.deepEqual(after,before);
