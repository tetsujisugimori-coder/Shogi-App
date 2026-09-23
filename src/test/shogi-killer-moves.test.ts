import { describe, expect, it } from 'vitest';
import { createInitialBoardState, type BoardState } from '../types/shogi';
import { getLegalActions, type LegalAction } from '../domain/shogi/legalActions';
import { analyzeAlphaBetaSearch, areLegalActionsEqual, isAlphaBetaQuietAction, KillerMoveHistory,
  orderAlphaBetaNodeActions } from '../domain/shogi/twoPlyAlphaBetaAi';

function capturePosition(): BoardState {
  const state = createInitialBoardState();
  for (const row of state.squares) for (const square of row) square.piece = null;
  state.squares[8][8].piece = { id: 'sente-king', type: 'king', player: 'sente' };
  state.squares[0][8].piece = { id: 'gote-king', type: 'king', player: 'gote' };
  state.squares[4][4].piece = { id: 'sente-rook', type: 'rook', player: 'sente' };
  state.squares[4][5].piece = { id: 'gote-pawn', type: 'pawn', player: 'gote' };
  state.squares[5][4].piece = { id: 'sente-pawn', type: 'pawn', player: 'sente' };
  return state;
}

function quietActions(state: BoardState): LegalAction[] {
  return getLegalActions(state).filter((action) => isAlphaBetaQuietAction(state, action));
}

describe('killer move history', () => {
  it('keeps at most two moves per ply, promotes the newest move, and does not duplicate a repeat', () => {
    const state = capturePosition();
    const [first, second, third] = quietActions(state);
    const history = new KillerMoveHistory();
    history.record(state, 2, first);
    history.record(state, 2, second);
    expect(history.actionsAt(2)).toEqual([second, first]);
    history.record(state, 2, third);
    expect(history.actionsAt(2)).toEqual([third, second]);
    history.record(state, 2, second);
    expect(history.actionsAt(2)).toEqual([second, third]);
    expect(history.actionsAt(2).filter((action) => areLegalActionsEqual(action, second))).toHaveLength(1);
  });

  it('separates plies and excludes captures while admitting non-promoting drops and moves', () => {
    const state = capturePosition();
    state.senteHand.push({ id: 'hand-gold', type: 'gold', player: 'sente' });
    const actions = getLegalActions(state);
    const capture = actions.find((action) => action.kind === 'move' &&
      state.squares[action.to.row][action.to.col].piece?.player === 'gote')!;
    const quiet = actions.find((action) => isAlphaBetaQuietAction(state, action))!;
    const drop = actions.find((action) => action.kind === 'drop')!;
    const history = new KillerMoveHistory();
    expect(isAlphaBetaQuietAction(state, capture)).toBe(false);
    expect(isAlphaBetaQuietAction(state, drop)).toBe(true);
    history.record(state, 1, capture);
    history.record(state, 1, quiet);
    history.record(state, 3, drop);
    expect(history.actionsAt(1)).toEqual([quiet]);
    expect(history.actionsAt(2)).toEqual([]);
    expect(history.actionsAt(3)).toEqual([drop]);
  });

  it('uses only legal matching killers after the established tactical tiers and preserves OFF ordering', () => {
    const state = capturePosition();
    const actions = getLegalActions(state);
    const quiet = actions.find((action) => isAlphaBetaQuietAction(state, action))!;
    const capture = actions.find((action) => !isAlphaBetaQuietAction(state, action))!;
    const off = orderAlphaBetaNodeActions(state, actions);
    expect(orderAlphaBetaNodeActions(state, actions, undefined, undefined, { killerMoves: false })).toEqual(off);
    const on = orderAlphaBetaNodeActions(state, actions, undefined, undefined, { killerMoves: true }, [quiet]);
    expect(on.indexOf(capture)).toBeLessThan(on.indexOf(quiet));
    expect(on.find((action) => areLegalActionsEqual(action, quiet))).toEqual(quiet);
    const absent = createInitialBoardState();
    expect(orderAlphaBetaNodeActions(absent, getLegalActions(absent), undefined, undefined, { killerMoves: true }, [quiet]))
      .toEqual(orderAlphaBetaNodeActions(absent, getLegalActions(absent)));
  });

  it('creates a fresh history for every search and keeps fixed-depth legal result semantics with killer moves on or off', () => {
    const state = capturePosition();
    const before = structuredClone(state);
    const off = analyzeAlphaBetaSearch(state, 3, undefined, () => 0, { killerMoves: false });
    const firstOn = analyzeAlphaBetaSearch(state, 3, undefined, () => 0, { killerMoves: true });
    const secondOn = analyzeAlphaBetaSearch(state, 3, undefined, () => 0, { killerMoves: true });
    expect(firstOn).toEqual(secondOn);
    expect(firstOn.rootLegalActionCount).toBe(getLegalActions(state).length);
    expect(firstOn.selectedAction).toEqual(off.selectedAction);
    expect(firstOn.selectedEvaluation).toBe(off.selectedEvaluation);
    expect(state).toEqual(before);
  });
});
