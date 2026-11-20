import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { assessSyntheticAuth, signedPayload, CHALLENGE_SCHEMA, OBSERVATION_SCHEMA } from './stage-w1j-auth-contract.mjs';
import { readFileSync } from 'node:fs';

const hash = b => createHash('sha256').update(b).digest('hex');
function fixture() {
  const issuerKeys = generateKeyPairSync('ed25519');
  const observerKeys = generateKeyPairSync('ed25519');
  const at = 1_800_000_000_000, now = at + 200;
  const sealBytes = Buffer.from('{"scope":"synthetic","source":"fixture"}\n');
  const heads = ['a'.repeat(40), 'b'.repeat(40)];
  const sourceSha256 = hash('synthetic source bytes');
  const challenge = { schema: CHALLENGE_SCHEMA, scope: 'synthetic', nonce: '1'.repeat(64), issuedAt: at,
    expiresAt: at + 30_000, heads, sealSha256: hash(sealBytes), sourceSha256, issuerId: 'external-fixture-issuer' };
  const observation = { schema: OBSERVATION_SCHEMA, scope: 'synthetic', nonce: challenge.nonce,
    observedAt: at + 100, heads, sealSha256: challenge.sealSha256, sourceSha256,
    observerId: 'external-fixture-observer', observation: 'synthetic-source-readback' };
  const signed = (role, value, key) => sign(null, signedPayload(role,value),key).toString('base64');
  const facts = { challenge, observation, issuerPublicKey: issuerKeys.publicKey, observerPublicKey: observerKeys.publicKey,
    issuerSignature: signed('issuer',challenge,issuerKeys.privateKey), observerSignature: signed('observer',observation,observerKeys.privateKey),
    expectedIssuerId: challenge.issuerId, expectedObserverId: observation.observerId, pinnedHeads: [...heads],
    pinnedSourceSha256: sourceSha256, sealBytes, spentNonces: new Set(), now };
  return { facts, issuerKeys, observerKeys, resignIssuer: () => { facts.issuerSignature = signed('issuer', facts.challenge, issuerKeys.privateKey); },
    resignObserver: () => { facts.observerSignature = signed('observer', facts.observation, observerKeys.privateKey); } };
}
const evaluate = x => assessSyntheticAuth(x.facts);
test('valid signed synthetic envelope never permits comparison', () => {
  const r = evaluate(fixture()); assert.equal(r.status,'PASS'); assert.equal(r.permit,false);
  assert.equal(r.operationalGate,'BLOCKED'); assert.deepEqual(r.comparison,{old:0,new:0});
  assert.equal(r.authenticity,'NOT_ESTABLISHED');
});
const cases = [
  ['challenge issuer signature altered', f => f.facts.issuerSignature=(f.facts.issuerSignature[0] === 'A' ? 'B' : 'A')+f.facts.issuerSignature.slice(1), 'ISSUER_SIGNATURE_INVALID'],
  ['observer signature altered', f => f.facts.observerSignature=(f.facts.observerSignature[0] === 'A' ? 'B' : 'A')+f.facts.observerSignature.slice(1), 'OBSERVER_SIGNATURE_INVALID'],
  ['unsigned challenge substitution', f => f.facts.challenge.nonce='2'.repeat(64), 'ISSUER_SIGNATURE_INVALID'],
  ['unsigned report substitution', f => f.facts.observation.sourceSha256=hash('other'), 'OBSERVER_SIGNATURE_INVALID'],
  ['signed nonce rebind', f => { f.facts.observation.nonce='2'.repeat(64); f.resignObserver(); }, 'CHALLENGE_BINDING_MISMATCH'],
  ['signed target swap', f => { f.facts.observation.heads=[...f.facts.pinnedHeads].reverse(); f.resignObserver(); }, 'TARGET_BINDING_MISMATCH'],
  ['signed source swap', f => { f.facts.observation.sourceSha256=hash('other'); f.resignObserver(); }, 'SOURCE_PIN_MISMATCH'],
  ['signed seal swap', f => { f.facts.observation.sealSha256=hash('other'); f.resignObserver(); }, 'SEAL_BYTE_BINDING_MISMATCH'],
  ['seal raw byte mutated', f => f.facts.sealBytes=Buffer.concat([f.facts.sealBytes,Buffer.from(' ')]), 'SEAL_BYTE_BINDING_MISMATCH'],
  ['replayed challenge', f => f.facts.spentNonces.add(f.facts.challenge.nonce), 'CHALLENGE_ALREADY_CONSUMED'],
  ['expired challenge', f => f.facts.now=f.facts.challenge.expiresAt+1, 'CHALLENGE_TIME_INVALID'],
  ['future challenge', f => f.facts.now=f.facts.challenge.issuedAt-1, 'CHALLENGE_TIME_INVALID'],
  ['clock order inverted', f => {f.facts.observation.observedAt=f.facts.challenge.issuedAt-1;f.resignObserver();}, 'CHALLENGE_TIME_INVALID'],
  ['missing nonce ledger', f => f.facts.spentNonces=null, 'TRUST_ROOTS_UNAVAILABLE'],
  ['missing observer trust root', f => f.facts.observerPublicKey=null, 'TRUST_ROOTS_UNAVAILABLE'],
  ['single principal public key reused', f => {f.facts.observerPublicKey=f.facts.issuerPublicKey;}, 'TRUST_ROLES_NOT_SEPARATED'],
  ['wrong trusted identity', f => f.facts.expectedIssuerId='other', 'IDENTITY_BINDING_MISMATCH'],
  ['unsupported live scope', f => {f.facts.challenge.scope='inspection';f.resignIssuer();}, 'ENVELOPE_SCHEMA_INVALID'],
  ['extra field injected', f => {f.facts.observation.authorized=true;}, 'ENVELOPE_SCHEMA_INVALID'],
  ['missing seal bytes', f => f.facts.sealBytes=null, 'SEAL_BYTES_MISSING'],
];
for (const [name, mutate, expected] of cases) test(name, () => {
  const f=fixture();mutate(f);const r=evaluate(f);assert.notEqual(r.status,'PASS',name);
  assert.equal(r.reason,expected,JSON.stringify(r));assert.equal(r.permit,false);
});
test('signed inputs cannot enable the fixed-comparison execution gate', async () => {
  const url = new URL('./stage-w1g-gate.mjs', import.meta.url);
  const source = readFileSync(url,'utf8');
  assert.match(source, /export function fixedComparisonGate\(/);
  const gate = await import(url.href);
  const r = gate.fixedComparisonGate(evaluate(fixture()));
  assert.equal(r.status,'BLOCKED'); assert.equal(r.comparison.authorized,false);
  assert.deepEqual([r.comparison.old,r.comparison.new],[0,0]);
});
