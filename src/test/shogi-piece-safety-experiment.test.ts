import { expect, it, vi } from 'vitest';
import { evaluateUndefendedPieceSafety as safety } from '../domain/shogi/undefendedPieceSafetyEvaluation';
import { DEFAULT_MATERIAL_VALUE_TABLE as table } from '../domain/shogi/materialEvaluation';
import { createAttackCountMaps } from '../domain/shogi/attacks';
import { evaluateSearchPositionBreakdown as evaluate } from '../domain/shogi/twoPlyMinimaxAi';
import { analyzeAlphaBetaSearch as fixed, analyzeIterativeDeepeningAlphaBetaSearch as iterative, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch as timed } from '../domain/shogi/twoPlyAlphaBetaAi';
import { ExactTranspositionTable } from '../domain/shogi/transpositionTable';
import { getLegalActions, executeLegalAction } from '../domain/shogi/legalActions';
import { constructed, rotate, tacticalPositions } from '../../scripts/benchmarks/tacticalPositions';
import { pieceSafetyPositions } from '../../scripts/benchmarks/pieceSafetyPositions';
import { createInitialBoardState } from '../types/shogi';
import { validatePosition } from '../../scripts/benchmarks/tacticalDiagnostics';
import * as q from '../domain/shogi/quiescenceSearch';
import { distancePositions, observePv } from '../../scripts/benchmarks/terminalDistanceReference';
const b={pieceSafetyMode:'experimental'} as const,a={pieceSafetyMode:'legacy'} as const;
const strip=({elapsedMilliseconds:_t,...r}:ReturnType<typeof fixed>)=>r;
const rook=(attackers:number,defenders:number,promoted=false)=>{
  const s=constructed('warning',[[8,8,'king','sente'],[0,8,'king','gote'],[4,4,'rook','sente']]);
  s.squares[4][4].piece!.isPromoted=promoted;
  const m=createAttackCountMaps(s.squares);m.gote[4][4]=attackers;m.sente[4][4]=defenders;return{s,m};
};
it.each([[0,0,0],[0,2,0],[1,0,-100],[2,0,-100],[2,1,-100*2/3],[1,2,-100/3],[1,1,-50]])('bounded pressure A=%s D=%s',(ac,dc,value)=>{
  const {s,m}=rook(ac,dc);expect(safety(s,'sente',table,m,'experimental')).toBeCloseTo(value);
  expect(safety(s,'gote',table,m,'experimental')).toBeCloseTo(-value);
  expect(safety(s,'sente',table,m)).toBe(ac>0&&dc===0?-100:0);
});
it('promoted board value and unpromoted hand value stay separate',()=>{
  const {s,m}=rook(1,1,true);expect(safety(s,'sente',table,m,'experimental')).toBe(-60);
  s.senteHand.push({id:'hand',type:'rook',player:'sente',isPromoted:true});
  expect(safety(s,'sente',table,m,'experimental')).toBe(-60);
  expect(evaluate(s,'sente',b).material-evaluate({...s,senteHand:[]},'sente',b).material).toBe(1000);
});
it('raw pinned defender remains a warning, without claiming legal recapture',()=>{
  const s=pieceSafetyPositions().find(p=>p.id==='pinned-defender')!.state;
  const m=createAttackCountMaps(s.squares);expect(m.sente[4][3]).toBe(1);expect(m.gote[4][3]).toBe(1);
  expect(getLegalActions(s).some(x=>x.kind==='move'&&x.from.row===5&&x.from.col===4&&x.to.col===3)).toBe(false);
  expect(safety(s,'sente',table,m,'experimental')).toBeLessThan(safety(s,'sente',table,m));
});
it.each(['two-one','one-two','unprotected','pinned-defender'])('rotation, signs, four terms and immutability: %s',id=>{
  const s=pieceSafetyPositions().find(p=>p.id===id)!.state,before=JSON.stringify(s),r=rotate(s,id+'-r');
  for(const c of [a,b]){const v=evaluate(s,'sente',c),other=evaluate(s,'gote',c);
    expect(v.total).toBe(v.material+v.pieceSquare+v.kingSafety+v.undefendedPieceSafety);
    expect(other.total).toBeCloseTo(-v.total);expect(evaluate(r,'gote',c).total).toBeCloseTo(v.total);}
  expect(JSON.stringify(s)).toBe(before);
});
it.each(['wrong',null,NaN,Infinity,{},false])('invalid modes rejected even when timed fallback would skip evaluation: %s',mode=>{
  const s=rook(0,0).s,c={pieceSafetyMode:mode} as unknown as typeof b;
  expect(()=>safety(s,'sente',table,undefined,mode as 'experimental')).toThrow();
  expect(()=>evaluate(s,'sente',c)).toThrow();expect(()=>fixed(s,1,c)).toThrow();
  expect(()=>iterative(s,1,c)).toThrow();expect(()=>timed(s,2,0,c)).toThrow();
});
it.each([NaN,Infinity,-1])('experimental rejects non-finite/negative threatened values: %s',value=>{
  const {s,m}=rook(1,1),bad={...table,unpromoted:{...table.unpromoted,rook:value}};
  expect(()=>safety(s,'sente',bad,m,'experimental')).toThrow();
});
it('omitted and explicit legacy are completely deterministic, including PV, breakdown and statistics',()=>{
  for(const p of pieceSafetyPositions().slice(0,8))expect(strip(fixed(p.state,1))).toEqual(strip(fixed(p.state,1,a)));
});
it('experimental fixed/iterative/q/TT return legal PV with matching root-perspective breakdown',()=>{
  const s=pieceSafetyPositions().find(p=>p.id==='two-one')!.state;
  for(const result of [fixed(s,2,b),iterative(s,2,b),fixed(s,2,b,undefined,{quiescence:{maxTacticalDepth:1},useTranspositionTable:true})]){
    let leaf=s;for(const action of result.principalVariation){expect(getLegalActions(leaf)).toContainEqual(action);const n=executeLegalAction(leaf,action);expect(n.type).toBe('applied');if(n.type==='applied')leaf=n.state;}
    expect(result.evaluationBreakdown).toEqual(evaluate(leaf,s.turn,b));expect(result.selectedEvaluation).toBe(result.evaluationBreakdown?.total);
  }
});
it.each([100,1000])('time budget %sms preserves source/depth and PV contracts',ms=>{
  const s=rook(0,0).s;const r=timed(s,2,ms,b);expect(getLegalActions(s)).toContainEqual(r.selectedAction);
  expect(['completed-iteration','partial-root','fallback']).toContain(r.resultSource);
  if(r.resultSource==='completed-iteration')expect(r.completedDepth).toBeGreaterThan(0);
});
it('zero budget keeps fallback and invalid settings are not hidden',()=>{
  const s=rook(0,0).s,r=timed(s,3,0,b);expect(r.resultSource).toBe('fallback');expect(r.selectedEvaluation).toBeNull();expect(r.evaluationBreakdown).toBeNull();
});
it('mate category/distance and legal evasion remain governed by rules',()=>{
  for(const id of ['mate-sente','evasion']){
    const p=tacticalPositions().find(p=>p.id===id);if(!p)throw Error(id);
    const old=fixed(p.state,1,a),result=fixed(p.state,1,b);expect(getLegalActions(p.state)).toContainEqual(result.selectedAction);
    if(id==='mate-sente'){expect(result.selectedEvaluation).toBe(Infinity);expect(result.evaluationBreakdown?.terminal).toBe('win');expect(result.principalVariation.length).toBe(old.principalVariation.length);}
  }
});
it('TT full identity appends evaluation mode; stale identity cannot mix modes',()=>{
  const s=rook(0,0).s,ids:Record<string,string[]>={};
  for(const mode of ['legacy','experimental'] as const){const spy=vi.spyOn(ExactTranspositionTable.prototype,'store');
    try{fixed(s,2,{pieceSafetyMode:mode},undefined,{useTranspositionTable:true});ids[mode]=spy.mock.calls.map(c=>c[1]);expect(ids[mode].length).toBeGreaterThan(0);expect(ids[mode].every(i=>JSON.parse(i).length===(mode==='legacy'?6:7))).toBe(true);if(mode==='experimental')expect(ids[mode].every(i=>JSON.parse(i).at(-1)==='piece-safety:experimental')).toBe(true);}finally{spy.mockRestore();}}
  const tt=new ExactTranspositionTable<number>();tt.store('same',ids.legacy[0],1);expect(tt.probe('same',ids.experimental[0])).toBeUndefined();
  expect(strip(fixed(s,2,b,undefined,{useTranspositionTable:true}))).toEqual(strip(fixed(s,2,b)));
});
it('every diagnostic fixture passes history, material, king and legal-action consistency before measuring',()=>{
  for(const p of pieceSafetyPositions())expect(()=>validatePosition({...p,purpose:'safety',referenceWinner:p.state.turn,referenceDepth:3,expectation:'avoid-loss'})).not.toThrow();
});
it('experimental partial-root keeps the deadline-approved leaf and root viewpoint',()=>{
  const s=createInitialBoardState();let reads=0;
  const r=timed(s,1,100,b,()=>++reads>=7?100:0);
  expect(r.resultSource).toBe('partial-root');expect(r.completedDepth).toBe(0);
  expect(r.partialRoot?.completedRootCandidateCount).toBe(1);
  const next=executeLegalAction(s,r.selectedAction!);if(next.type!=='applied')throw Error('apply');
  expect(r.evaluationBreakdown).toEqual(evaluate(next.state,s.turn,b));
});
it('experimental completed iteration takes precedence over interrupted next depth',()=>{
  const s=createInitialBoardState();let reads=0;const r=timed(s,2,100,b,()=>++reads>=65?100:0);
  expect(r.resultSource).toBe('completed-iteration');expect(r.completedDepth).toBe(1);expect(r.partialRoot).toBeUndefined();
  expect(r.selectedAction).toEqual(fixed(s,1,b).selectedAction);
});
it('experimental does not swallow evaluation exceptions as fallback or partial-root',()=>{
  const spy=vi.spyOn(q,'analyzeQuiescenceSearchWithInternalBounds').mockImplementation(()=>{throw Error('sentinel');});
  try{expect(()=>timed(rook(0,0).s,2,100,b,()=>0,{quiescence:{maxTacticalDepth:1}})).toThrow('sentinel');}finally{spy.mockRestore();}
});
it('experimental terminal distance chooses shortest wins and longest resistance in both seats',()=>{
  for(const id of ['mixed-distance','terminal-resistance','terminal-resistance-gote']){
    const s=distancePositions().find(p=>p.id===id)!.state,r=fixed(s,4,b);
    expect(observePv(s,r.principalVariation).terminalDistancePly).toBe(id==='mixed-distance'?1:4);
    expect(r.evaluationBreakdown?.terminal).toBe(id==='mixed-distance'?'win':'loss');
  }
});
it('promoted pressure is symmetric after changing seats and ignores owned hands',()=>{
  const {s,m}=rook(1,1,true),r=rotate(s,'promoted-reverse');r.squares[4][4].piece!.isPromoted=true;
  const rm=createAttackCountMaps(r.squares);rm.sente[4][4]=1;rm.gote[4][4]=1;
  r.goteHand.push({id:'hand-reverse',type:'rook',player:'gote'});
  expect(safety(r,'gote',table,rm,'experimental')).toBe(safety(s,'sente',table,m,'experimental'));
});
