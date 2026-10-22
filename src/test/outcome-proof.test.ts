import { describe,it,expect } from 'vitest';
import { mkdtempSync,writeFileSync,readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prove,digest,encode,play,terminalState,terminalOutcome, type Request,type Certificate,type ProofNode } from '../../scripts/benchmarks/outcomeProof';
import { verifyProof } from '../../scripts/benchmarks/verifyOutcomeProof';
import { classifyWithProofs } from '../../scripts/benchmarks/outcomeQuality';
import { tacticalPositions,rotate,constructed,type TacticalPosition } from '../../scripts/benchmarks/tacticalPositions';
import { qualityReference } from '../../scripts/benchmarks/tacticalQuality';
import { getLegalActions } from '../domain/shogi/legalActions';
import { createPositionKey } from '../domain/shogi/repetition';
import { isPlayerInCheck } from '../domain/shogi/checkmate';
import { analyzeAlphaBetaSearch as fixed } from '../domain/shogi/twoPlyAlphaBetaAi';
import type { BoardState,Player } from '../types/shogi';
import { noLegalActionsCase } from './no-legal-actions.cases';

const ps=tacticalPositions(),three=ps.find(p=>p.id==='mate-three')!,mate=ps.find(p=>p.id==='mate-sente')!;
const req=(state:BoardState,depth=3):Request=>({state,candidate:null,perspective:state.turn,
  source:{sha:'0'.repeat(40),filesHash:'a'.repeat(64)},limits:{depth,nodes:6000,milliseconds:10000,bytes:4000000},order:'forward'});
const cert=(r:Request)=>{const p=prove(r);expect(p.status).not.toBe('unknown');return p.certificate!;};
const verify=(c:Certificate)=>verifyProof(c,digest(c.request));
function allNodes(p:ProofNode):ProofNode[] {return [p,...p.branches.flatMap(b=>allNodes(b.child))];}

describe('bounded diagnostic outcome proofs',()=>{
  it.each(['sente','gote'] as const)('proves %s wins and losses with fixed perspective',player=>{
    const s=player==='sente'?three.state:rotate(three.state,'rotated');
    const win=cert(req(s));expect(win.outcome).toBe('proven-win');expect(verify(win).valid).toBe(true);
    const loss=cert({...req(s),perspective:player==='sente'?'gote':'sente'});
    expect(loss.outcome).toBe('proven-loss');expect(verify(loss).valid).toBe(true);
  });
  it('uses a quiet witness and includes nonchecking defending replies',()=>{
    const c=cert(req(three.state));expect(c.proof.kind).toBe('exists');expect(c.proof.branches).toHaveLength(1);
    const reply=play(three.state,c.proof.branches[0].action);
    expect(isPlayerInCheck(reply,reply.turn)).toBe(false);
    const all=allNodes(c.proof).find(n=>n.kind==='all')!;expect(all.branches.length).toBeGreaterThan(0);
    expect(all.branches.map(b=>b.action)).toEqual(all.legal);
    expect(prove(req(three.state,2)).status).toBe('unknown');
  });
  it('does not turn a winning alternative into proof for a move with an escape',()=>{
    const winning=cert(req(three.state));
    const witness=winning.proof.branches[0].action;
    const escape=getLegalActions(three.state).find(a=>encode(a)!==encode(witness))!;
    expect(prove({...req(three.state,1),candidate:escape}).status).toBe('unknown');
  });
  it('distinguishes completed existential proof from prior depth-unknown branches',()=>{
    const p=prove(req(three.state));expect(p.finished).toBe('proof-complete');
    expect(p.stops.depth).toBeGreaterThan(0);expect(verify(p.certificate!).valid).toBe(true);
  });
  it('cannot complete a universal node with even its final required branch unfinished',()=>{
    const request=req(ps.find(p=>p.id==='resistance')!.state,4);
    const completed=prove(request);expect(completed.certificate!.proof.kind).toBe('all');
    expect(completed.certificate!.proof.branches.length).toBeGreaterThan(1);
    const partial=prove({...request,limits:{...request.limits,nodes:completed.nodes-1}});
    expect(partial.status).toBe('unknown');expect(partial.stops.nodes).toBeGreaterThan(0);
    expect(partial.frontier.some(f=>f.reason==='nodes'&&f.path.length>0)).toBe(true);
    for(const f of partial.frontier){let s=request.state;for(const a of f.path)s=play(s,a);expect(digest(s)).toBe(f.stateHash);}
  });
  it.each(['depth','nodes','time','record','interrupted'] as const)('never proves on %s exhaustion',kind=>{
    const r=req(three.state);
    if(kind==='depth')r.limits.depth=0;if(kind==='nodes')r.limits.nodes=1;
    if(kind==='time')r.limits.milliseconds=0;if(kind==='record')r.limits.bytes=1;
    const p=prove(r,{interrupted:()=>kind==='interrupted'});
    expect(p).toMatchObject({status:'unknown',certificate:null,finished:'incomplete'});
    expect(p.stops[kind]).toBeGreaterThan(0);
    expect(p.frontier.length).toBeLessThanOrEqual(8);
  });
  it('handles exceptions as unknown, without converting illegal candidate to a loss',()=>{
    const r={...req(three.state),candidate:{...getLegalActions(three.state)[0],to:{row:99,col:99}}};
    expect(prove(r)).toMatchObject({status:'unknown',stops:{error:1},certificate:null});
    expect(prove(req(three.state),{interrupted:()=>{throw Error('cancel failure');}}).status).toBe('unknown');
  });
  it('is nonmutating and reproducible and agrees with a separate full-width outcome set',()=>{
    // Enumerate all terminal possibilities at the horizon; no short-circuit or certificates.
    function full(s:BoardState,depth:number,root:Player):[number,number] {
      s=terminalState(s);if(s.status==='ended'){const n=s.result!.winner===null?0:s.result!.winner===root?1:-1;return [n,n];}
      if(!depth)return [-1,1];
      const values=getLegalActions(s).map(a=>full(play(s,a),depth-1,root));
      const reduce=s.turn===root?Math.max:Math.min;
      return [reduce(...values.map(v=>v[0])),reduce(...values.map(v=>v[1]))];
    }
    const r=req(three.state),before=encode(r),a=prove(r),b=prove(r),reverse=prove({...r,order:'reverse'});
    expect(encode(r)).toBe(before);expect(a).toEqual(b);expect(reverse.status).toBe(a.status);
    expect(full(three.state,3,three.state.turn)).toEqual([1,1]);
    expect(full(three.state,3,'gote')).toEqual([-1,-1]);
    expect(full(three.state,2,three.state.turn)).toEqual([-1,1]);
  });
  it('keeps the 500-move draw distinct and records the actual reason',()=>{
    const s=constructed('draw',[[8,8,'king','sente'],[0,0,'king','gote']]);s.moveNumber=500;
    const c=cert({...req(s,1),candidate:getLegalActions(s)[0]});
    expect(c.outcome).toBe('proven-draw');expect(c.proof.terminal?.endReason).toBe('five_hundred_move_jishogi');expect(verify(c).valid).toBe(true);
  });
  it('replays fourfold repetition and continuous-check history rather than board cycles',()=>{
    const s=structuredClone(three.state),a=getLegalActions(s)[0],child=play(s,a),key=createPositionKey(child);
    s.positionHistory=[0,1,2].map(i=>({key,historyIndex:i,movedBy:'gote' as const,gaveCheck:false}));
    s.positionHistory.push({key:createPositionKey(s),historyIndex:3,movedBy:null,gaveCheck:false});
    const c=cert({...req(s,1),candidate:a});expect(c.outcome).toBe('proven-draw');expect(c.proof.terminal?.endReason).toBe('repetition');
    expect(verify(c).valid).toBe(true);
    s.positionHistory=s.positionHistory.slice(-1);expect(prove({...req(s,1),candidate:a}).status).toBe('unknown');
  });
  it('adjudicates zero legal noncheck as a win, not checkmate',()=>{
    const {before,coord}=noLegalActionsCase();
    const a=getLegalActions(before).find(a=>a.kind==='move'&&encode(a.from)===encode(coord(5,0))&&encode(a.to)===encode(coord(6,0)))!;
    const c=cert({...req(before,1),candidate:a});
    expect(c.outcome).toBe('proven-win');expect(c.proof.terminal?.endReason).toBe('no_legal_actions');
    expect(verify(c).valid).toBe(true);
    const ended=play(before,a),active={...ended,status:'active' as const,result:null};
    expect(getLegalActions(active)).toHaveLength(0);expect(isPlayerInCheck(active,active.turn)).toBe(false);
    expect(cert(req(active,0)).outcome).toBe('proven-loss');
    expect(cert(req(ended,0)).outcome).toBe('proven-loss');
    const forged=structuredClone(ended);if(!forged.result||forged.result.winner===null)throw Error('decisive fixture required');
    forged.result.winner='sente';
    expect(prove(req(forged)).status).toBe('unknown');
  });
  it('uses actual legal cycle histories for repetition and perpetual-check loss',()=>{
    for(const checks of [false,true]) {
      let s=checks?constructed('checks',[[8,8,'king','sente'],[0,4,'king','gote'],[1,3,'rook','sente']]):
        constructed('cycles',[[8,4,'king','sente'],[0,4,'king','gote']]);
      const cycle=checks?[[1,3,1,4],[0,4,0,3],[1,4,1,3],[0,3,0,4]]:[[8,4,8,3],[0,4,0,3],[8,3,8,4],[0,3,0,4]];
      for(let ply=0;ply<11;ply++) {
        const [fr,fc,tr,tc]=cycle[ply%4];
        const a=getLegalActions(s).find(a=>a.kind==='move'&&a.from.row===fr&&a.from.col===fc&&a.to.row===tr&&a.to.col===tc)!;
        s=play(s,a);
      }
      const [fr,fc,tr,tc]=cycle[3];
      const a=getLegalActions(s).find(a=>a.kind==='move'&&a.from.row===fr&&a.from.col===fc&&a.to.row===tr&&a.to.col===tc)!;
      const c=cert({...req(s,1),candidate:a,perspective:'sente'});
      expect(c.outcome).toBe(checks?'proven-loss':'proven-draw');
      expect(c.proof.terminal?.endReason).toBe(checks?'foul_loss':'repetition');expect(verify(c).valid).toBe(true);
    }
  });
  it('preserves the 500-move continuous-check waiting state and ends when checking stops',()=>{
    const s=constructed('limit-check',[[8,8,'king','sente'],[0,4,'king','gote'],[1,3,'rook','sente']]);s.moveNumber=500;
    const check=getLegalActions(s).find(a=>a.kind==='move'&&a.from.row===1&&a.to.row===1&&a.to.col===4&&a.promotion==='decline')!;
    const pending=play(s,check);expect(pending.moveLimitJishogi?.kind).toBe('awaiting_continuous_check_end');
    expect(prove({...req(s,1),candidate:check}).status).toBe('unknown');
    const evaded=play(pending,getLegalActions(pending)[0]);
    const quiet=getLegalActions(evaded).find(a=>play(evaded,a).result?.endReason==='five_hundred_move_jishogi')!;
    const c=cert({...req(evaded,1),candidate:quiet});expect(c.outcome).toBe('proven-draw');expect(verify(c).valid).toBe(true);
  });
  it.each(['missing','duplicate','illegal','winner','reason','leaf','turn','history','perspective','reference','cycle'] as const)('rejects %s tampering',kind=>{
    const c=structuredClone(cert(req(three.state))),expected=digest(c.request);
    const universal=allNodes(c.proof).find(p=>p.kind==='all')!,leaf=allNodes(c.proof).find(p=>p.kind==='terminal')!;
    if(kind==='missing')universal.branches.pop();
    if(kind==='duplicate')universal.branches.push(structuredClone(universal.branches[0]));
    if(kind==='illegal')universal.branches[0].action.to.row=99;
    if(kind==='winner')leaf.terminal!.winner='gote';
    if(kind==='reason')leaf.terminal!.endReason='resignation';
    if(kind==='leaf'){c.proof.kind='terminal';c.proof.branches=[];}
    if(kind==='turn')leaf.turn=leaf.turn==='sente'?'gote':'sente';
    if(kind==='history')c.request.state.positionHistory=[];
    if(kind==='perspective')c.request.perspective='gote';
    if(kind==='reference')(c.proof as unknown as Record<string,unknown>).ref='missing';
    if(kind==='cycle')universal.branches[0].child=c.proof;
    expect(verifyProof(c,expected).valid).toBe(false);
  });
  it('rejects every verification budget exhaustion',()=>{
    const c=cert(req(three.state));
    for(const limits of [{nodes:1,milliseconds:10000,bytes:4000000},{nodes:6000,milliseconds:0,bytes:4000000},{nodes:6000,milliseconds:10000,bytes:1}])
      expect(verifyProof(c,digest(c.request),limits).valid).toBe(false);
  });
  it('roundtrips saved proofs and exposes CLI success/rejection/usage exit codes',()=>{
    const c=cert(req(three.state)),dir=mkdtempSync(path.join(os.tmpdir(),'proof-')),file=path.join(dir,'proof.json');
    writeFileSync(file,encode(c));expect(verify(JSON.parse(readFileSync(file,'utf8'))).valid).toBe(true);
    const command=(args:string[])=>spawnSync(process.execPath,['--import','tsx','scripts/verify-outcome-proof.ts',...args],{encoding:'utf8'});
    const good=command([file,c.requestHash]);expect(good.status).toBe(0);expect(JSON.parse(good.stdout).valid).toBe(true);
    expect(command([file,'a'.repeat(64)]).status).toBe(1);expect(command([]).status).toBe(2);
  });
});

describe('additive v3 proof classification (artificial history fixture)',()=>{
  function fixture() {
    const p=structuredClone(mate);
    const action=getLegalActions(p.state).find(a=>{const s=play(p.state,a);return s.status==='check';})!;
    const key=createPositionKey(play(p.state,action));
    p.state.positionHistory=[0,1,2].map(i=>({key,historyIndex:i,movedBy:'sente' as const,gaveCheck:true}));
    p.state.positionHistory.push({key:createPositionKey(p.state),historyIndex:3,movedBy:'gote',gaveCheck:false});
    const ref=qualityReference(p,1),r=fixed(p.state,1);
    const alt=ref.candidates.find(c=>c.value.breakdown.terminal==='win')!.action;
    const lose=cert({...req(p.state,1),candidate:action}),win=cert({...req(p.state,1),candidate:alt});
    expect(lose.outcome).toBe('proven-loss');expect(lose.proof.terminal?.endReason).toBe('foul_loss');
    return {p,ref,r:{...r,selectedAction:action},lose,win};
  }
  it('requires both replay-verified outcomes, not just a winning alternative',()=>{
    const {p,ref,r,lose,win}=fixture();
    // Prevent the legacy closed-tree route here, exercising only the added route.
    ref.candidates.forEach(c=>c.closed=false);
    expect(classifyWithProofs(p,ref,r,[win]).quality).not.toBe('ProvenError');
    expect(classifyWithProofs(p,ref,r,[lose,win]).quality).toBe('ProvenError');
    const corrupt=structuredClone(lose);corrupt.proof.terminal!.winner='sente';
    expect(classifyWithProofs(p,ref,r,[corrupt,win]).quality).not.toBe('ProvenError');
  });
  it('keeps an actually horizon-unknown selected move below ProvenError despite an alternative win',()=>{
    const p=three,ref=qualityReference(p),r=fixed(p.state,1);
    const selected=ref.candidates.find(c=>!c.closed&&c.value.breakdown.terminal===null)!.action;
    expect(prove({...req(p.state,1),candidate:selected}).status).toBe('unknown');
    const witness=cert(req(p.state)).proof.branches[0].action;
    const win=cert({...req(p.state),candidate:witness});
    expect(classifyWithProofs(p,ref,{...r,selectedAction:selected},[win]).quality).not.toBe('ProvenError');
  });
  it('does not compare two winning certificates by witness length',()=>{
    const p=ps.find(p=>p.id==='mixed-distance')!,ref=qualityReference(p,1),r=fixed(p.state,1);
    const wins=ref.candidates.filter(c=>c.value.breakdown.terminal==='win').slice(0,2);
    const certificates=wins.map(c=>cert({...req(p.state,1),candidate:c.action}));
    expect(classifyWithProofs(p,ref,{...r,selectedAction:wins[0].action},certificates).quality).toBe('NoObservedDifference');
  });
  it('keeps partial/fallback/incomplete reference gates and completed-then-timeout semantics',()=>{
    const {p,ref,r,lose,win}=fixture();ref.candidates.forEach(c=>c.closed=false);
    for(const resultSource of ['partial-root','fallback'])expect(classifyWithProofs(p,ref,{...r,resultSource,completedDepth:0,depth:0} as never,[lose,win]).quality).toBe('Inconclusive');
    expect(classifyWithProofs(p,{...ref,stopped:true},r,[lose,win]).quality).toBe('Inconclusive');
    expect(classifyWithProofs(p,ref,{...r,resultSource:'completed-iteration',completedDepth:1,timedOut:true} as never,[lose,win]).quality).toBe('ProvenError');
    expect(()=>classifyWithProofs({...p,state:three.state} as TacticalPosition,ref,r,[win])).toThrow();
  });
});
