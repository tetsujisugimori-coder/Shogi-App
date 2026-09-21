import type { BoardState } from '../../types/shogi';
import {
  runPairedSelfPlayMatch, type PairedSelfPlayMatchResult, type PairedSelfPlaySummary,
} from './pairedSelfPlayMatch';
import type { SelfPlayParticipant } from './selfPlayGame';

export interface RepeatedPairedSelfPlayOptions<ASettings, BSettings> {
  initialState: BoardState;
  a: SelfPlayParticipant<ASettings>;
  b: SelfPlayParticipant<BSettings>;
  maxPlies: number;
  /** Number of two-game pairs; a finite non-negative safe integer. */
  pairCount: number;
}

export interface RepeatedPairedSelfPlayPair {
  /** 1-based execution order. */
  pairNumber: number;
  result: PairedSelfPlayMatchResult;
}

/** Exact counts even when twice pairCount would exceed Number.MAX_SAFE_INTEGER.
 * Individual pair summaries retain their existing number-valued contract. */
export type RepeatedPairedSelfPlaySummary = {
  [K in keyof PairedSelfPlaySummary]: bigint;
};

export interface RepeatedPairedSelfPlayMatchesResult {
  pairs: RepeatedPairedSelfPlayPair[];
  /** The five counts sum to BigInt(pairs.length) * 2n on successful return. */
  summary: RepeatedPairedSelfPlaySummary;
}

/** Runs pairs synchronously from the same supplied position, retaining every result.
 * Cloning, seats and adjudication belong to the existing pair/game runners.
 * Searches/settings, clocks, randomness, side effects and termination belong to
 * the caller; this runner never resets them. All results are retained in memory.
 * Invalid pairCount throws before any pair; other exceptions propagate unchanged.
 */
export function runRepeatedPairedSelfPlayMatches<ASettings, BSettings>(
  options: RepeatedPairedSelfPlayOptions<ASettings, BSettings>,
): RepeatedPairedSelfPlayMatchesResult {
  const { pairCount } = options;
  if (typeof pairCount !== 'number' || !Number.isSafeInteger(pairCount) || pairCount < 0) {
    throw new RangeError('pairCount must be a finite non-negative safe integer.');
  }
  const pairs: RepeatedPairedSelfPlayPair[] = [];
  const summary: RepeatedPairedSelfPlaySummary = {
    aWins: 0n, bWins: 0n, draws: 0n, maxPlies: 0n, failures: 0n,
  };
  const { initialState, a, b, maxPlies } = options;
  for (let index = 0; index < pairCount; index++) {
    const result = runPairedSelfPlayMatch({ initialState, a, b, maxPlies });
    pairs.push({ pairNumber: index + 1, result });
    summary.aWins += BigInt(result.summary.aWins);
    summary.bWins += BigInt(result.summary.bWins);
    summary.draws += BigInt(result.summary.draws);
    summary.maxPlies += BigInt(result.summary.maxPlies);
    summary.failures += BigInt(result.summary.failures);
    // Failures and truncations are observations, so subsequent pairs still run.
  }
  return { pairs, summary };
}
