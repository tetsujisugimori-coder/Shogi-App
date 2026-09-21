import type { BoardState } from '../../types/shogi';
import { runSelfPlayGame, type SelfPlayGameResult, type SelfPlayParticipant } from './selfPlayGame';

export type PairedSelfPlayParticipantId = 'A' | 'B';

/** Game number determines the seats, including when narrowing a game union. */
export type PairedSelfPlaySeats =
  | { gameNumber: 1; sente: 'A'; gote: 'B' }
  | { gameNumber: 2; sente: 'B'; gote: 'A' };

export type PairedSelfPlayOutcome = 'a_win' | 'b_win' | 'draw' | 'max_plies' | 'failed';

export type PairedSelfPlayGame = PairedSelfPlaySeats & {
  result: SelfPlayGameResult;
  outcome: PairedSelfPlayOutcome;
};

export interface PairedSelfPlaySummary {
  aWins: number;
  bWins: number;
  draws: number;
  maxPlies: number;
  failures: number;
}

export interface PairedSelfPlayMatchResult {
  games: [
    PairedSelfPlayGame & { gameNumber: 1 },
    PairedSelfPlayGame & { gameNumber: 2 },
  ];
  summary: PairedSelfPlaySummary;
}

function outcomeFor(result: SelfPlayGameResult, seats: PairedSelfPlaySeats): PairedSelfPlayOutcome {
  if (result.status !== 'ended') return result.status;
  const winner = result.gameResult.winner;
  if (winner === null) return 'draw';
  return seats[winner] === 'A' ? 'a_win' : 'b_win';
}

/** Runs exactly two independent synchronous games from the supplied position.
 * BoardState cloning, search protection and adjudication belong to runSelfPlayGame.
 * Injected searches/settings own their side effects, clocks and termination.
 */
export function runPairedSelfPlayMatch<ASettings, BSettings>(options: {
  initialState: BoardState;
  a: SelfPlayParticipant<ASettings>;
  b: SelfPlayParticipant<BSettings>;
  maxPlies: number;
}): PairedSelfPlayMatchResult {
  const { initialState, a, b, maxPlies } = options;
  const firstSeats = { gameNumber: 1, sente: 'A', gote: 'B' } as const;
  const secondSeats = { gameNumber: 2, sente: 'B', gote: 'A' } as const;
  const first = runSelfPlayGame({ initialState, sente: a, gote: b, maxPlies });
  // A failed or truncated first game is still an observation; always run game 2.
  const second = runSelfPlayGame({ initialState, sente: b, gote: a, maxPlies });
  const games: PairedSelfPlayMatchResult['games'] = [
    { ...firstSeats, result: first, outcome: outcomeFor(first, firstSeats) },
    { ...secondSeats, result: second, outcome: outcomeFor(second, secondSeats) },
  ];
  const summary: PairedSelfPlaySummary = { aWins: 0, bWins: 0, draws: 0, maxPlies: 0, failures: 0 };
  const countKey = {
    a_win: 'aWins', b_win: 'bWins', draw: 'draws', max_plies: 'maxPlies', failed: 'failures',
  } as const satisfies Record<PairedSelfPlayOutcome, keyof PairedSelfPlaySummary>;
  for (const game of games) summary[countKey[game.outcome]]++;
  return { games, summary };
}
