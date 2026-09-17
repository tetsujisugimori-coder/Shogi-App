import type { BoardState } from '../types/shogi';
import { areLegalActionsEqual, cloneBoardState, executeLegalAction, getLegalActions,
  generateMoveNotation, generateDropNotation, type LegalAction, type AlphaBetaSearchResult } from '../domain/shogi';

export function formatLegalActionNotation(state: BoardState, action: LegalAction): string {
  if (action.kind === 'move') {
    const piece = state.squares[action.from.row]?.[action.from.col]?.piece;
    if (!piece) throw new Error('A legal move action must have a source piece.');
    return generateMoveNotation(state.turn, piece, action.to, action.promotion);
  }

  const hand = state.turn === 'sente' ? state.senteHand : state.goteHand;
  const piece = hand.find((candidate) => candidate.id === action.pieceId);
  if (!piece) throw new Error('A legal drop action must have a hand piece.');
  return generateDropNotation(state.turn, piece, action.to);
}

/**
 * Treat a Worker result as untrusted at the UI boundary. The returned notation
 * is generated while replaying a clone, so every later PV action sees the
 * position created by the earlier action.
 */
export function validateAndFormatPrincipalVariation(
  state: BoardState,
  result: Pick<AlphaBetaSearchResult, 'selectedAction' | 'principalVariation' | 'evaluationBreakdown'>,
  depth: number,
  requireSearchLeaf = false,
): string[] | null {
  if (!result.selectedAction || !Array.isArray(result.principalVariation) ||
    !Number.isInteger(depth) || depth < 1 ||
    result.principalVariation.length === 0 ||
    result.principalVariation.length > depth) {
    return null;
  }

  try {
    if (!areLegalActionsEqual(result.principalVariation[0], result.selectedAction)) return null;
    let replayState = cloneBoardState(state);
    const notations: string[] = [];
    for (const action of result.principalVariation) {
      if (!getLegalActions(replayState).some((legalAction) => areLegalActionsEqual(legalAction, action))) {
        return null;
      }
      notations.push(formatLegalActionNotation(replayState, action));
      const execution = executeLegalAction(replayState, action, { proposer: 'local_ai' });
      if (execution.type !== 'applied') return null;
      replayState = execution.state;
    }
    if (requireSearchLeaf) {
      if (notations.length < depth && replayState.status !== 'ended' && getLegalActions(replayState).length > 0) return null;
      if (replayState.status === 'ended' && !replayState.result) return null;
      const terminal = replayState.status !== 'ended' ? null : replayState.result!.winner === null
        ? 'draw' : replayState.result!.winner === state.turn ? 'win' : 'loss';
      if (result.evaluationBreakdown.terminal !== terminal) return null;
    }
    return notations;
  } catch {
    return null;
  }
}
