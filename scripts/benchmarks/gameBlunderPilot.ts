import assert from 'node:assert/strict';
import { cloneBoardState } from '../../src/domain/shogi/replay';
import { executeLegalAction } from '../../src/domain/shogi/legalActions';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch, areLegalActionsEqual } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import { auditJournal, stateHash, type MoveRecord } from './matchJournal';
import type { BoardState } from '../../src/types/shogi';

/** A narrow, hindsight-based triage: the piece just moved is captured on the next recorded ply.
 * This is a trigger for review, never proof that the move was bad. */
export function capturedNext(move: MoveRecord, next: MoveRecord | undefined): boolean {
  return !!next && next.action.kind === 'move' && next.action.to.row === move.action.to.row && next.action.to.col === move.action.to.col;
}
export function apply(state: BoardState, move: MoveRecord['action']): BoardState {
  const result = executeLegalAction(state, move, { proposer: 'local_ai' });
  assert.equal(result.type, 'applied');
  if (result.type !== 'applied') throw Error('illegal action');
  return result.state;
}
export function extract(paths: string[]) {
  const seen = new Set<string>();
  const games = paths.map(path => ({ path, audit: auditJournal(path) }));
  const candidates: { path: string; hash: string; id: string; state: BoardState; move: MoveRecord; next: MoveRecord; mode: 'legacy' | 'experimental'; conditions: NonNullable<ReturnType<typeof auditJournal>['start']>['conditions'] }[] = [];
  for (const {path,audit} of games) {
    if (audit.status !== 'complete' || !audit.start || !audit.end) continue;
    let state = cloneBoardState(audit.start.initialState);
    for (const [i,move] of audit.moves.entries()) {
      const next = audit.moves[i + 1];
      if (capturedNext(move,next)) {
        const id = `${stateHash(state)}/${JSON.stringify(move.action)}/${audit.start.seats[move.player]}/${audit.start.conditions.timeMs}`;
        if (!seen.has(id)) {
          seen.add(id);
          candidates.push({path, hash:audit.hash, id, state:cloneBoardState(state), move, next:next!, mode:audit.start.seats[move.player], conditions:audit.start.conditions});
        }
      }
      state = apply(state,move.action);
    }
  }
  return {games, candidates};
}
export function compare(c: ReturnType<typeof extract>['candidates'][number], budget = 1000) {
  assert.ok(Number.isInteger(budget) && budget > 0 && budget <= 1000);
  const search = (state: BoardState) => analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 4, budget,
    {pieceSafetyMode:c.mode}, () => performance.now(), c.conditions.options);
  const root = search(c.state);
  const alternative = root.resultSource === 'completed-iteration' ? root.selectedAction : null;
  if (!alternative || areLegalActionsEqual(alternative,c.move.action)) return {root, alternative, actual:null, reference:null, delta:null, verdict:'INCONCLUSIVE', reason:'No distinct alternative from a completed root iteration.'};
  const actual = search(apply(c.state,c.move.action));
  const reference = search(apply(c.state,alternative));
  // Both child roots belong to the opponent; negate each value for the original mover.
  const valid = actual.resultSource === 'completed-iteration' && reference.resultSource === 'completed-iteration' &&
    actual.completedDepth === reference.completedDepth && actual.selectedEvaluation !== null && reference.selectedEvaluation !== null &&
    Number.isFinite(actual.selectedEvaluation) && Number.isFinite(reference.selectedEvaluation);
  const delta = valid ? actual.selectedEvaluation! - reference.selectedEvaluation! : null;
  return {root, alternative, actual, reference, delta, verdict: valid && delta! >= 300 ? 'SUSPECTED' : 'INCONCLUSIVE',
    reason: valid ? 'Same completed child depth; finite preference only, not a proof. Positive delta favors the alternative.' : 'Missing, partial, terminal, or different-depth child results.'};
}
