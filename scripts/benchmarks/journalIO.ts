import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openSync, writeSync, fsyncSync, closeSync, readFileSync } from 'node:fs';

export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Tagged trees avoid collisions with ordinary strings/objects and preserve absent vs undefined. */
export function encode(value: unknown): unknown {
  if (value === null) return ['null'];
  if (value === undefined) return ['undefined'];
  if (typeof value === 'number') {
    assert.ok(!Number.isNaN(value), 'NaN is not an observation');
    return ['number', Object.is(value, -0) ? '-0' : Number.isFinite(value) ? value : String(value)];
  }
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
  if (Array.isArray(value)) return ['array', value.map(encode)];
  assert.ok(typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'plain object required');
  return ['object', Object.keys(value).sort().map(key => [key, encode((value as Record<string, unknown>)[key])])];
}

export function decode(value: unknown): unknown {
  assert.ok(Array.isArray(value), 'tagged value required');
  const [tag, data] = value;
  assert.equal(value.length, tag === 'null' || tag === 'undefined' ? 1 : 2);
  switch (tag) {
    case 'null': return null;
    case 'undefined': return undefined;
    case 'boolean': assert.equal(typeof data, 'boolean'); return data;
    case 'string': assert.equal(typeof data, 'string'); return data;
    case 'number':
      if (data === 'Infinity') return Infinity;
      if (data === '-Infinity') return -Infinity;
      if (data === '-0') return -0;
      assert.ok(typeof data === 'number' && Number.isFinite(data) && !Object.is(data, -0), 'invalid numeric encoding');
      return data;
    case 'array': assert.ok(Array.isArray(data)); return data.map(decode);
    case 'object': {
      assert.ok(Array.isArray(data));
      let previous: string | undefined;
      const entries = data.map(entry => {
        assert.ok(Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string');
        assert.ok(previous === undefined || previous < entry[0], 'duplicate/unsorted object key');
        previous = entry[0];
        return [entry[0], decode(entry[1])];
      });
      return Object.fromEntries(entries);
    }
    default: throw Error('unknown value tag');
  }
}

export const canonical = (value: unknown) => JSON.stringify(encode(value));
export const valueHash = (value: unknown) => sha256(canonical(value));
export const stringify = (value: unknown) => canonical(value) + '\n';
export const parse = <T>(bytes: string): T => decode(JSON.parse(bytes)) as T;

export function frame(payload: unknown, seq: number, previous: string | null): string {
  const body = { schema: 1, seq, previous, payload: encode(payload) };
  return JSON.stringify({ ...body, hash: sha256(JSON.stringify(body)) }) + '\n';
}

export class CapacityError extends Error { constructor() { super('journal capacity limit'); } }
export class JournalWriteError extends Error {
  constructor(cause: unknown) { super('journal write/fsync failed; writer poisoned', { cause }); }
}
export const diskIO = { open: openSync, write: writeSync, sync: fsyncSync, close: closeSync };
export type JournalIO = typeof diskIO;

/** An IO exception poisons the writer: never append an end after a partial/uncertain write. */
export class JournalWriter {
  private fd: number;
  private seq = 0;
  private previous: string | null = null;
  private poisoned = false;
  private closed = false;
  bytes = 0;
  saveMs = 0;
  constructor(path: string, readonly maxBytes: number, readonly reserveBytes = 65536, private io = diskIO) {
    assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0);
    assert.ok(Number.isSafeInteger(reserveBytes) && reserveBytes > 0 && reserveBytes < maxBytes);
    this.fd = io.open(path, 'wx');
  }
  append(payload: unknown, ending = false): void {
    assert.ok(!this.closed && !this.poisoned, 'writer closed or poisoned');
    const started = performance.now();
    const line = frame(payload, this.seq, this.previous), bytes = Buffer.from(line);
    if (this.bytes + bytes.length > this.maxBytes - (ending ? 0 : this.reserveBytes)) throw new CapacityError();
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const count = this.io.write(this.fd, bytes, offset, bytes.length - offset);
        assert.ok(Number.isInteger(count) && count > 0 && count <= bytes.length - offset, 'invalid/zero write');
        offset += count;
      }
      this.io.sync(this.fd);
    } catch (error) { this.poisoned = true; throw new JournalWriteError(error); }
    this.bytes += bytes.length;
    this.previous = JSON.parse(line).hash;
    this.seq++;
    this.saveMs += performance.now() - started;
  }
  close(): void { if (!this.closed) { this.closed = true; this.io.close(this.fd); } }
}

export interface ReadJournal { payloads: unknown[]; bytes: number; partialTailBytes: number; error: string | null; hash: string }
export function readJournal(path: string): ReadJournal {
  const bytes = readFileSync(path);
  const split = bytes.lastIndexOf(10), complete = bytes.subarray(0, split + 1);
  const result: ReadJournal = { payloads: [], bytes: bytes.length, partialTailBytes: bytes.length - complete.length, error: null, hash: sha256(bytes) };
  let previous: string | null = null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(complete);
    for (const line of text.split('\n').slice(0, -1)) {
      const row = JSON.parse(line);
      assert.deepEqual(Object.keys(row).sort(), ['hash', 'payload', 'previous', 'schema', 'seq']);
      assert.equal(row.schema, 1, 'unknown journal schema');
      assert.equal(row.seq, result.payloads.length, 'record sequence mismatch');
      assert.equal(row.previous, previous, 'chain mismatch');
      assert.equal(row.hash, sha256(JSON.stringify({ schema: row.schema, seq: row.seq, previous: row.previous, payload: row.payload })), 'record checksum mismatch');
      const decoded = decode(row.payload);
      assert.equal(frame(decoded, row.seq, previous), line + '\n', 'noncanonical frame');
      result.payloads.push(decoded);
      previous = row.hash;
    }
  } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
  return result;
}
