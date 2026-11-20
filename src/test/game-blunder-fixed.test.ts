import {describe,it,expect} from 'vitest';
import {constructed} from '../../scripts/benchmarks/tacticalPositions';
import {fixedCandidate,fixedOptions,stableKey} from '../../scripts/benchmarks/gameBlunderFixed';
import {getLegalActions} from '../domain/shogi/legalActions';
import {stateHash} from '../../scripts/benchmarks/matchJournal';
import {evaluateComparison} from '../../scripts/benchmarks/gameBlunderDiagnosis';

describe('fixed candidate diagnosis; constructed positions',()=>{
  const s=constructed('fixed-candidate',[[8,8,'king','sente'],[0,8,'king','gote'],[5,4,'rook','sente'],[4,4,'pawn','gote'],[3,4,'silver','gote']]);
  const action=getLegalActions(s).find(a=>a.kind==='move'&&a.from.row===5&&a.from.col===4&&a.to.row===4&&a.to.col===4)!;
  it('fixed depth terminates and repeats same result and node count without mutation',()=>{
    const before=stateHash(s), limits={depth:1,nodes:1500,ms:3000};
    const a=fixedCandidate(s,action,'legacy',0,limits),b=fixedCandidate(s,action,'legacy',0,limits);
    expect(a.status).toBe('completed');expect(a.result?.depth).toBe(1);expect(stableKey(a)).toBe(stableKey(b));expect(stateHash(s)).toBe(before);
  });
  it('enforces node cap and never exposes a partial score',()=>{
    const r=fixedCandidate(s,action,'legacy',1,{depth:2,nodes:1,ms:3000});
    expect(r.status).toBe('interrupted');expect(r.reason).toBe('node-limit');expect(r.nodes).toBe(1);expect(r.result).toBeNull();
    expect(evaluateComparison(null,null).verdict).toBe('INDETERMINATE');
  });
  it('rejects a candidate not present in legal enumeration',()=>{
    expect(()=>fixedCandidate(s,{...action,to:{row:0,col:0}},'legacy',0)).toThrow('not legal');
  });
  it('changes only tactical depth between the controlled conditions',()=>{
    const a=fixedOptions(0),b=fixedOptions(1);expect({...a,quiescence:{...a.quiescence,maxTacticalDepth:1}}).toEqual(b);
  });
});
