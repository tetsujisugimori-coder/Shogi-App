import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {classify,summarize,validateResult,apply,parse,json,hash,CONDITIONS,
  type Reference,type Result,type Sample} from '../../scripts/benchmarks/tacticalDiagnostics';
import {type TacticalPosition} from '../../scripts/benchmarks/tacticalPositions';
import {verifyAdjudication} from '../../scripts/benchmarks/tacticalObservations';
import {evaluateSearchPositionBreakdown} from '../domain/shogi/twoPlyMinimaxAi';
import {resolveSearchEvaluationPreset} from '../domain/shogi/searchEvaluationPresets';

// Saved measurements/proofs only: no engine invocation or added measurement.
const dir=path.resolve('docs/benchmarks/tactical-mate-20261019/run1');
const read=(file:string)=>parse(readFileSync(path.join(dir,file),'utf8'));
const positions=read('plan.json').positions as TacticalPosition[];
const refs=read('references.json') as Record<string,Reference>;
const rows=readFileSync(path.join(dir,'raw.jsonl'),'utf8').trim().split(/\r?\n/).map(parse) as Sample[];
const get=(id:string)=>positions.find(p=>p.id===id)!;
interface Probe {action:NonNullable<Result['selectedAction']>;score:number;pv:Result['principalVariation']}
function probeResult(id:string,probe:Probe):Result {
  const original=rows.find(r=>r.position===id&&r.condition==='fixed-d4-q1')!.result!;
  let leaf=get(id).state;
  for(const a of probe.pv) leaf=apply(leaf,a);
  verifyAdjudication(leaf);
  const result={...original,selectedAction:probe.action,selectedEvaluation:probe.score,principalVariation:probe.pv,
    evaluationBreakdown:evaluateSearchPositionBreakdown(leaf,get(id).state.turn,resolveSearchEvaluationPreset('standard'))};
  validateResult(get(id),CONDITIONS[3],result);
  return result;
}
describe('review #5571142871: proof scope in tactical classification',()=>{
  it('P2: does not reject the saved immediate no_legal_actions win outside the mate reference',()=>{
    const p=get('mixed-distance');
    const probe=(read('candidate-probe-mixed-distance.json').scores as Probe[]).find(x=>x.action.kind==='move'&&
      x.action.from.row===2&&x.action.from.col===1&&x.action.to.row===1&&x.action.to.col===2)!;
    const result=probeResult(p.id,probe);
    const leaf=apply(p.state,probe.action);
    expect(leaf.result).toMatchObject({winner:'sente',endReason:'no_legal_actions'});
    expect(probe.pv).toHaveLength(1);expect(probe.score).toBe(Infinity);
    expect(refs[p.id].candidates.find(c=>json(c.action)===json(probe.action))!.status).toBe('no-force-within-bound');
    const expected={verdict:'indeterminate',scope:'checkmate-only',reason:'selected-win-outside-checkmate-proof',shortestMatePly:1,selectedMatePly:null};
    expect(classify(p,refs[p.id],result)).toEqual(expected);
    expect(classify({...p,id:'unrelated-id'},refs[p.id],result)).toEqual(expected);
  });
  it('never promotes an Infinity score or a bounded negative into a winning proof',()=>{
    const p=get('mixed-distance'),ref=refs[p.id];
    const chosen=ref.candidates.find(c=>c.status==='no-force-within-bound')!;
    const raw=rows.find(r=>r.position===p.id)!.result!;
    for(const score of [Infinity,0,-Infinity]) expect(classify(p,ref,{...raw,selectedAction:chosen.action,selectedEvaluation:score}).verdict).toBe('indeterminate');
    const unfinished=structuredClone(ref);
    unfinished.candidates.find(c=>json(c.action)===json(chosen.action))!.status='unverified';
    expect(classify(p,unfinished,{...raw,selectedAction:chosen.action,selectedEvaluation:Infinity})).toMatchObject({verdict:'indeterminate',reason:'selected-checkmate-unverified'});
    const noProof={...ref,candidates:ref.candidates.map(c=>({...c,status:'no-force-within-bound' as const,distance:null,proof:undefined}))};
    expect(classify(p,noProof,{...raw,selectedEvaluation:Infinity})).toMatchObject({verdict:'indeterminate',reason:'no-proven-checkmate'});
  });
  it('keeps positive shortest-mate comparison explicitly scoped to checkmate only',()=>{
    const p=get('mixed-distance'),ref=refs[p.id];
    const probes=read('candidate-probe-mixed-distance.json').scores as Probe[];
    for(const distance of [1,3]) {
      const candidate=ref.candidates.find(c=>c.distance===distance)!;
      const probe=probes.find(x=>json(x.action)===json(candidate.action))!;
      const result=probeResult(p.id,probe);
      expect(classify(p,ref,result)).toMatchObject({verdict:distance===1?'match':'mismatch',scope:'checkmate-only',shortestMatePly:1,selectedMatePly:distance});
    }
  });
  it('P2: both saved losing PVs leave actual prolongation indeterminate despite [4,2] mate proofs',()=>{
    const p=get('resistance'),ref=refs[p.id],before=hash({p,ref});
    const probes=read('candidate-probe-resistance.json').scores as Probe[];
    expect(ref.candidates.map(c=>c.distance)).toEqual([4,2]);
    for(const [index,probe] of probes.entries()) {
      const result=probeResult(p.id,probe);
      expect(probe.pv).toHaveLength(2);expect(probe.score).toBe(-Infinity);
      let leaf=p.state;for(const a of probe.pv) leaf=apply(leaf,a);
      expect(leaf.result?.endReason).toBe(index===0?'no_legal_actions':'checkmate');
      const classification=classify(p,ref,result);
      expect(classification).toMatchObject({verdict:'indeterminate',scope:'all-terminal-distance',reason:'all-terminal-resistance-distance-unproved',
        checkmateOnly:{scope:'checkmate-only',verdict:index===0?'match':'mismatch',longestMatePly:4,selectedMatePly:index===0?4:2}});
      expect(classification).not.toHaveProperty('longest');
      expect(classification).not.toHaveProperty('selectedDistance');
      expect(classify({...p,id:'another-loss-position'},ref,result)).toEqual(classification);
    }
    expect(hash({p,ref})).toBe(before);
  });
  it('does not declare prolongation for finite/Infinity scores, incomplete proofs, or null results',()=>{
    const p=get('resistance'),ref=refs[p.id],raw=rows.find(r=>r.position===p.id)!.result!;
    for(const score of [-1001,-Infinity,Infinity]) expect(classify(p,ref,{...raw,selectedEvaluation:score}).verdict).toBe('indeterminate');
    const incomplete={...ref,candidates:ref.candidates.map(c=>({...c,status:'unverified' as const,distance:null,proof:undefined}))};
    expect(classify(p,incomplete,raw)).toMatchObject({verdict:'indeterminate',checkmateOnly:{verdict:'indeterminate',reason:'checkmate-loss-unproved'}});
    expect(classify(p,ref,null).verdict).toBe('indeterminate');
    expect(classify(p,ref,{...raw,selectedEvaluation:null}).verdict).toBe('indeterminate');
  });
  it('reaggregates unchanged 60 raw records with six resistance verdicts corrected',()=>{
    const before=hash({positions,refs,rows});
    const old=parse(readFileSync(path.resolve(dir,'../review-20261020/summary-before.json'),'utf8')) as {position:string;condition:string;verdict:string}[];
    const summary=summarize(positions,refs,rows);
    expect(summarize(positions,refs,parse(json(rows)))).toEqual(summary);
    const counts=(mode:string)=>Object.fromEntries(['match','mismatch','indeterminate'].map(v=>[v,summary.filter(x=>x.mode===mode&&x.verdict===v).length]));
    expect(counts('fixed')).toEqual({match:26,mismatch:2,indeterminate:12});
    expect(counts('timed')).toEqual({match:14,mismatch:0,indeterminate:6});
    const changes=summary.filter((x,i)=>x.verdict!==old[i].verdict);
    expect(changes).toHaveLength(6);expect(changes.every(x=>x.position==='resistance'&&x.verdict==='indeterminate')).toBe(true);
    expect(changes.every(x=>x.reason==='all-terminal-resistance-distance-unproved')).toBe(true);
    expect(summary.filter(x=>x.position==='resistance').every(x=>'checkmateOnly' in x&&x.checkmateOnly?.verdict==='match')).toBe(true);
    expect(hash({positions,refs,rows})).toBe(before);
  });
});
