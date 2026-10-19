import { describe, it, expect } from 'vitest';
import { tacticalPositions, rotate } from '../../scripts/benchmarks/tacticalPositions';
import { CONDITIONS, validatePosition, reference, verifyReference, validateResult, classify, summarize, json, parse, hash, options, type Sample } from '../../scripts/benchmarks/tacticalDiagnostics';
import { analyzeAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { evaluateSearchPositionBreakdown } from '../domain/shogi/twoPlyMinimaxAi';
import { resolveSearchEvaluationPreset } from '../domain/shogi/searchEvaluationPresets';
const positions = tacticalPositions();
const get = (id:string) => positions.find(p=>p.id===id)!;
const result = (id:string) => analyzeAlphaBetaSearch(get(id).state,1,resolveSearchEvaluationPreset('standard'),undefined,options(1));
describe('tactical diagnostics (bounded, offline)',()=>{
  it('has ten distinct deterministic validated identities; preserves input and replay',()=>{
    expect(tacticalPositions()).toEqual(positions);
    expect(hash(parse(json(positions)))).toBe(hash(tacticalPositions()));
    expect(new Set(positions.map(p=>p.id)).size).toBe(10);
    const before=hash(positions);
    for(const p of positions) expect(validatePosition(p).consistency).toBe('verified');
    expect(hash(positions)).toBe(before);
    expect(get('hirate-exchange').state.history).toHaveLength(6);
  });
  it('rejects missing kings, nifu, inconsistent check/result/history, wrong hands',()=>{
    for(const mutate of [
      (p:typeof positions[number])=>{p.state.squares[0][4].piece=null;},
      (p:typeof positions[number])=>{p.state.status='check';},
      (p:typeof positions[number])=>{p.state.result={winner:'sente',loser:'gote',endReason:'checkmate'};},
      (p:typeof positions[number])=>{p.state.positionHistory=[];},
      (p:typeof positions[number])=>{p.state.senteHand=[{id:'wrong',type:'gold',player:'gote'}];},
      (p:typeof positions[number])=>{p.state.squares[5][0].piece={id:'p1',type:'pawn',player:'sente'};p.state.squares[6][0].piece={id:'p2',type:'pawn',player:'sente'};},
    ]) {const p=structuredClone(get('mate-sente'));mutate(p);expect(()=>validatePosition(p)).toThrow();}
  });
  it('proves one/three-ply wins and two/four-ply unavoidable losses independently',()=>{
    const three=reference(get('mate-three'));
    expect(three.stopped).toBe(false);
    const wins=three.candidates.filter(c=>c.status==='forced');
    expect(wins).toHaveLength(1);expect(wins[0].distance).toBe(3);
    expect(wins[0].action).toMatchObject({from:{row:3,col:0},to:{row:2,col:0}});
    const mixed=reference(get('mixed-distance'));
    expect(new Set(mixed.candidates.filter(c=>c.status==='forced').map(c=>c.distance))).toEqual(new Set([1,3]));
    const loss=reference(get('resistance'));
    expect(loss.candidates.map(c=>c.distance)).toEqual([4,2]);
    expect(loss.candidates.every(c=>c.status==='forced')).toBe(true);
    for(const id of ['mate-three','mixed-distance','resistance']) verifyReference(get(id),reference(get(id)));
    const broken=structuredClone(loss);broken.candidates[0].distance=2;
    expect(()=>verifyReference(get('resistance'),broken)).toThrow();
    const p=get('resistance');const truncated=structuredClone(loss);
    const proof=truncated.candidates[0].proof!;
    if('replies' in proof) proof.replies=[];
    expect(()=>verifyReference(p,truncated)).toThrow();
  });
  it('limits reference work and never labels horizon or interrupted work safe',()=>{
    const p=get('mate-three');const r=reference(p,1);
    expect(r.stopped).toBe(true);expect(r.candidates.some(c=>c.status==='unverified')).toBe(true);
    expect(classify(p,r,result('mate-three')).verdict).toBe('indeterminate');
    const e=get('evasion');expect(classify(e,reference(e),result('evasion')).verdict).toBe('indeterminate');
  });
  it('preserves Infinity, -Infinity, null and absent values, including nested breakdowns',()=>{
    const v={plus:Infinity,minus:-Infinity,none:null,nested:{score:Infinity}};
    expect(parse(json(v))).toEqual(v);expect(parse(json(v))).not.toHaveProperty('missing');
    expect(json(v)).toContain('"+Infinity"');expect(json(v)).toContain('"none":null');
  });
  it('uses root perspective on either side and reverses terminal perspective',()=>{
    expect(result('mate-sente').selectedEvaluation).toBe(Infinity);
    expect(result('mate-gote').selectedEvaluation).toBe(Infinity);
    const s=structuredClone(get('mate-sente').state);s.status='ended';s.result={winner:'gote',loser:'sente',endReason:'checkmate'};
    expect(evaluateSearchPositionBreakdown(s,'sente').total).toBe(-Infinity);
    expect(evaluateSearchPositionBreakdown(s,'gote').total).toBe(Infinity);
    const p=get('mixed-distance');expect(rotate(rotate(p.state,'flip'),'flip-back').turn).toBe(p.state.turn);
  });
  it('validates PV/score, input immutability, and rejects corrupt results',()=>{
    const p=get('capture'),before=hash(p),r=result('capture');validateResult(p,CONDITIONS[1],r);
    expect(hash(p)).toBe(before);
    for(const change of [{selectedEvaluation:NaN},{rootLegalActionCount:-1},{principalVariation:[]},{visitedPositionCount:-1},{evaluationBreakdown:{...r.evaluationBreakdown,total:999}}])
      expect(()=>validateResult(p,CONDITIONS[1],{...r,...change})).toThrow();
  });
  it('classifies expected action independently and distinguishes unknown/mismatch/match',()=>{
    const p=get('capture'),ref=reference(p),r=result('capture');
    expect(classify(p,ref,r).verdict).toBe('match');
    expect(classify({...p,target:{...p.target!,avoid:true}},ref,r).verdict).toBe('mismatch');
    expect(classify(p,ref,null).verdict).toBe('indeterminate');
    const mixed=get('mixed-distance'),mr=reference(mixed),short=result('mixed-distance');
    expect(classify(mixed,mr,short).verdict).toBe('match');
    const long=mr.candidates.find(c=>c.distance===3)!;
    expect(classify(mixed,mr,{...short,selectedAction:long.action}).verdict).toBe('mismatch');
    const lp=get('resistance'),lr=reference(lp),loss=result('resistance');
    expect(classify(lp,lr,{...loss,selectedEvaluation:-Infinity,selectedAction:lr.candidates[1].action}).verdict).toBe('mismatch');
  });
  it('reaggregates raw deterministically, rejects missing/duplicate/unknown cells',()=>{
    const p=get('capture'),refs={[p.id]:reference(p)};
    const rows:Sample[]=CONDITIONS.map(c=>({position:p.id,condition:c.id,phase:'measurement',status:'hard-stop',result:null,callMs:15000,apiMs:null,overrunMs:c.budget===null?null:15000-c.budget}));
    const expected=summarize([p],refs,rows);
    expect(summarize([p],refs,parse(json(rows)))).toEqual(expected);
    expect(expected.filter(r=>r.mode==='fixed')).toHaveLength(4);
    expect(expected.filter(r=>r.mode==='timed')).toHaveLength(2);
    expect(()=>summarize([p],refs,rows.slice(1))).toThrow();
    expect(()=>summarize([p],refs,[...rows,rows[0]])).toThrow();
    expect(()=>summarize([p],refs,[{...rows[0],position:'unknown'},...rows.slice(1)])).toThrow();
    expect(()=>summarize([p],refs,[{...rows[0],status:'invalid' as never},...rows.slice(1)])).toThrow();
  });
});
