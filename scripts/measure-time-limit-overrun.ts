import { performance } from 'node:perf_hooks';
import { createInitialBoardState } from '../src/types/shogi';
import { getLegalActions, executeLegalAction } from '../src/domain/shogi/legalActions';
import { cloneBoardState } from '../src/domain/shogi/replay';
import { evaluateSearchPositionBreakdown } from '../src/domain/shogi/twoPlyMinimaxAi';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS } from './benchmarks/quiescenceOrderingSelfPlayScenarios';

const positions = [
  { id: 'initial', create: createInitialBoardState },
  ...QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.filter((scenario) =>
    scenario.id === 'quiet-double-static-rook-middlegame' || scenario.id === 'check-evasion-endgame'),
];
const mode = process.argv[2] ?? 'timed';
if (!['timed', 'profile', 'fixed', 'timed-q1', 'profile-q1', 'fixed-q1'].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
const quiescence = mode.endsWith('-q1') ? { quiescence: { maxTacticalDepth: 1 } } as const : undefined;

function actionKey(action: ReturnType<typeof getLegalActions>[number] | null): string | null {
  if (action === null) return null;
  return action.kind === 'move'
    ? `${action.player}:${action.pieceType}:${action.from.row},${action.from.col}>${action.to.row},${action.to.col}:${action.promotion}`
    : `${action.player}:${action.pieceType}:${action.pieceId}>${action.to.row},${action.to.col}`;
}

for (const position of positions) {
  const state = position.create();
  const legalActionCount = getLegalActions(state).length;
  if (mode.startsWith('profile')) {
    // Separate the work performed once at the root from the work repeated for
    // every depth-one successor. These operation timings are diagnostic only.
    analyzeAlphaBetaSearch(state, 1, undefined, undefined, quiescence);
    const actions = getLegalActions(state);
    const totals = { legalActions: 0, clone: 0, execute: 0, evaluate: 0, depthOne: 0 };
    for (let repeat = 0; repeat < 3; repeat += 1) {
      let start = performance.now();
      getLegalActions(state);
      totals.legalActions += performance.now() - start;
      for (const action of actions) {
        start = performance.now();
        const copy = cloneBoardState(state);
        totals.clone += performance.now() - start;
        start = performance.now();
        const result = executeLegalAction(copy, action);
        totals.execute += performance.now() - start;
        if (result.type !== 'applied') throw new Error('Generated action was rejected');
        start = performance.now();
        evaluateSearchPositionBreakdown(result.state, state.turn);
        totals.evaluate += performance.now() - start;
      }
      start = performance.now();
      analyzeAlphaBetaSearch(state, 1, undefined, undefined, quiescence);
      totals.depthOne += performance.now() - start;
    }
    console.log(JSON.stringify({ mode, position: position.id, legalActionCount, repetitions: 3, totals }));
    continue;
  }
  if (mode.startsWith('fixed')) {
    for (const depth of [1, 2]) {
      const result = analyzeAlphaBetaSearch(state, depth, undefined, () => 0, quiescence);
      console.log(JSON.stringify({ mode, position: position.id, legalActionCount, depth,
        selectedAction: actionKey(result.selectedAction), evaluation: result.selectedEvaluation,
        pv: result.principalVariation.map(actionKey), breakdown: result.evaluationBreakdown,
        visited: result.visitedPositionCount, cutoff: result.cutoffCount, skipped: result.skippedActionCount }));
    }
    continue;
  }
  for (const limit of [100, 1000]) {
    for (let run = -2; run < 5; run += 1) {
      const started = performance.now();
      const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 4, limit, undefined, undefined, quiescence);
      const actualElapsedMilliseconds = performance.now() - started;
      console.log(JSON.stringify({ mode, position: position.id, legalActionCount, limit,
        run: run < 0 ? `warmup${run + 3}` : run + 1,
        actualElapsedMilliseconds, apiElapsedMilliseconds: result.elapsedMilliseconds,
        completedDepth: result.completedDepth, timedOut: result.timedOut,
        selectedAction: actionKey(result.selectedAction),
        iterationMilliseconds: result.iterations.map((iteration) => iteration.elapsedMilliseconds) }));
    }
  }
}
