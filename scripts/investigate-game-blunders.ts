import assert from 'node:assert/strict';
import {appendFileSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {getLegalActions} from '../src/domain/shogi/legalActions';
import {analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch,areLegalActionsEqual} from '../src/domain/shogi/twoPlyAlphaBetaAi';
import {SearchDiagnostics} from '../src/domain/shogi/searchDiagnostics';
import {extract,type ExtractionTiming} from './benchmarks/gameBlunderPilot';
import {completedTimedIteration} from './benchmarks/gameBlunderFixed';
import {BUDGET,CONDITIONS,ROOT_CONDITION,classificationCounts,inspectCandidate,json,repeatKey,runFixed} from './benchmarks/gameBlunderInvestigation';
import {sha256} from './benchmarks/journalIO';
import {stateHash} from './benchmarks/matchJournal';

const [out,priorFile,v3File,...paths]=process.argv.slice(2);
assert.ok(out&&priorFile&&v3File&&paths.length===4,'NEW_DIR PILOT_JSON V3_JSON JOURNAL1 JOURNAL2 JOURNAL3 JOURNAL4');
const prior=JSON.parse(readFileSync(priorFile,'utf8')) as {results:{id:string;verdict:string;alternative:import('../src/domain/shogi/legalActions').LegalAction|null}[]};
const v3=JSON.parse(readFileSync(v3File,'utf8')) as Parameters<typeof classificationCounts>[0] extends infer T ? {rows:T} : never;
assert.equal(prior.results.length,24); assert.equal(new Set(prior.results.map(r=>r.id)).size,24);
const suspected=prior.results.filter(r=>r.verdict==='SUSPECTED'); assert.equal(suspected.length,4);
const began=performance.now(),softTotalMs=300000,withinBudget=()=>performance.now()-began<softTotalMs;
mkdirSync(resolve(out),{recursive:false}); const file=join(out,'observations.jsonl'); writeFileSync(file,'',{flag:'wx'});
const io:{index:number;type:string;serializationMs:number;saveMs:number}[]=[];
let index=0;
const save=(row:{type:string;[key:string]:unknown})=>{
  const t=performance.now(),line=json(row)+'\n',serialized=performance.now(); appendFileSync(file,line);
  io.push({index:index++,type:row.type,serializationMs:serialized-t,saveMs:performance.now()-serialized});
};
const hashes=()=>paths.map(p=>sha256(readFileSync(p))),before=hashes();
const sources=[...execFileSync('git',['ls-files','src/domain/shogi','src/types/shogi.ts','scripts/benchmarks'],{encoding:'utf8'}).trim().split('\n'),
  'scripts/benchmarks/gameBlunderFixed.ts','scripts/benchmarks/gameBlunderInvestigation.ts','scripts/investigate-game-blunders.ts','scripts/summarize-game-blunders.ts'];
save({type:'plan',schema:3,startedAt:new Date().toISOString(),baseHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  sourceDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0,
  sourceHashes:Object.fromEntries([...new Set(sources)].map(p=>[p,sha256(readFileSync(p))])),
  paths,before,priorFile,priorHash:sha256(readFileSync(priorFile)),v3File,v3Hash:sha256(readFileSync(v3File)),
  selection:prior.results.map(r=>r.id),suspected:suspected.map(r=>r.id),conditions:CONDITIONS,budget:BUDGET,
  limits:{softTotalMs,timedDepth:4,timedMs:1000,repetitions:2,fixedRootDepth:1,fixedRootPositions:24,fixedPairPositions:4,maxExchangeCaptures:4},
  counts:classificationCounts(v3.rows),
  classificationRows:v3.rows.map(r=>({id:r.id,classification:r.classification,judgment:r.judgment})),
  metric:'Node cap counts normal plus quiescence enter events, excluding root; cooperative deadline includes legal/candidate/setup. Not a hard process deadline.',
  determinism:'Stable generated order; TT/killer/previous PV disabled; call-local state; no random seed or shared search cache.',
  proofPolicy:'No outcome prover prerequisite. Unknown general middlegame proof is not a search failure. Finite preference never yields CONFIRMED.'});

const extraction:ExtractionTiming={journals:{},positions:{}};
const data=extract(paths,extraction); assert.ok(data.games.every(g=>g.audit.status==='complete')); assert.equal(data.candidates.length,56);
save({type:'setup',extraction,plies:data.games.reduce((n,g)=>n+g.audit.moves.length,0),
  note:'read includes file IO, chain decode and checksums; audit validates recorded search/PV and replays all plies. Per-position replay prefix is cumulative shared work, not additive.'});
const selection=prior.results.map(p=>{const c=data.candidates.find(x=>x.id===p.id);assert.ok(c);return {c,p};});
for(const {c,p} of selection) {
  if(!withinBudget()) {save({type:'timed',id:c.id,status:'not-run',reason:'experiment-budget'});continue;}
  const normStart=performance.now(),beforeState=stateHash(c.state),legalAt=performance.now(),legal=getLegalActions(c.state),legalMs=performance.now()-legalAt;
  const candidateAt=performance.now(),actual=legal.find(a=>areLegalActionsEqual(a,c.move.action)),alternative=p.alternative&&legal.find(a=>areLegalActionsEqual(a,p.alternative!));
  assert.ok(actual); const candidateMs=performance.now()-candidateAt;
  const prepAt=performance.now(),diag=new SearchDiagnostics(false,false),nodes={normal:0,quiescence:0}; let lastCompletedNode:unknown=null;
  diag.traceNode=e=>{if(e.kind==='enter')nodes[e.phase]++;if(e.kind==='return')lastCompletedNode={phase:e.phase,ply:e.ply,remainingDepth:e.remainingDepth};};
  const preparationMs=performance.now()-prepAt;
  const searchAt=performance.now(); let stage='search';
  try {
    const result=analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(c.state,4,1000,{pieceSafetyMode:c.mode},()=>performance.now(),c.conditions.options,diag);
    const searchMs=performance.now()-searchAt; stage='normalization'; const normalizeAt=performance.now();
    const validity=completedTimedIteration(result);
    const row={type:'timed',id:c.id,journal:c.path,ply:c.move.ply,mode:c.mode,options:c.conditions.options,
      rootLegalCount:legal.length,candidateCount:legal.length,pairCandidateCount:alternative?2:1,actual,alternative:alternative??null,
      sharedJournalTiming:extraction.journals[c.path],restoration:extraction.positions[c.id],legalMs,candidateMs,preparationMs,searchMs,
      nodes,searchStarted:true,searchEnded:true,status:result.timedOut?'deadline':'completed',reason:result.timedOut?'deadline':'requested-depth-complete',
      interruptedPhase:diag.interruptedPhase,interruptedStage:diag.interruptedStage,crossedDeadlinePhase:diag.crossedDeadlinePhase,deadline:diag.deadlineObservation,
      phases:diag.phases,finished:diag.finished,lastCompletedStage:result.completedDepth>0?'iteration-'+result.completedDepth:'root-legal',lastCompletedNode,
      depthOne:diag.depthOne,completedDepth:result.completedDepth,validity,result,
      normalizationMs:performance.now()-normalizeAt,externalMsBeforeSearch:searchAt-normStart};
    assert.equal(stateHash(c.state),beforeState); save(row);
  } catch(e) {save({type:'timed',id:c.id,status:'error',reason:String(e),lastStage:stage,nodes});}
}
// Repeat full root selection too, not only evaluation of two preselected moves.
for(const {c} of selection)for(let rep=0;rep<2;rep++) {
  const identity={type:'root-fixed',id:c.id,rep,condition:ROOT_CONDITION,mode:c.mode,positionHash:stateHash(c.state),budget:BUDGET};
  if(!withinBudget()) {save({...identity,status:'not-run',reason:'experiment-budget'});continue;}
  const r=runFixed(c.state,null,c.mode,ROOT_CONDITION);
  save({...identity,repeatKey:repeatKey(r),...r});
}
for(const {c,p} of selection.filter(x=>x.p.verdict==='SUSPECTED')) {
  const legal=getLegalActions(c.state),actual=legal.find(a=>areLegalActionsEqual(a,c.move.action)),alternative=p.alternative&&legal.find(a=>areLegalActionsEqual(a,p.alternative!));
  if(!actual||!alternative) {save({type:'candidates',id:c.id,status:'invalid',reason:'Missing or illegal historical action'});continue;}
  save({type:'candidates',id:c.id,journal:c.path,ply:c.move.ply,player:c.state.turn,mode:c.mode,positionHash:stateHash(c.state),
    actual:inspectCandidate(c.state,actual),alternative:inspectCandidate(c.state,alternative),
    recordedExchange:v3.rows.find(r=>r.id===c.id)});
  for(const condition of CONDITIONS)for(const [kind,a] of [['actual',actual],['alternative',alternative]] as const)for(let rep=0;rep<2;rep++) {
    const identity={type:'pair-fixed',id:c.id,kind,rep,condition,mode:c.mode,positionHash:stateHash(c.state),budget:BUDGET};
    if(!withinBudget()) {save({...identity,status:'not-run',reason:'experiment-budget'});continue;}
    const r=runFixed(c.state,a,c.mode,condition);
    save({...identity,repeatKey:repeatKey(r),...r});
  }
  // Same deterministic task with detailed spans OFF and ON. Node counting and
  // root restriction remain ON in both. Durations are observations, not speed claims.
  for(const detailed of [false,true])for(let rep=0;rep<2;rep++) {
    const identity={type:'probe-control',id:c.id,detailed,rep,condition:CONDITIONS[0],mode:c.mode,positionHash:stateHash(c.state),budget:BUDGET};
    if(!withinBudget()) {save({...identity,status:'not-run',reason:'experiment-budget'});continue;}
    const r=runFixed(c.state,actual,c.mode,CONDITIONS[0],BUDGET,()=>performance.now(),detailed);
    save({...identity,repeatKey:repeatKey(r),...r});
  }
}
const after=hashes();
save({type:'end',after,unchanged:json(before)===json(after),elapsedMs:performance.now()-began,
  ioMeasurements:io.slice(),ioScope:'Serialization and append timings for preceding rows; footer and fsync excluded.'});
assert.deepEqual(after,before,'journal changed');
