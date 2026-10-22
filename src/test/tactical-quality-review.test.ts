import {mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {auditTacticalQuality,readMeasurementStream,type QualityAuditContext} from '../../scripts/benchmarks/tacticalQualityAudit';
import {qualityPositions,qualityReference,qualityClassify} from '../../scripts/benchmarks/tacticalQuality';
import {reference,json,parse,hash,type Result} from '../../scripts/benchmarks/tacticalDiagnostics';
import {analyzeAlphaBetaSearch as fixed,analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch as timed} from '../domain/shogi/twoPlyAlphaBetaAi';
const p=qualityPositions().find(p=>p.id==='mixed-distance')!;
const opts={moveOrdering:'standard' as const,killerMoves:false,quiescence:{maxTacticalDepth:1,moveOrdering:'original' as const}};
const byteHash=(s:string)=>createHash('sha256').update(s).digest('hex');
const completeRef=qualityReference(p);
const fixedResult=fixed(p.state,1,undefined,undefined,opts);
const completed=timed(p.state,1,100,undefined,()=>0,opts);
const partial=(r:Result)=>({...r,resultSource:'partial-root',depth:0,completedDepth:0} as Result);

describe('review 5607667850: search completion classification',()=>{
  it('keeps non-null evaluated partial roots inconclusive even with a complete reference',()=>{
    expect(completeRef.stopped).toBe(false);expect(fixedResult.selectedEvaluation).not.toBeNull();
    expect(qualityClassify(p,completeRef,fixedResult).quality).toBe('NoObservedDifference');
    for(const r of [partial(fixedResult),{...partial(fixedResult),depth:2,completedDepth:2} as Result]) {
      expect(qualityClassify(p,completeRef,r)).toMatchObject({quality:'Inconclusive',selectedReference:null,betterReference:null});
      expect(qualityClassify(p,completeRef,r).evidence).toContain('search incomplete');
    }
  });
  it('classifies normally completed fixed depth and completed iterations, including a timed-out next iteration',()=>{
    expect(completed.resultSource).toBe('completed-iteration');
    for(const r of [fixedResult,completed,{...completed,timedOut:true}]) expect(qualityClassify(p,completeRef,r).quality).toBe('NoObservedDifference');
    expect(qualityClassify(p,completeRef,{...completed,completedDepth:0})).toMatchObject({quality:'Inconclusive'});
  });
  it('keeps fallback/null scores and an unfinished reference inconclusive',()=>{
    expect(qualityClassify(p,completeRef,{...partial(fixedResult),resultSource:'fallback',selectedEvaluation:null} as Result).quality).toBe('Inconclusive');
    expect(qualityClassify(p,qualityReference(p,3,1),fixedResult).quality).toBe('Inconclusive');
    expect(qualityClassify(p,{...completeRef,reverseVerified:false},completed).quality).toBe('Inconclusive');
  });
  it('preserves the terminal proof threshold and prevents partial results from becoming gaps or proven errors',()=>{
    const ref=qualityReference(p,1),winner=ref.candidates.find(c=>c.closed&&c.value.breakdown.terminal==='win')!;
    const chosen=ref.candidates.find(c=>c.value.breakdown.terminal===null)!;
    const r={...fixedResult,selectedAction:chosen.action};
    expect(qualityClassify(p,ref,r).quality).toBe('QualityGap');
    expect(qualityClassify(p,ref,partial(r)).quality).toBe('Inconclusive');
    // Classifier-only deliberate loss certificate: not a product engine finding.
    chosen.closed=true;chosen.value={...winner.value,breakdown:{...winner.value.breakdown,terminal:'loss',total:-Infinity}};
    expect(qualityClassify(p,ref,r).quality).toBe('ProvenError');
    expect(qualityClassify(p,ref,partial(r)).quality).toBe('Inconclusive');
    chosen.closed=false;expect(qualityClassify(p,ref,r).quality).toBe('QualityGap');
  });
});

function fixture(stage:'first-warmup'|'first-measurement'|'later-condition'|'complete') {
  // No timer, worker or real 60-second wait. Reuse legal engine results as saved records.
  const dir=mkdtempSync(path.join(os.tmpdir(),'shogi-quality-audit-'));
  const conditions=[{id:'d1',depth:1,budget:null,repeats:1},{id:'d4',depth:4,budget:null,repeats:1},
    {id:'100ms',depth:4,budget:100,repeats:1},{id:'1000ms',depth:4,budget:1000,repeats:1}];
  const plan={positions:[p],positionHash:hash([p]),conditions};
  const refs={[p.id]:reference(p)},qualityRefs={[p.id]:completeRef};
  const file=(name:string)=>path.join(dir,name);
  const save=(name:string,v:unknown)=>writeFileSync(file(name),json(v)+'\n');
  const snapshot={'fixture.ts':'deterministic fixture source\n'};
  save('environment.json',{planHash:hash(plan),refsHash:hash(refs),qualityRefsHash:hash(qualityRefs),sourceHashes:{'fixture.ts':byteHash(snapshot['fixture.ts'])}});
  save('sources.json',snapshot);
  const all:Record<string,unknown>[]=[];
  let sequence=0;
  const activeConditions=stage==='complete'?conditions:stage==='later-condition'?[conditions[0]]:[];
  if(stage==='first-measurement') activeConditions.push(conditions[0]);
  for(const c of activeConditions) {
    const r=c.budget===null?fixed(p.state,c.depth,undefined,undefined,opts):timed(p.state,c.depth,c.budget,undefined,()=>0,opts);
    for(const rep of stage==='first-measurement'?[-1]:[-1,0]) for(const extra of [0,1,2]) all.push({
      sequence:sequence++,position:p.id,condition:c.id,extra,rep,phase:rep<0?'warmup':'measurement',status:'ok',
      result:r,stats:{visitedPositionCount:0,maxExtensionDepth:0,limitReachedCount:0},
      callMs:r.elapsedMilliseconds,apiMs:r.elapsedMilliseconds,overrunMs:c.budget===null?null:Math.max(0,r.elapsedMilliseconds-c.budget),
    });
  }
  const raw=all.filter(r=>r.phase==='measurement').map(r=>json(r)+'\n').join('');
  const warmup=all.filter(r=>r.phase==='warmup').map(r=>json(r)+'\n').join('');
  if(raw) writeFileSync(file('raw.jsonl'),raw);
  if(warmup) writeFileSync(file('warmup.jsonl'),warmup);
  if(stage==='complete') save('completed.json',{samples:all.length,rawHash:hash(raw),warmupHash:hash(warmup)});
  else save('failure.json',{error:'deterministic interruption fixture',sequence,active:{condition:stage==='later-condition'?'d4':'d1',phase:stage==='first-measurement'?'measurement':'warmup'}});
  const context:QualityAuditContext={dir,interrupted:stage!=='complete',plan,refs,qualityRefs,
    tasks:conditions.map(c=>({p,c})),runConditions:conditions,settings:()=>opts};
  return {context,file,raw,warmup};
}

describe('review 5607667850: early interrupted audits',()=>{
  it.each(['missing','empty','whitespace'])('audits a first-warmup interruption with %s streams as zero records',kind=>{
    const {context,file}=fixture('first-warmup');
    if(kind!=='missing') for(const name of ['raw.jsonl','warmup.jsonl']) writeFileSync(file(name),kind==='empty'?'':' \r\n\n');
    const failure=readFileSync(file('failure.json'));
    const a=auditTacticalQuality(context);
    expect(a.coverage.status).toBe('incomplete');expect(a.summary).toEqual([]);
    expect(a.coverage.measurement).toMatchObject({observed:[]});expect(a.coverage.measurement.missing).toHaveLength(12);
    expect(a.coverage.warmup.missing).toHaveLength(12);
    expect(a.quality.stats['condition/100ms/extra0']).toMatchObject({n:0,p50:null,p95:null,max:null,maxOverrun:null});
    const table=readFileSync(file('results-v3.md'),'utf8');expect(table).toContain('|1000ms|2|0|');expect(table).toContain('N/A');expect(table).not.toMatch(/NaN|Infinity/);
    expect(parse(readFileSync(file('interrupted-audit.json'),'utf8'))).toMatchObject({status:'incomplete',samples:0});
    expect(parse(readFileSync(file('missing.json'),'utf8')).missingMeasurementCells).toHaveLength(12);
    expect(readFileSync(file('failure.json'))).toEqual(failure);expect(existsSync(file('completed.json'))).toBe(false);
    if(kind==='missing') expect(existsSync(file('raw.jsonl'))||existsSync(file('warmup.jsonl'))).toBe(false);
    expect(auditTacticalQuality(context)).toEqual(a);
    expect(()=>auditTacticalQuality({...context,interrupted:false})).toThrow();
  });
  it('audits successful warmups followed by a failed first measurement without raw.jsonl',()=>{
    const {context,file}=fixture('first-measurement');const before=readFileSync(file('warmup.jsonl'));
    const a=auditTacticalQuality(context);
    expect(a.coverage.streams).toEqual({measurement:{exists:false,n:0},warmup:{exists:true,n:3}});
    expect(a.coverage.measurement.missing).toHaveLength(12);expect(a.coverage.warmup.missing).toHaveLength(9);
    expect(parse(readFileSync(file('interrupted-audit.json'),'utf8')).samples).toBe(3);
    expect(readFileSync(file('warmup.jsonl'))).toEqual(before);expect(a.summary).toEqual([]);
  });
  it('keeps later unobserved condition groups at n=0 and preserves earlier measured cells',()=>{
    const {context,file}=fixture('later-condition');const raw=readFileSync(file('raw.jsonl'));
    const a=auditTacticalQuality(context);
    expect(a.summary).toHaveLength(3);expect(a.coverage.measurement.observed).toHaveLength(3);
    expect(a.coverage.measurement.missing).toHaveLength(9);
    expect(a.quality.stats['condition/d1/extra0'].n).toBe(1);expect(a.quality.stats['condition/d4/extra0']).toMatchObject({n:0,p50:null});
    expect(readFileSync(file('raw.jsonl'))).toEqual(raw);expect(auditTacticalQuality(context)).toEqual(a);
  });
  it('continues to audit complete data and leaves old v2 aggregates untouched',()=>{
    const {context,file}=fixture('complete');
    for(const name of ['summary-v2.json','quality-summary-v2.json','results.md']) writeFileSync(file(name),'preserved v2 bytes\r\n');
    const a=auditTacticalQuality(context);expect(a.coverage.status).toBe('complete');expect(a.summary).toHaveLength(12);
    expect(a.coverage.measurement.missing).toEqual([]);expect(a.coverage.warmup.missing).toEqual([]);
    expect(auditTacticalQuality(context)).toEqual(a);
    for(const name of ['summary-v2.json','quality-summary-v2.json','results.md']) expect(readFileSync(file(name),'utf8')).toBe('preserved v2 bytes\r\n');
    expect(()=>auditTacticalQuality({...context,interrupted:true})).toThrow();
  });
  it('never treats zero saved rows as a complete run',()=>{
    const {context,file}=fixture('first-warmup');
    // Simulates a damaged completion marker with blank streams; no failure marker.
    const normal=fixture('complete');
    writeFileSync(normal.file('raw.jsonl'),'');writeFileSync(normal.file('warmup.jsonl'),'');
    writeFileSync(normal.file('completed.json'),json({samples:0,rawHash:hash(''),warmupHash:hash('')}));
    expect(()=>auditTacticalQuality(normal.context)).toThrow();
    expect(readMeasurementStream(file('raw.jsonl'),true).rows).toEqual([]);
    expect(()=>readMeasurementStream(file('raw.jsonl'),false)).toThrow();
    writeFileSync(file('raw.jsonl'),'{}\n\n{}\n');expect(()=>readMeasurementStream(file('raw.jsonl'),true)).toThrow();
    expect(context.interrupted).toBe(true);
  });
});
