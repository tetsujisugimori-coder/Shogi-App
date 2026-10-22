import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync,readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { qualityPositions,qualityReference,auditQualityResult,type QualityReference } from './benchmarks/tacticalQuality';
import { json,parse,hash,type Result } from './benchmarks/tacticalDiagnostics';
import { compareReference } from './benchmarks/terminalDistanceReference';
import { prove,digest,type Certificate,type Request,type ProofResult } from './benchmarks/outcomeProof';
import { verifyProof } from './benchmarks/verifyOutcomeProof';
import { classifyWithProofs } from './benchmarks/outcomeQuality';
import { analyzeAlphaBetaSearch as fixed,analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch as timed } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';

const [mode,dir]=process.argv.slice(2);
assert.ok(dir&&['run','audit'].includes(mode),'run NEW_DIR | audit DIR');
const file=(name:string)=>path.join(dir,name);
const byteHash=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
const old='docs/benchmarks/tactical-quality-20261022/run1';
const settings={moveOrdering:'standard' as const,killerMoves:false,usePreviousIterationPv:false,useTranspositionTable:false,
  quiescence:{maxTacticalDepth:1,moveOrdering:'original' as const,maxCheckEvasionExtensions:0}};
const limits={depth:5,nodes:6000,milliseconds:3000,bytes:1000000};
const read=(name:string)=>parse(readFileSync(file(name),'utf8'));
const write=(name:string,v:unknown)=>writeFileSync(file(name),json(v)+'\n',{flag:'wx'});
type Observation={position:string;condition:string;phase:string;rep:number;callMs:number;result:Result};
type CandidateRecord={position:string;request:Request;requestHash:string;result:ProofResult;certificateFile:string|null};
if(mode==='run') {
  assert.equal(git('diff','--name-only'),'','commit implementation before measurement');
  assert.equal(git('diff','--cached','--name-only'),'');
  mkdirSync(dir); // never overwrite an existing experiment
  const positions=qualityPositions().filter(p=>['mate-three','evasion'].includes(p.id));
  const prior:Observation[]=readFileSync(`${old}/raw.jsonl`,'utf8').trim().split(/\r?\n/).map(s=>parse(s))
    .filter(r=>r.extra===0&&((r.position==='mate-three'&&r.condition==='100ms')||(r.position==='evasion'&&r.condition==='d1')));
  const sourceFiles=[...git('ls-files','src','scripts','package.json','package-lock.json').split(/\r?\n/)].filter(f=>!f.startsWith('src/test/'));
  const sourceHashes=Object.fromEntries(sourceFiles.map(f=>[f,byteHash(readFileSync(f))]));
  const oldFiles=git('ls-files','docs/benchmarks/tactical-quality-20261022').split(/\r?\n/);
  const protectedHashes=Object.fromEntries(oldFiles.map(f=>[f,byteHash(readFileSync(f))]));
  write('plan.json',{positions,settings,limits,source:{sha:git('rev-parse','HEAD'),filesHash:digest(sourceHashes)},sourceHashes,
    priorRawHash:byteHash(readFileSync(`${old}/raw.jsonl`)),protectedHashes,
    schedule:'serial: mate-three 100ms/maxDepth4 warmup1 + measurement3; evasion fixed depth1 warmup1 + measurement3; then references and per-unique-candidate proofs; no concurrent tests/build/reference',
    candidateRule:'all fresh selected, all historical extra0 selected, best saved depth3 alternative; deduplicate per position; each gets its own identical depth5/node6000/3000ms/1MB budget',
    createdAt:new Date().toISOString(),environment:{node:process.version,os:`${os.platform()} ${os.release()} ${os.arch()}`,cpu:os.cpus()[0].model},
    limitations:'constructed fixtures; shared product rules; no distance optimality; cooperative time cap; OS/JIT/GC/power uncontrolled; extension/PV/TT remain OFF'});
  write('historical.json',prior);
  const rows:Observation[]=[];
  for(const p of positions)for(let rep=-1;rep<3;rep++) {
    const input=protectSearchInput(p.state),before=hash(p.state),began=performance.now();
    const result=p.id==='mate-three'?timed(input.snapshot,4,100,undefined,undefined,settings):fixed(input.snapshot,1,undefined,undefined,settings);
    const callMs=performance.now()-began;
    assert.ok(!input.wasMutated());assert.equal(hash(p.state),before);auditQualityResult(p,result,0);
    rows.push({position:p.id,condition:p.id==='mate-three'?'100ms':'d1',phase:rep<0?'warmup':'measurement',rep,callMs,result});
    console.log(p.id,rep,result.depth,'resultSource' in result?result.resultSource:'fixed-depth');
  }
  write('observations.json',rows); // finish real-time measurements before references
  const refs=Object.fromEntries(positions.map(p=>[p.id,qualityReference(p)]));write('references.json',refs);
  const savedRefs=parse(readFileSync(`${old}/quality-references.json`,'utf8')) as Record<string,QualityReference>;
  const records:CandidateRecord[]=[];
  const plan=read('plan.json');
  for(const p of positions) {
    const best=[...savedRefs[p.id].candidates].sort((a,b)=>compareReference(b.value,a.value))[0].action;
    const candidates=[...rows,...prior].filter(r=>r.position===p.id).map(r=>r.result.selectedAction).concat(best);
    const unique=[...new Map(candidates.filter(Boolean).map(a=>[json(a),a!])).values()];
    for(const candidate of unique) {
      const request:Request={state:p.state,candidate,perspective:p.state.turn,source:plan.source,limits,order:'forward'};
      const requestHash=digest(request),result=prove(request),certificateFile=result.certificate?`proof-${records.length}.json`:null;
      if(certificateFile) {assert.ok(verifyProof(result.certificate!,requestHash).valid);write(certificateFile,result.certificate);}
      records.push({position:p.id,request,requestHash,result:{...result,certificate:null},certificateFile});
      console.log('candidate',p.id,result.status,result.nodes,JSON.stringify(result.stops));
    }
  }
  write('candidates.json',records);
  write('completed.json',{finishedAt:new Date().toISOString()});
  const names=readdirSync(dir).filter(n=>n.endsWith('.json'));
  write('manifest.json',Object.fromEntries(names.map(n=>[n,byteHash(readFileSync(file(n)))])));
}
// Read-only audit. The manifest pins request identity, and every actual proof
// is reloaded from disk; unknown reports are never represented as certificates.
const manifest=read('manifest.json');
for(const [name,expected] of Object.entries(manifest))assert.equal(byteHash(readFileSync(file(name))),expected);
const plan=read('plan.json');
for(const [name,expected] of Object.entries(plan.protectedHashes))assert.equal(byteHash(readFileSync(name)),expected,'old evidence changed');
const records=read('candidates.json') as CandidateRecord[];
const certificates:Certificate[]=records.flatMap(c=>{
  assert.equal(c.requestHash,digest(c.request));
  if(!c.certificateFile){assert.equal(c.result.status,'unknown');return [];}
  const saved=read(c.certificateFile) as Certificate,v=verifyProof(saved,c.requestHash);
  assert.ok(v.valid,v.reason);assert.equal(v.outcome,c.result.status);return [saved];
});
const summaries=['observations.json','historical.json'].flatMap(stream=>(read(stream) as Observation[]).map(row=>{
  const p=plan.positions.find((p:{id:string})=>p.id===row.position)!;
  const ref=read('references.json')[p.id] as QualityReference;
  const candidates=records.filter(c=>c.position===p.id);
  const evidence=candidates.map(c=>({action:c.request.candidate,status:c.result.status,nodes:c.result.nodes,stops:c.result.stops,
    requestHash:c.requestHash,certificateFile:c.certificateFile,reverified:c.certificateFile!==null}));
  const classification=classifyWithProofs(p,ref,row.result,certificates.filter(c=>c.request.state.recordId===p.state.recordId));
  return {stream,position:p.id,phase:row.phase,rep:row.rep,selected:row.result.selectedAction,depth:row.result.depth,
    resultSource:'resultSource' in row.result?row.result.resultSource:'fixed-depth',timedOut:'timedOut' in row.result?row.result.timedOut:false,
    callMs:row.callMs,reference:ref.candidates.map(c=>({action:c.action,total:c.value.breakdown.total,terminal:c.value.breakdown.terminal,closed:c.closed})),
    evidence,classification};
}));
const result={valid:true,manifestHash:digest(manifest),observations:summaries};
if(mode==='run') write('summary.json',result);
else assert.equal(hash(read('summary.json')),hash(result),'reaggregate mismatch');
console.log(json({valid:true,rows:summaries.length,candidates:records.length,proofs:certificates.length,summaryHash:hash(result)}));
