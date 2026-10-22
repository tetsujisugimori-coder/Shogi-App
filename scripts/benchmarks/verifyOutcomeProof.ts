import assert from 'node:assert/strict';
import { getLegalActions } from '../../src/domain/shogi/legalActions';
import type { BoardState } from '../../src/types/shogi';
import { MAX_BYTES, digest, encode, validateRequest, startState, terminalState, terminalOutcome, play,
  type Certificate, type ProofNode, type Outcome } from './outcomeProof';

export interface Verification { valid: boolean; outcome: Outcome | null; nodes: number; reason: string }
const keys=(v:object,expected:string[])=>assert.deepEqual(Object.keys(v).sort(),expected.sort(),'unexpected or missing fields');
/** Separate traversal: replays every recorded branch, derives quantifiers and
 * terminal outcomes anew. The expected request hash must come from the caller's
 * trusted observation/manifest, never from the untrusted certificate itself. */
export function verifyProof(c: Certificate, expectedRequestHash: string,
  limits={nodes:100000,milliseconds:10000,bytes:MAX_BYTES}, now=()=>performance.now()):Verification {
  let nodes=0;
  const began=now(), seen=new Set<ProofNode>();
  try {
    assert.ok(Number.isSafeInteger(limits.nodes)&&limits.nodes>0&&limits.nodes<=1000000);
    assert.ok(Number.isFinite(limits.milliseconds)&&limits.milliseconds>=0&&limits.milliseconds<=60000);
    assert.ok(Number.isSafeInteger(limits.bytes)&&limits.bytes>0&&limits.bytes<=MAX_BYTES);
    // JSON serialization also rejects cyclic runtime inputs before traversal.
    assert.ok(Buffer.byteLength(encode(c))<=limits.bytes,'verification byte limit');
    keys(c,['version','request','requestHash','outcome','proof']); assert.equal(c.version,1);
    validateRequest(c.request);
    assert.match(expectedRequestHash,/^[a-f0-9]{64}$/);
    assert.equal(c.requestHash,expectedRequestHash,'request identity mismatch');
    assert.equal(digest(c.request),expectedRequestHash,'input/history/perspective changed');
    assert.ok(Buffer.byteLength(encode(c))<=c.request.limits.bytes,'record budget exceeded');
    const r=c.request;
    function check(input:BoardState,p:ProofNode,depth:number):Outcome {
      assert.ok(++nodes<=limits.nodes && now()-began<limits.milliseconds,'verification incomplete: resource limit');
      assert.ok(depth<=r.limits.depth && depth<=32,'depth limit');
      assert.ok(p && !seen.has(p),'cyclic/shared/invalid node'); seen.add(p);
      keys(p,['stateHash','turn','outcome','kind','terminal','legal','branches']);
      const s=terminalState(input), legal=getLegalActions(s);
      assert.equal(p.stateHash,digest(s),'state/history mismatch'); assert.equal(p.turn,s.turn);
      assert.deepEqual(p.legal,legal,'legal action identity mismatch');
      assert.ok(Array.isArray(p.branches));
      if(s.status==='ended') {
        assert.equal(p.kind,'terminal'); assert.deepEqual(p.terminal,s.result);
        assert.equal(p.branches.length,0);
        assert.equal(p.outcome,terminalOutcome(s,r.perspective));
      } else {
        assert.equal(p.terminal,null); assert.ok(legal.length>0);
        const preferred=s.turn===r.perspective?'proven-win':'proven-loss';
        if(p.kind==='exists') {assert.equal(p.outcome,preferred);assert.equal(p.branches.length,1);}
        else {
          assert.equal(p.kind,'all'); assert.notEqual(p.outcome,preferred);
          const actual=p.branches.map(b=>encode(b.action)).sort();
          assert.deepEqual(actual,legal.map(encode).sort(),'missing/duplicate/illegal universal branch');
        }
        for(const b of p.branches) {
          keys(b,['action','child']);
          assert.equal(check(play(s,b.action),b.child,depth+1),p.outcome,'branch outcome mismatch');
        }
      }
      assert.ok(['proven-win','proven-loss','proven-draw'].includes(p.outcome));
      assert.ok(now()-began<limits.milliseconds,'verification incomplete: time');
      return p.outcome;
    }
    const outcome=check(startState(r),c.proof,r.candidate?1:0);
    assert.equal(c.outcome,outcome);
    assert.ok(nodes<=r.limits.nodes,'search node budget exceeded');
    return {valid:true,outcome,nodes,reason:'all required branches replayed; distance optimality not claimed'};
  } catch(e) {return {valid:false,outcome:null,nodes,reason:String(e)};}
}
