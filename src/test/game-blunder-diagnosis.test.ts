import {describe,it,expect} from 'vitest';
import {exchangePositions} from '../../scripts/benchmarks/exchangePositions';
import {QUIESCENCE_BENCHMARK_POSITIONS} from '../../scripts/benchmarks/quiescencePositions';
import {constructed} from '../../scripts/benchmarks/tacticalPositions';
import {apply} from '../../scripts/benchmarks/gameBlunderPilot';
import {traceExchange,evaluateComparison,classify} from '../../scripts/benchmarks/gameBlunderDiagnosis';
import {getLegalActions} from '../domain/shogi/legalActions';
import {isPlayerInCheck} from '../domain/shogi/checkmate';

const action=(state:ReturnType<typeof constructed>,fr:number,fc:number,tr:number,tc:number,promotion='none')=> {
  const a=getLegalActions(state).find(x=>x.kind==='move' && x.from.row===fr && x.from.col===fc && x.to.row===tr && x.to.col===tc && x.promotion===promotion);
  if (!a) throw Error('fixture action missing'); return a;
};
describe('bounded recorded exchange (artificial fixtures)',()=>{
  it('traces legal recapture and promotion/hand material, without judging a sacrifice',()=>{
    const s=exchangePositions().find(p=>p.id==='exchange-chain')!.state;
    const first=action(s,5,4,4,4), s1=apply(s,first), second=action(s1,3,4,4,4), s2=apply(s1,second), third=action(s2,5,5,4,4);
    const trace=traceExchange(s,first,[second,third]);
    expect(trace.afterPlayedMaterial).toBe(200);
    expect(trace.steps.map(x=>x.material)).toEqual([-1800,-1000]);
    expect(trace.steps[0].legalRecaptures).toContainEqual(second);
    expect(classify(s,trace,0,null).labels).not.toContain('B');
    expect(trace.limitation).toContain('not solved');
  });
  it('distinguishes an ordinary equal exchange from a missed recapture trigger',()=>{
    const s=QUIESCENCE_BENCHMARK_POSITIONS.find(p=>p.id==='pawn-recapture')!.create();
    const first=action(s,5,4,4,4), s1=apply(s,first), second=action(s1,3,4,4,4);
    const trace=traceExchange(s,first,[second]);
    expect(trace.steps[0].material).toBe(0);
    expect(traceExchange(s,first,[second])).toEqual(trace);
    expect(classify(s,trace,0,null).labels).not.toContain('A');
    expect(classify(s,trace,0,null).labels).not.toContain('B');
  });
  it('flags a legal recapture that the recorded line does not take',()=>{
    const s=exchangePositions().find(p=>p.id==='exchange-chain')!.state;
    const first=action(s,5,4,4,4), second=action(apply(s,first),3,4,4,4), after=apply(apply(s,first),second);
    const quiet=getLegalActions(after).find(a=>a.to.row!==4 || a.to.col!==4)!;
    expect(quiet).toBeDefined();
    const trace=traceExchange(s,first,[second,quiet]);
    expect(trace.nextLegalRecaptures.length).toBeGreaterThan(0);
    expect(classify(s,trace,0,null).labels).toContain('B');
  });
  it('accounts for promotion as well as captured pawn entering hand',()=>{
    const s=QUIESCENCE_BENCHMARK_POSITIONS.find(p=>p.id==='promotion-capture')!.create();
    const promoted=action(s,3,4,2,4,'promote'), declined=action(s,3,4,2,4,'decline');
    expect(traceExchange(s,promoted,[]).afterPlayedMaterial).toBe(300);
    expect(traceExchange(s,declined,[]).afterPlayedMaterial).toBe(200);
  });
  it('does not offer a pinned recapturer when moving it exposes the king',()=>{
    const s=constructed('pinned',[ [8,4,'king','sente'],[0,8,'king','gote'],[0,4,'rook','gote'],[7,4,'gold','sente'],[6,5,'pawn','gote'] ]);
    expect(getLegalActions(s).filter(a=>a.kind==='move' && a.from.row===7 && a.from.col===4).some(a=>a.to.row===6 && a.to.col===5)).toBe(false);
  });
  it('check evasions, including drops, all leave the king safe',()=>{
    const s=QUIESCENCE_BENCHMARK_POSITIONS.find(p=>p.id==='gold-drop-evasion')!.create();
    const actions=getLegalActions(s); expect(actions.some(a=>a.kind==='drop')).toBe(true);
    for(const a of actions) expect(isPlayerInCheck(apply(s,a),'sente')).toBe(false);
  });
});
describe('reference judgment',()=>{
  const done=(selectedEvaluation:number)=>({resultSource:'completed-iteration',timedOut:false,completedDepth:2,selectedEvaluation});
  it('converts opposite child perspective and never confirms finite difference',()=>{
    expect(evaluateComparison(done(200),done(-200))).toMatchObject({verdict:'SUSPECTED',delta:400});
    expect(evaluateComparison(done(-200),done(200))).toMatchObject({verdict:'NOT_CONFIRMED',delta:-400});
  });
  it('keeps timeout, partial, different depths and mate scores indeterminate',()=>{
    for (const x of [{...done(10),timedOut:true},{...done(10),resultSource:'partial-root'}, {...done(10),completedDepth:1}, done(Infinity), done(-Infinity)])
      expect(evaluateComparison(x,done(0)).verdict).toBe('INDETERMINATE');
    expect(evaluateComparison(null,done(0)).verdict).toBe('INDETERMINATE');
    expect(evaluateComparison(done(500),done(0),300,{...done(10),timedOut:true}).verdict).toBe('INDETERMINATE');
    expect(evaluateComparison(done(250),done(0),100).verdict).toBe('SUSPECTED');
    expect(evaluateComparison(done(250),done(0),300).verdict).toBe('NOT_CONFIRMED');
  });
});
