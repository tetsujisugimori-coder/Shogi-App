import type { BoardState } from '../../src/types/shogi';
import { getLegalActions } from '../../src/domain/shogi/legalActions';
import {
  areLegalActionsEqual,
  type AlphaBetaSearchOptions,
  type TimeLimitedIterativeDeepeningAlphaBetaSearchResult,
} from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import type { TimeLimitStressPosition } from './timeLimitStressPositions';

export type StressMode = 'ordinary' | 'quiescence-1';
export type StressPhase = 'warmup' | 'measurement';

export interface StressSample {
  type: 'sample';
  positionId: string;
  origin: TimeLimitStressPosition['origin'];
  historyPly: number;
  rootLegalActionCount: number;
  mode: StressMode;
  phase: StressPhase;
  run: number;
  timeLimitMilliseconds: number;
  actualElapsedMilliseconds: number;
  apiElapsedMilliseconds: number;
  completedDepth: number;
  timedOut: boolean;
  visitedPositionCount: number;
  quiescenceVisitedPositionCount: number;
  totalVisitedPositionCount: number;
  totalQuiescenceVisitedPositionCount: number;
  depthOneElapsedMilliseconds: number;
  selectedAction: TimeLimitedIterativeDeepeningAlphaBetaSearchResult['selectedAction'];
}

export function measureStressSample(args: {
  position: TimeLimitStressPosition;
  state: BoardState;
  rootLegalActionCount: number;
  mode: StressMode;
  phase: StressPhase;
  run: number;
  timeLimitMilliseconds: number;
  now: () => number;
  search: (state: BoardState, maxDepth: number, limit: number, options?: AlphaBetaSearchOptions) =>
    TimeLimitedIterativeDeepeningAlphaBetaSearchResult;
}): StressSample {
  const options = args.mode === 'quiescence-1' ? { quiescence: { maxTacticalDepth: 1 } } : undefined;
  const startedAt = args.now();
  const result = args.search(args.state, 4, args.timeLimitMilliseconds, options);
  const actualElapsedMilliseconds = args.now() - startedAt;
  if (!Number.isFinite(actualElapsedMilliseconds) || actualElapsedMilliseconds < 0) {
    throw new Error('Monotonic clock returned an invalid search duration');
  }
  const legal = getLegalActions(args.state);
  if (result.rootLegalActionCount !== args.rootLegalActionCount || legal.length !== args.rootLegalActionCount ||
    result.selectedAction === null || !legal.some((action) => areLegalActionsEqual(action, result.selectedAction!)) ||
    result.iterations.length !== result.completedDepth || result.iterations[0]?.depth !== 1) {
    throw new Error(`${args.position.id}: search result or root position is invalid`);
  }
  return {
    type: 'sample', positionId: args.position.id, origin: args.position.origin,
    historyPly: args.state.history.length, rootLegalActionCount: args.rootLegalActionCount,
    mode: args.mode, phase: args.phase, run: args.run,
    timeLimitMilliseconds: args.timeLimitMilliseconds, actualElapsedMilliseconds,
    apiElapsedMilliseconds: result.elapsedMilliseconds, completedDepth: result.completedDepth,
    timedOut: result.timedOut, visitedPositionCount: result.visitedPositionCount,
    quiescenceVisitedPositionCount: result.quiescenceVisitedPositionCount,
    totalVisitedPositionCount: result.totalVisitedPositionCount,
    totalQuiescenceVisitedPositionCount: result.totalQuiescenceVisitedPositionCount,
    depthOneElapsedMilliseconds: result.iterations[0].elapsedMilliseconds,
    selectedAction: result.selectedAction,
  };
}

export function summarize100ms(samples: readonly StressSample[]) {
  const values = samples.filter((sample) => sample.phase === 'measurement' && sample.timeLimitMilliseconds === 100)
    .map((sample) => sample.actualElapsedMilliseconds).sort((left, right) => left - right);
  if (values.length !== 5) throw new Error(`Expected five retained 100ms measurements, found ${values.length}`);
  return {
    maxMilliseconds: values[4], medianMilliseconds: values[2],
    over105MillisecondsCount: values.filter((value) => value > 105).length,
    atLeast300MillisecondsCount: values.filter((value) => value >= 300).length,
  };
}
