import type { BoardState } from '../../types/shogi';
import { createPositionKey } from './repetition';

/** Per-public-call observations, including work in interrupted iterations. */
export interface TranspositionTableStatistics {
  lookups: number;
  hits: number;
  exactReuses: number;
  misses: number;
  safetyRejects: number;
  stores: number;
  evictions: number;
  maxEntries: number;
  maxPayloadCharacters: number;
  identityGenerations: number;
  identityMatches: number;
  identityMismatches: number;
  nonExactStoreRejects: number;
  sizeStoreRejects: number;
}

export function createTranspositionTableStatistics(): TranspositionTableStatistics {
  return { lookups: 0, hits: 0, exactReuses: 0, misses: 0, safetyRejects: 0,
    stores: 0, evictions: 0, maxEntries: 0, maxPayloadCharacters: 0,
    identityGenerations: 0, identityMatches: 0, identityMismatches: 0,
    nonExactStoreRejects: 0, sizeStoreRejects: 0 };
}

export const TRANSPOSITION_TABLE_CAPACITY = 512;
const MAX_ENTRY_CHARACTERS = 16_384;

/** No hashes/collisions: retain and compare the complete identity string.
 * Every future action appends at most one repetition record. If max existing
 * frequency + the entire ordinary/tactical horizon < 4, repetition cannot
 * occur anywhere in that horizon, regardless of the order of old records.
 * Otherwise require the complete ordered records (including check flags).
 */
export function transpositionIdentity(state: BoardState, horizon: number): string {
  const counts = new Map<string, number>();
  let maximum = 0;
  for (const record of state.positionHistory ?? []) {
    const count = (counts.get(record.key) ?? 0) + 1;
    counts.set(record.key, count);
    maximum = Math.max(maximum, count);
  }
  // A mismatched tail is normalized to a single baseline by the executor.
  // Keeping the raw history here only rejects extra reuse, never permits it.
  const historyIndependent = state.status === 'ended' || horizon === 0 || Math.max(1, maximum) + horizon < 4;
  return JSON.stringify([state.squares.map(row => row.map(s => s.piece)),
    state.senteHand, state.goteHand, state.turn, state.status, state.result,
    state.moveNumber, state.moveLimitJishogi, state.history.length,
    historyIndependent ? 'repetition-impossible-in-horizon' : state.positionHistory]);
}

/** Bounded FIFO. Entries with incompatible safety context count as hits but
 * never as exact reuse. Values are immutable private copies owned by search.
 */
export class ExactTranspositionTable<T> {
  private readonly entries = new Map<string, { identity: string; result: T; characters: number }>();
  private characters = 0;
  constructor(readonly statistics = createTranspositionTableStatistics()) {
    Object.assign(statistics, createTranspositionTableStatistics());
  }
  key(state: BoardState, depth: number, ply: number): string {
    return JSON.stringify([createPositionKey(state), depth, ply]);
  }
  probe(key: string, identity: string | (() => string)): T | undefined {
    const s = this.statistics;
    s.lookups++;
    const entry = this.entries.get(key);
    if (!entry) { s.misses++; return undefined; }
    s.hits++;
    const expected = typeof identity === 'function' ? identity() : identity;
    if (entry.identity !== expected) { s.safetyRejects++; s.identityMismatches++; return undefined; }
    s.identityMatches++;
    s.exactReuses++;
    return entry.result;
  }
  store(key: string, identity: string, result: T): void {
    const characters = key.length + identity.length + JSON.stringify(result).length;
    if (characters > MAX_ENTRY_CHARACTERS) {
      this.statistics.safetyRejects++; this.statistics.sizeStoreRejects++; return;
    }
    const existing = this.entries.get(key);
    if (existing) { this.characters -= existing.characters; this.entries.delete(key); }
    if (this.entries.size === TRANSPOSITION_TABLE_CAPACITY) {
      const oldest = this.entries.keys().next().value!;
      this.characters -= this.entries.get(oldest)!.characters;
      this.entries.delete(oldest);
      this.statistics.evictions++;
    }
    this.entries.set(key, { identity, result, characters });
    this.characters += characters;
    this.statistics.stores++;
    this.statistics.maxEntries = Math.max(this.statistics.maxEntries, this.entries.size);
    this.statistics.maxPayloadCharacters = Math.max(this.statistics.maxPayloadCharacters, this.characters);
  }
}
