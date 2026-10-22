import assert from 'node:assert/strict';
import type { TacticalPosition } from './tacticalPositions';
import { qualityClassify, type QualityReference } from './tacticalQuality';
import { json, type Result } from './tacticalDiagnostics';
import { digest, type Certificate } from './outcomeProof';
import { verifyProof } from './verifyOutcomeProof';

/** Additive contract. v3 completion/reference gates and all-terminal evidence
 * remain intact. AND/OR evidence adds only strict loss -> win, never distance. */
export function classifyWithProofs(p:TacticalPosition,ref:QualityReference,r:Result|null,
  certificates:Certificate[]) {
  const legacy=qualityClassify(p,ref,r);
  const checked=certificates.map(c=>{
    assert.equal(json(c.request.state),json(p.state),'certificate input mismatch');
    assert.equal(c.request.perspective,p.state.turn,'certificate perspective mismatch');
    assert.ok(c.request.candidate,'candidate certificate required');
    const verification=verifyProof(c,digest(c.request));
    return {candidate:c.request.candidate,requestHash:c.requestHash,verification};
  });
  if(legacy.quality==='Inconclusive'||!r) return {...legacy,proofEvidence:checked};
  const selected=checked.find(c=>json(c.candidate)===json(r.selectedAction)&&c.verification.valid&&c.verification.outcome==='proven-loss');
  const better=checked.find(c=>json(c.candidate)!==json(r.selectedAction)&&c.verification.valid&&c.verification.outcome==='proven-win');
  return selected&&better ? {...legacy,quality:'ProvenError' as const,
    evidence:'reverified AND/OR selected loss and alternative win; strict outcome disadvantage; no distance comparison',proofEvidence:checked}
    : {...legacy,proofEvidence:checked};
}
