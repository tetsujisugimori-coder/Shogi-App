import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { BoardState, Player, GameResult } from '../../src/types/shogi';
import { getLegalActions, executeLegalAction, type LegalAction } from '../../src/domain/shogi/legalActions';
import { adjudicateNoLegalActions } from '../../src/domain/shogi/adjudication';
import { createPositionKey } from '../../src/domain/shogi/repetition';
import { isPlayerInCheck } from '../../src/domain/shogi/checkmate';

// Diagnostic format only. No engine scores, caches, qsearch or distance ordering.
export const MAX_BYTES = 4 * 1024 * 1024;
export const encode = (v: unknown) => JSON.stringify(v);
export const digest = (v: unknown) => createHash('sha256').update(encode(v)).digest('hex');
export type Outcome = 'proven-win' | 'proven-loss' | 'proven-draw';
export type Stop = 'depth' | 'nodes' | 'time' | 'record' | 'interrupted' | 'error';
export interface Limits { depth: number; nodes: number; milliseconds: number; bytes: number }
export interface Request {
  state: BoardState; candidate: LegalAction | null; perspective: Player;
  source: { sha: string; filesHash: string }; limits: Limits; order: 'forward' | 'reverse';
}
export interface ProofNode {
  stateHash: string; turn: Player; outcome: Outcome;
  kind: 'terminal' | 'exists' | 'all';
  terminal: GameResult | null;
  legal: LegalAction[];
  branches: { action: LegalAction; child: ProofNode }[];
}
export interface Certificate { version: 1; request: Request; requestHash: string; outcome: Outcome; proof: ProofNode }
export interface ProofResult {
  status: Outcome | 'unknown'; certificate: Certificate | null; nodes: number;
  stops: Partial<Record<Stop, number>>; finished: 'proof-complete' | 'incomplete'; error: string | null;
  frontier: { reason: Stop; stateHash: string; path: LegalAction[] }[];
  frontierOmitted: number;
}
export function validateRequest(r: Request) {
  assert.ok(r && ['sente','gote'].includes(r.perspective));
  assert.ok(['forward','reverse'].includes(r.order));
  assert.match(r.source.sha,/^[a-f0-9]{40}$/); assert.match(r.source.filesHash,/^[a-f0-9]{64}$/);
  const l=r.limits;
  assert.ok(Number.isSafeInteger(l.depth)&&l.depth>=0&&l.depth<=32);
  assert.ok(Number.isSafeInteger(l.nodes)&&l.nodes>=1&&l.nodes<=1000000);
  assert.ok(Number.isFinite(l.milliseconds)&&l.milliseconds>=0&&l.milliseconds<=60000);
  assert.ok(Number.isSafeInteger(l.bytes)&&l.bytes>=1&&l.bytes<=MAX_BYTES);
  assert.ok(r.state && ['active','check','ended'].includes(r.state.status));
  assert.ok(Array.isArray(r.state.history)&&Array.isArray(r.state.positionHistory)&&Array.isArray(r.state.positionSnapshots));
  assert.equal(r.state.positionHistory.at(-1)?.key,createPositionKey(r.state),'history tail must match; do not normalize away history');
  for(const player of ['sente','gote'] as const)
    assert.equal(r.state.squares.flat().filter(s=>s.piece?.type==='king'&&s.piece.player===player).length,1,'exactly two kings required');
  if(r.state.status!=='ended') {
    assert.equal(r.state.result,null);
    assert.equal(r.state.status==='check',isPlayerInCheck(r.state,r.state.turn));
  }
}
export function play(s: BoardState, a: LegalAction): BoardState {
  assert.ok(getLegalActions(s).some(b=>encode(a)===encode(b)),'illegal action');
  const next=executeLegalAction(s,a,{proposer:'local_ai'});
  assert.equal(next.type,'applied'); if(next.type!=='applied') throw Error('application failed');
  return next.state;
}
/** An ended input without a replayable preceding move is accepted only when
 * no-legal adjudication independently reproduces its entire result. Declarations
 * and historical terminal inputs should instead be supplied before their move. */
export function startState(r: Request): BoardState {
  const s=r.state;
  if(s.status==='ended') {
    const adjudicated=adjudicateNoLegalActions({...s,status:'active',result:null});
    assert.ok(adjudicated,'unsupported terminal input'); assert.deepEqual(adjudicated.result,s.result);
  }
  return r.candidate ? play(s,r.candidate) : s;
}
export function terminalState(s: BoardState): BoardState {
  return s.status==='ended' ? s : adjudicateNoLegalActions(s) ?? s;
}
export function terminalOutcome(s: BoardState, perspective: Player): Outcome {
  assert.equal(s.status,'ended'); assert.ok(s.result,'missing terminal result');
  return s.result.winner===null ? 'proven-draw' : s.result.winner===perspective ? 'proven-win' : 'proven-loss';
}

export function prove(request: Request, control: { now?: ()=>number; interrupted?: ()=>boolean } = {}): ProofResult {
  validateRequest(request);
  const r=JSON.parse(encode(request)) as Request; // never mutate caller input
  const now=control.now??(()=>performance.now()), began=now();
  let nodes=0, recorded=0;
  const stops: ProofResult['stops']={};
  const frontier:ProofResult['frontier']=[];
  let frontierOmitted=0,frontierBytes=0,currentState=r.state,currentPath:LegalAction[]=[];
  const note=(s:Stop,stateHash?:string,path=currentPath)=>{
    stops[s]=(stops[s]??0)+1;
    if(frontier.length>=8||frontierBytes>=Math.min(32768,r.limits.bytes)) {frontierOmitted++;return;}
    const sample={reason:s,stateHash:stateHash??digest(currentState),path:[...path]};
    const size=Buffer.byteLength(encode(sample));
    if(frontierBytes+size>Math.min(32768,r.limits.bytes)){frontierOmitted++;return;}
    frontierBytes+=size;frontier.push(sample);
  };
  const unknown=(error:string|null=null):ProofResult=>({status:'unknown',certificate:null,nodes,stops,finished:'incomplete',error,frontier,frontierOmitted});
  const halt=()=>{
    if(control.interrupted?.()) {note('interrupted');return true;}
    if(now()-began>=r.limits.milliseconds) {note('time');return true;}
    if(nodes>=r.limits.nodes) {note('nodes');return true;}
    return false;
  };
  const retain=(p:ProofNode,path:LegalAction[]):ProofNode|null=>{
    // Count each retained node once, including discarded witnesses. Conservative
    // memory budget, followed by an exact whole-file check before publication.
    recorded+=Buffer.byteLength(encode({...p,branches:p.branches.map(b=>({action:b.action}))}));
    if(recorded>r.limits.bytes) {note('record',p.stateHash,path);return null;} return p;
  };
  function visit(input:BoardState,left:number,path:LegalAction[]):ProofNode|null {
    currentState=input;currentPath=path;
    if(halt()) return null; nodes++;
    const s=terminalState(input), legal=getLegalActions(s);
    if(control.interrupted?.()) {note('interrupted');return null;}
    if(now()-began>=r.limits.milliseconds) {note('time');return null;}
    const base={stateHash:digest(s),turn:s.turn,legal};
    if(s.status==='ended') return retain({...base,outcome:terminalOutcome(s,r.perspective),kind:'terminal',terminal:s.result!,branches:[]},path);
    assert.ok(legal.length>0,'unadjudicated no-legal node');
    if(left===0) {note('depth');return null;}
    const preferred:Outcome=s.turn===r.perspective?'proven-win':'proven-loss';
    const branches:ProofNode['branches']=[];
    for(const action of r.order==='reverse'?[...legal].reverse():legal) {
      const child=visit(play(s,action),left-1,[...path,action]);
      if(child?.outcome===preferred) return retain({...base,outcome:preferred,kind:'exists',terminal:null,branches:[{action,child}]},path);
      if(child) branches.push({action,child});
      // Depth failures are local. Global exhausted budgets cannot recover.
      if(stops.nodes||stops.time||stops.record||stops.interrupted) return null;
    }
    if(branches.length!==legal.length) return null;
    const outcome=branches[0].child.outcome;
    if(!branches.every(b=>b.child.outcome===outcome)) return null;
    return retain({...base,outcome,kind:'all',terminal:null,branches},path);
  }
  try {
    // Candidate application counts as the first ply, but not a search choice.
    if(r.candidate && r.limits.depth===0) {note('depth');return unknown();}
    if(halt()) return unknown();
    const proof=visit(startState(r),r.limits.depth-(r.candidate?1:0),r.candidate?[r.candidate]:[]);
    if(proof) {
      const certificate:Certificate={version:1,request:r,requestHash:digest(r),outcome:proof.outcome,proof};
      if(Buffer.byteLength(encode(certificate))<=r.limits.bytes) return {status:proof.outcome,certificate,nodes,stops,finished:'proof-complete',error:null,frontier,frontierOmitted};
      note('record',proof.stateHash,r.candidate?[r.candidate]:[]);
    }
    return unknown();
  } catch(e) {
    note('error'); return unknown(String(e));
  }
}
