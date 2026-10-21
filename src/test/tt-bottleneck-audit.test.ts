import { describe, it, expect } from 'vitest';
import { summarize, percentile } from '../../scripts/audit-tt-bottleneck';
import { constructed } from '../../scripts/benchmarks/tacticalPositions';
import { createTranspositionTableStatistics } from '../domain/shogi/transpositionTable';
import { evaluateSearchPositionBreakdown } from '../domain/shogi/twoPlyMinimaxAi';
import { getLegalActions } from '../domain/shogi/legalActions';
import { observePv } from '../../scripts/benchmarks/terminalDistanceReference';

function fixture(kind='fixed') {
  const state=constructed('audit',[[8,8,'king','sente'],[0,0,'king','gote']]);
  const breakdown=evaluateSearchPositionBreakdown(state,state.turn);
  const plan={cells:[{position:'audit',kind,budget:kind==='fixed'?null:100}],repeats:1,
    variants:['A','B','C'],positions:[{id:'audit',state}]};
  const rows=[-1,0].flatMap(repeat=>plan.variants.map(variant=>({sequence:0,position:'audit',kind,repeat,
    phase:repeat<0?'warmup':'measurement',variant,callMs:repeat<0?999:10,cpuUsed:{user:1000,system:0},
    statistics:createTranspositionTableStatistics(),result:{selectedAction:null,selectedEvaluation:breakdown.total,
      principalVariation:[],evaluationBreakdown:breakdown,depth:4,completedDepth:4,resultSource:'completed-iteration'}})));
  rows.forEach((r,i)=>r.sequence=i); return {plan,rows};
}
describe('TT bottleneck evidence audit',()=>{
  it('excludes warmup and refuses missing or duplicated samples',()=>{
    const {plan,rows}=fixture();
    const s=summarize(plan,rows); expect(s.fixedMatches).toBe(4);
    expect(s.groups.every(g=>g.p50Ms===10&&g.n===1)).toBe(true);
    expect(()=>summarize(plan,rows.slice(1))).toThrow();
    const duplicate=structuredClone(rows); duplicate[1]={...duplicate[0],sequence:1};
    expect(()=>summarize(plan,duplicate)).toThrow();
  });
  it('rejects incorrect evaluation and invalid TT accounting',()=>{
    const {plan,rows}=fixture(); rows[0].result.selectedEvaluation++;
    expect(()=>summarize(plan,rows)).toThrow();
    const other=fixture(); other.rows[2].statistics.identityMatches=1;
    expect(()=>summarize(other.plan,other.rows)).toThrow();
  });
  it('distinguishes completed-depth differences from same-depth result differences',()=>{
    const {plan,rows}=fixture('100ms'); rows[4].result.completedDepth=3;
    expect(summarize(plan,rows).timedDifferences).toMatchObject([{category:'different-completed-depth'}]);
    rows[4].result.completedDepth=4;
    const action=getLegalActions(plan.positions[0].state)[0];
    const leaf=observePv(plan.positions[0].state,[action]);
    rows[4].result.selectedAction=action as any;
    rows[4].result.principalVariation=[action] as any;
    rows[4].result.evaluationBreakdown=leaf.breakdown;
    rows[4].result.selectedEvaluation=leaf.breakdown.total;
    expect(summarize(plan,rows).timedDifferences).toMatchObject([{category:'same-depth-different-result'}]);
  });
  it('rejects a selected action that is inconsistent with its legal PV',()=>{
    const {plan,rows}=fixture();
    rows[0].result.selectedAction=getLegalActions(plan.positions[0].state)[0] as any;
    expect(()=>summarize(plan,rows)).toThrow();
  });
  it('uses nearest-rank p95, exposing the maximum at seven observations',()=>{
    expect(percentile([7,1,6,2,5,3,4],.5)).toBe(4);
    expect(percentile([7,1,6,2,5,3,4],.95)).toBe(7);
  });
});
