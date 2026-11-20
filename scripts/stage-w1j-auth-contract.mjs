/** W1j offline synthetic challenge/observation contract. NEVER an admission path. */
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const CHALLENGE_SCHEMA = 'stage-w1j-challenge/1';
export const OBSERVATION_SCHEMA = 'stage-w1j-observation/1';
const shaPattern = /^[a-f0-9]{64}$/;
const oidPattern = /^[a-f0-9]{40}$/;
const nonempty = x => typeof x === 'string' && x.length > 0;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const exactly = (value, fields) => object(value) && isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort());
const safeTime = n => Number.isSafeInteger(n) && n >= 0;
const headsValid = x => Array.isArray(x) && x.length === 2 && x.every(h => typeof h === 'string' && oidPattern.test(h)) && x[0] !== x[1];
const result = (status, reason) => ({ status, reason, contract: 'SYNTHETIC_ONLY', authenticity: 'NOT_ESTABLISHED', operationalGate: 'BLOCKED', permit: false, comparison: { old: 0, new: 0 } });

/** Fixed byte order and role-domain separation. No arbitrary stringification of attacker-controlled key order. */
export function signedPayload(role, record) {
  const fields = role === 'issuer'
    ? ['schema', 'scope', 'nonce', 'issuedAt', 'expiresAt', 'heads', 'sealSha256', 'sourceSha256', 'issuerId']
    : role === 'observer'
      ? ['schema', 'scope', 'nonce', 'observedAt', 'heads', 'sealSha256', 'sourceSha256', 'observerId', 'observation']
      : null;
  if (!fields || !exactly(record, fields)) throw Error('ENVELOPE_SCHEMA_INVALID');
  return Buffer.from('SHOGI-W1J:' + role + ':1\n' + JSON.stringify(fields.map(key => record[key])), 'utf8');
}

function signatureBytes(sig) {
  if (typeof sig !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(sig)) return null;
  const b = Buffer.from(sig, 'base64');
  return b.length === 64 && b.toString('base64') === sig ? b : null;
}
function publicIdentity(key) {
  const pub = key?.type === 'public' ? key : createPublicKey(key);
  if (pub.asymmetricKeyType !== 'ed25519') throw Error('UNSUPPORTED_SIGNING_KEY');
  return { key: pub, fingerprint: sha(pub.export({ format: 'der', type: 'spki' })) };
}
function validChallenge(c) {
  return c.schema === CHALLENGE_SCHEMA && c.scope === 'synthetic'
    && typeof c.nonce === 'string' && shaPattern.test(c.nonce)
    && safeTime(c.issuedAt) && safeTime(c.expiresAt) && c.expiresAt > c.issuedAt
    && c.expiresAt - c.issuedAt <= 300000 && headsValid(c.heads)
    && typeof c.sealSha256 === 'string' && shaPattern.test(c.sealSha256)
    && typeof c.sourceSha256 === 'string' && shaPattern.test(c.sourceSha256) && nonempty(c.issuerId);
}
function validObservation(o) {
  return o.schema === OBSERVATION_SCHEMA && o.scope === 'synthetic'
    && typeof o.nonce === 'string' && shaPattern.test(o.nonce) && safeTime(o.observedAt)
    && headsValid(o.heads) && typeof o.sealSha256 === 'string' && shaPattern.test(o.sealSha256)
    && typeof o.sourceSha256 === 'string' && shaPattern.test(o.sourceSha256)
    && nonempty(o.observerId) && o.observation === 'synthetic-source-readback';
}

/**
 * Positive result demonstrates only a signed SYNTHETIC contract, never independently
 * provisioned keys, durable nonce registry, OS-origin provenance or actual read/use.
 * Input trust roots and spentNonces can be forged by a caller: they are NOT live credentials.
 */
export function assessSyntheticAuth(facts) {
  if (!object(facts)) return result('BLOCKED', 'TRUST_ROOTS_UNAVAILABLE');
  const { challenge, observation, issuerPublicKey, observerPublicKey, issuerSignature,
    observerSignature, expectedIssuerId, expectedObserverId, pinnedHeads,
    pinnedSourceSha256, sealBytes, spentNonces, now } = facts;
  if (!issuerPublicKey || !observerPublicKey || !(spentNonces instanceof Set)
    || !safeTime(now) || !headsValid(pinnedHeads) || !(typeof pinnedSourceSha256 === 'string' && shaPattern.test(pinnedSourceSha256))
    || !nonempty(expectedIssuerId) || !nonempty(expectedObserverId)) return result('BLOCKED', 'TRUST_ROOTS_UNAVAILABLE');
  if (!Buffer.isBuffer(sealBytes) || sealBytes.length === 0) return result('INVALID', 'SEAL_BYTES_MISSING');
  if (!object(challenge) || !object(observation)) return result('INVALID', 'ENVELOPE_SCHEMA_INVALID');
  let issuer, observer, messageI, messageO;
  try {
    messageI = signedPayload('issuer', challenge);
    messageO = signedPayload('observer', observation);
    issuer = publicIdentity(issuerPublicKey);
    observer = publicIdentity(observerPublicKey);
  } catch { return result('INVALID', 'ENVELOPE_SCHEMA_INVALID'); }
  if (issuer.fingerprint === observer.fingerprint) return result('INVALID', 'TRUST_ROLES_NOT_SEPARATED');
  if (!validChallenge(challenge) || !validObservation(observation)) return result('INVALID', 'ENVELOPE_SCHEMA_INVALID');
  const si = signatureBytes(issuerSignature), so = signatureBytes(observerSignature);
  if (!si || !verifySignature(null, messageI, issuer.key, si)) return result('INVALID', 'ISSUER_SIGNATURE_INVALID');
  if (!so || !verifySignature(null, messageO, observer.key, so)) return result('INVALID', 'OBSERVER_SIGNATURE_INVALID');
  if (challenge.issuerId !== expectedIssuerId || observation.observerId !== expectedObserverId) return result('INVALID', 'IDENTITY_BINDING_MISMATCH');
  if (!isDeepStrictEqual(challenge.heads, pinnedHeads) || !isDeepStrictEqual(observation.heads, pinnedHeads)) return result('INVALID', 'TARGET_BINDING_MISMATCH');
  if (challenge.sealSha256 !== sha(sealBytes) || observation.sealSha256 !== challenge.sealSha256) return result('INVALID', 'SEAL_BYTE_BINDING_MISMATCH');
  if (challenge.sourceSha256 !== pinnedSourceSha256 || observation.sourceSha256 !== pinnedSourceSha256) return result('INVALID', 'SOURCE_PIN_MISMATCH');
  if (observation.nonce !== challenge.nonce) return result('INVALID', 'CHALLENGE_BINDING_MISMATCH');
  if (spentNonces.has(challenge.nonce)) return result('INVALID', 'CHALLENGE_ALREADY_CONSUMED');
  if (now < challenge.issuedAt || now > challenge.expiresAt || observation.observedAt < challenge.issuedAt
    || observation.observedAt > now || observation.observedAt > challenge.expiresAt) return result('INVALID', 'CHALLENGE_TIME_INVALID');
  return { ...result('PASS', null), signatures: 'VALID_IN_SYNTHETIC_FIXTURE',
    nonceStatus: 'UNUSED_IN_CALLER_SUPPLIED_LEDGER_ONLY',
    note: 'Signature validity binds statements to keys, NOT statements to actual OS events or trusted key custody.' };
}
