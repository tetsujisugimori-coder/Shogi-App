import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPositionKey } from '../../src/domain/shogi/repetition';
import { runPairedSelfPlayMatch, type PairedSelfPlayMatchResult } from '../../src/domain/shogi/pairedSelfPlayMatch';
import type { LegalAction } from '../../src/domain/shogi/legalActions';
import type { SelfPlayParticipant } from '../../src/domain/shogi/selfPlayGame';
import { SELF_PLAY_CONFIG, createSelfPlayParticipants, gameSignature, selfPlayJson, summarizeSelfPlay,
  type SelfPlayBenchmarkDependencies, type SelfPlayBenchmarkSettings } from './quiescenceOrderingSelfPlay';
import { QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS, type SelfPlayScenario } from './quiescenceOrderingSelfPlayScenarios';

export const SELF_PLAY_SUITE_CONFIG = Object.freeze({
  scenarioIds: Object.freeze(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map(scenario => scenario.id)),
  pairsPerScenario: 1,
  execution: 'synchronous-serial',
} as const);

export type PairRunner = (options: {
  initialState: ReturnType<SelfPlayScenario['create']>;
  a: SelfPlayParticipant<SelfPlayBenchmarkSettings>;
  b: SelfPlayParticipant<SelfPlayBenchmarkSettings>;
  maxPlies: number;
}) => PairedSelfPlayMatchResult;

export interface SelfPlaySuiteDependencies extends Omit<SelfPlayBenchmarkDependencies, 'runner'> {
  runner?: PairRunner;
}

export class SelfPlaySuiteScenarioError extends Error {
  constructor(readonly scenarioId: string, cause: unknown) {
    super(`scenario=${scenarioId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'SelfPlaySuiteScenarioError';
  }
}

export function positionGameSignature(initialPositionKey: string, actions: readonly LegalAction[]): string {
  return createHash('sha256').update(JSON.stringify([initialPositionKey, gameSignature(actions)])).digest('hex');
}

const summaryKeys = ['aWins', 'bWins', 'draws', 'maxPlies', 'failures'] as const;
type SummaryKey = typeof summaryKeys[number];
type SuiteOutcomes = Record<SummaryKey, bigint>;

function singlePairSummary(pair: PairedSelfPlayMatchResult): SuiteOutcomes {
  return Object.fromEntries(summaryKeys.map(key => [key, BigInt(pair.summary[key])])) as SuiteOutcomes;
}

function assertOutcomeInvariant(summary: SuiteOutcomes, expectedGames: bigint, label: string): void {
  const count = summaryKeys.reduce((total, key) => total + summary[key], 0n);
  assert.equal(count, expectedGames, `${label}: outcome counts must equal game count.`);
}

function summarizePair(pair: PairedSelfPlayMatchResult) {
  return summarizeSelfPlay({ pairs: [{ pairNumber: 1, result: pair }], summary: singlePairSummary(pair) });
}

export interface SelfPlaySuiteScenarioResult {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly provenance: string;
  readonly initialPositionKey: string;
  readonly executionOrder: number;
  readonly pair: PairedSelfPlayMatchResult;
  readonly summary: ReturnType<typeof summarizePair>['summary'];
  readonly games: Array<ReturnType<typeof summarizePair>['games'][number] & { positionSignature: string }>;
}

export interface SelfPlaySuiteResult {
  readonly scenarios: SelfPlaySuiteScenarioResult[];
  readonly summary: {
    readonly outcomes: SuiteOutcomes;
    readonly totalGames: bigint;
    readonly outcomeCountSum: bigint;
    readonly consistent: boolean;
    readonly uniquePositionSignatures: number;
    readonly duplicateGames: number;
    readonly signatureFrequencies: Array<{ signature: string; count: number; games: string[] }>;
  };
}

export interface SelfPlaySuiteHooks {
  readonly onScenarioStart?: (scenario: SelfPlayScenario, executionOrder: number, initialPositionKey: string) => void;
  readonly onScenarioComplete?: (scenario: SelfPlaySuiteScenarioResult) => void;
}

/** Runs exactly one existing A/B seat-swapped pair per catalogued start. */
export function runSelfPlaySuite(dependencies: SelfPlaySuiteDependencies = {},
  scenarios: readonly SelfPlayScenario[] = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS,
  hooks: SelfPlaySuiteHooks = {}): SelfPlaySuiteResult {
  assert.equal(new Set(scenarios.map(scenario => scenario.id)).size, scenarios.length, 'Scenario IDs must be unique.');
  const { runner, ...searchDependencies } = dependencies;
  const participants = createSelfPlayParticipants(searchDependencies);
  const results: SelfPlaySuiteScenarioResult[] = [];
  const frequencies = new Map<string, { signature: string; count: number; games: string[] }>();
  const outcomes: SuiteOutcomes = { aWins: 0n, bWins: 0n, draws: 0n, maxPlies: 0n, failures: 0n };
  for (const [index, scenario] of scenarios.entries()) {
    let initialPositionKey = '';
    try {
      const initialState = scenario.create();
      if (initialState.turn !== scenario.sideToMove) {
        throw new Error(`scenario turn must be ${scenario.sideToMove}, found ${initialState.turn}.`);
      }
      initialPositionKey = createPositionKey(initialState);
      hooks.onScenarioStart?.(scenario, index + 1, initialPositionKey);
      const pair = (runner ?? runPairedSelfPlayMatch)({
        initialState, ...participants, maxPlies: SELF_PLAY_CONFIG.maxPlies,
      });
      const report = summarizePair(pair);
      assertOutcomeInvariant(singlePairSummary(pair), 2n, `scenario=${scenario.id}`);
      const games = report.games.map(game => ({ ...game,
        positionSignature: positionGameSignature(initialPositionKey, game.actions),
      }));
      for (const game of games) {
        const item = frequencies.get(game.positionSignature) ?? { signature: game.positionSignature, count: 0, games: [] };
        item.count++; item.games.push(`${scenario.id}/${game.pairNumber}/${game.gameNumber}`);
        frequencies.set(game.positionSignature, item);
      }
      for (const key of summaryKeys) outcomes[key] += BigInt(pair.summary[key]);
      const entry: SelfPlaySuiteScenarioResult = {
        scenarioId: scenario.id, scenarioName: scenario.name, provenance: scenario.provenance,
        initialPositionKey, executionOrder: index + 1, pair, summary: report.summary, games,
      };
      results.push(entry);
      hooks.onScenarioComplete?.(entry);
    } catch (error) {
      throw new SelfPlaySuiteScenarioError(scenario.id, error);
    }
  }
  const totalGames = BigInt(results.length * 2);
  assert.equal(totalGames, BigInt(results.length) * 2n, 'Suite game count must use two games per executed scenario.');
  assertOutcomeInvariant(outcomes, totalGames, 'suite');
  const outcomeCountSum = summaryKeys.reduce((total, key) => total + outcomes[key], 0n);
  return { scenarios: results, summary: { outcomes, totalGames, outcomeCountSum,
    consistent: totalGames === outcomeCountSum,
    uniquePositionSignatures: frequencies.size, duplicateGames: Number(totalGames) - frequencies.size,
    signatureFrequencies: [...frequencies.values()],
  } };
}

export function runSelfPlaySuiteCli(dependencies: SelfPlaySuiteDependencies = {}, write = console.log): 0 | 1 {
  write(`SUITE_CONFIG ${selfPlayJson({ ...SELF_PLAY_SUITE_CONFIG, search: SELF_PLAY_CONFIG.search, participants: SELF_PLAY_CONFIG.participants, maxPlies: SELF_PLAY_CONFIG.maxPlies })}`);
  try {
    const result = runSelfPlaySuite(dependencies, QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS, {
      onScenarioStart: (scenario, executionOrder, initialPositionKey) => write(`SCENARIO_START ${selfPlayJson({
        scenarioId: scenario.id, scenarioName: scenario.name, provenance: scenario.provenance, executionOrder, initialPositionKey,
      })}`),
      onScenarioComplete: scenario => {
        for (const game of scenario.games) {
          write(`RECORD ${selfPlayJson({ scenarioId: scenario.scenarioId, pairNumber: game.pairNumber, gameNumber: game.gameNumber, plies: game.plies })}`);
          const { plies: _plies, ...summary } = game;
          write(`GAME ${selfPlayJson({ scenarioId: scenario.scenarioId, ...summary })}`);
        }
        write(`SCENARIO_SUMMARY ${selfPlayJson({ scenarioId: scenario.scenarioId, scenarioName: scenario.scenarioName,
          provenance: scenario.provenance, initialPositionKey: scenario.initialPositionKey, executionOrder: scenario.executionOrder,
          summary: scenario.summary })}`);
      },
    });
    write(`SUITE_SUMMARY ${selfPlayJson(result.summary)}`);
    return result.summary.outcomes.failures > 0n ? 1 : 0;
  } catch (error) {
    const scenarioId = error instanceof SelfPlaySuiteScenarioError ? error.scenarioId : undefined;
    write(`ERROR ${selfPlayJson({ scenarioId, message: error instanceof Error ? error.message : String(error) })}`);
    return 1;
  }
}
