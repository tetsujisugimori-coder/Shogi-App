import {describe,it,expect} from 'vitest';
import {constructed} from '../../scripts/benchmarks/tacticalPositions';
import {CONDITIONS,BUDGET,runFixed,repeatKey,compareFixed,fixedInvalidReason,inspectCandidate} from '../../scripts/benchmarks/gameBlunderInvestigation';
import {changedFields} from '../../scripts/summarize-game-blunders';
import {getLegalActions} from '../domain/shogi/legalActions';
import {analyzeAlphaBetaSearch,analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch} from '../domain/shogi/twoPlyAlphaBetaAi';
import {SearchDiagnostics} from '../domain/shogi/searchDiagnostics';
import {stateHash} from '../../scripts/benchmarks/matchJournal';
import {apply} from '../../scripts/benchmarks/gameBlunderPilot';
import {completedTimedIteration} from '../../scripts/benchmarks/gameBlunderFixed';
import {isPlayerInCheck} from '../domain/shogi/checkmate';

describe('v4 constructed diagnostic controls',()=>{
  const state=constructed('v4',[[8,8,'king','sente'],[0,8,'king','gote'],[5,4,'rook','sente'],[4,4,'pawn','gote'],[3,4,'silver','gote']]);
  const action=getLegalActions(state).find(a=>a.kind==='move'&&a.from.row===5&&a.from.col===4&&a.to.row===4&&a.to.col===4)!;
  it('completes a fixed-depth pass and repeats action, value, PV, depth, nodes and reason',()=>{
    const before=stateHash(state),a=runFixed(state,action,'legacy',CONDITIONS[2]),b=runFixed(state,action,'legacy',CONDITIONS[2]);
    expect(a.status).toBe('completed');expect(a.completedDepth).toBe(1);expect(repeatKey(a)).toBe(repeatKey(b));expect(stateHash(state)).toBe(before);
    const plain=analyzeAlphaBetaSearch(state,1,{pieceSafetyMode:'legacy'},()=>0,CONDITIONS[2].options);
    const probed=runFixed(state,null,'legacy',CONDITIONS[2]);
    expect(probed.result?.selectedAction).toEqual(plain.selectedAction);expect(probed.result?.selectedEvaluation).toBe(plain.selectedEvaluation);
    expect(probed.result?.principalVariation).toEqual(plain.principalVariation);
  });
  it('caps trace entries including horizon/q nodes and discards interrupted values',()=>{
    const r=runFixed(state,action,'legacy',CONDITIONS[0],{nodes:1,ms:3000});
    expect(r).toMatchObject({status:'interrupted',reason:'node-limit',result:null,completedDepth:0,validity:'unusable'});
    expect(r.nodes.normal+r.nodes.quiescence).toBe(1);expect(compareFixed(r,r).verdict).toBe('INDETERMINATE');
  });
  it('observes deadline transitions using a deterministic clock',()=>{
    let t=0;
    const r=runFixed(state,action,'legacy',CONDITIONS[0],{nodes:1500,ms:1},()=>++t);
    expect(r).toMatchObject({status:'interrupted',reason:'deadline',result:null,completedDepth:0});
    let tick=0;const diag=new SearchDiagnostics(false,false);
    const timed=analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state,4,1,{pieceSafetyMode:'legacy'},()=>tick++,CONDITIONS[0].options,diag);
    expect(timed.timedOut).toBe(true);expect(timed.completedDepth).toBe(0);
    expect(diag.depthOne?.status).toBe('interrupted');expect(completedTimedIteration(timed).status).toBe('unusable');
  });
  it('rejects illegal candidates, non-finite limits and unequal completed depths',()=>{
    expect(()=>runFixed(state,{...action,to:{row:0,col:0}},'legacy',CONDITIONS[0])).toThrow('not legal');
    expect(()=>runFixed(state,action,'legacy',CONDITIONS[0],{nodes:1500,ms:Infinity})).toThrow();
    const r=runFixed(state,action,'legacy',CONDITIONS[2]);
    expect(compareFixed(r,{...r,completedDepth:2}).verdict).toBe('INDETERMINATE');
    expect(compareFixed(r,{...r,result:{...r.result!,selectedEvaluation:Infinity}}).verdict).toBe('INDETERMINATE');
    expect(compareFixed(r,{...r,status:'error'}).verdict).toBe('INDETERMINATE');
    const result=r.result!, score=result.selectedEvaluation!+500;
    expect(compareFixed(r,{...r,result:{...result,selectedEvaluation:score,evaluationBreakdown:{...result.evaluationBreakdown,total:score}}}))
      .toMatchObject({verdict:'SUSPECTED',delta:500});
    expect(fixedInvalidReason(r,1)).toBeNull();
    for(const selectedEvaluation of [null,NaN,Infinity,-Infinity])
      expect(fixedInvalidReason({...r,result:{...result,selectedEvaluation}},1)).toBe('non-finite-evaluation');
    expect(fixedInvalidReason({...r,nodes:{...r.nodes,normal:r.nodes.normal+1}},1)).toBe('inconsistent-node-counts');
    expect(fixedInvalidReason({...r,validity:'unusable'},1)).toBe('invalid-completion');
    expect(fixedInvalidReason({...r,result:{...result,selectedEvaluation:score}},1)).toBe('inconsistent-result');
  });
  it('changes exactly one setting and holds the same budget for each ablation',()=>{
    const {name:_name,...base}=CONDITIONS[0];
    const expected=['options.quiescence.maxTacticalDepth','depth','options.moveOrdering'];
    CONDITIONS.slice(1).forEach((c,i)=>{const {name:_changed,...other}=c;expect(changedFields(base,other)).toEqual([expected[i]]);});
    expect(CONDITIONS[0]).toEqual({name:'baseline',depth:2,options:{
      moveOrdering:'standard',killerMoves:false,usePreviousIterationPv:false,useTranspositionTable:false,
      quiescence:{maxTacticalDepth:1,moveOrdering:'original',includeQuietPromotions:false,maxCheckEvasionExtensions:0},
    }});
    expect(BUDGET).toEqual({nodes:1500,ms:3000});
  });
  it('lists legal captures and recaptures without declaring a sacrifice erroneous',()=>{
    const info=inspectCandidate(state,action);
    expect(info.captures.length).toBeGreaterThan(0);expect(info.branches.length).toBe(info.captures.length);
    for(const branch of info.branches) {
      const after=apply(apply(state,action),branch.reply);
      for(const r of branch.legalRecaptures) expect(getLegalActions(after)).toContainEqual(r);
    }
    expect(info.exchangeScope).toContain('no minimax');
  });
  it('excludes pinned captures and unsafe check replies from branch inspection',()=>{
    const pinned=constructed('v4-pin',[[8,4,'king','sente'],[0,8,'king','gote'],[0,4,'rook','gote'],[7,4,'gold','sente'],[6,5,'pawn','gote']]);
    const legal=getLegalActions(pinned);
    expect(legal.some(a=>a.kind==='move'&&a.from.row===7&&a.from.col===4&&a.to.row===6&&a.to.col===5)).toBe(false);
    const check=constructed('v4-check',[[8,4,'king','sente'],[0,8,'king','gote'],[0,4,'rook','gote']]);
    for(const a of getLegalActions(check))expect(isPlayerInCheck(apply(check,a),'sente')).toBe(false);
  });
});
