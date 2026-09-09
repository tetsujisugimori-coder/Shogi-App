import { describe, expect, it } from 'vitest';
import {
  cloneBoardSquares,
  cloneBoardState,
  analyzeTwoPlyMinimaxSearch,
  evaluateMaterial,
  evaluateSearchPosition,
  executeLegalAction,
  getLegalActions,
  selectBestMaterialAction,
  selectBestTwoPlyMinimaxAction,
  type LegalAction,
  type MaterialValueTable,
} from '../domain/shogi';
import {
  createInitialBoardState,
  type BoardState,
  type GameResult,
  type Piece,
  type PieceType,
  type Player,
} from '../types/shogi';

function piece(id: string, type: PieceType, player: Player, isPromoted = false): Piece {
  return { id, type, player, ...(isPromoted ? { isPromoted: true } : {}) };
}

function createState(
  boardPieces: Array<{ row: number; col: number; piece: Piece }>,
  senteHand: Piece[] = [],
  goteHand: Piece[] = [],
  turn: Player = 'sente',
  overrides: Partial<BoardState> = {}
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) for (const square of row) square.piece = null;
  for (const item of boardPieces) squares[item.row][item.col].piece = { ...item.piece };

  return {
    ...initial,
    squares,
    senteHand: senteHand.map((handPiece) => ({ ...handPiece })),
    goteHand: goteHand.map((handPiece) => ({ ...handPiece })),
    turn,
    ...overrides,
  };
}

function opponentOf(player: Player): Player {
  return player === 'sente' ? 'gote' : 'sente';
}

/** A tempting silver capture is immediately recaptured by the opposing rook. */
function recaptureTrapState(turn: Player = 'sente'): BoardState {
  const opponent = opponentOf(turn);
  const forwardTarget = turn === 'sente' ? 3 : 5;
  return createState([
    { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
    { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
    { row: 4, col: 4, piece: piece(`${turn}-rook`, 'rook', turn) },
    { row: forwardTarget, col: 4, piece: piece(`${opponent}-pawn`, 'pawn', opponent) },
    { row: 4, col: 5, piece: piece(`${opponent}-silver`, 'silver', opponent) },
    { row: 4, col: 6, piece: piece(`${opponent}-recapturing-rook`, 'rook', opponent) },
  ], [], [], turn);
}

/**
 * The knight pins itself in front of its king, leaving only the pawn move.
 * After that move Gote can checkmate through the existing rook-capture path.
 */
function forcedLossAfterEveryRootActionState(): BoardState {
  return createState([
    { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
    { row: 7, col: 4, piece: piece('sente-knight', 'knight', 'sente') },
    { row: 6, col: 0, piece: piece('sente-pawn', 'pawn', 'sente') },
    { row: 6, col: 4, piece: piece('gote-rook', 'rook', 'gote') },
    { row: 6, col: 3, piece: piece('gote-gold', 'gold', 'gote') },
    { row: 6, col: 5, piece: piece('gote-pawn', 'pawn', 'gote') },
    { row: 6, col: 1, piece: piece('left-escape-guard', 'bishop', 'gote') },
    { row: 6, col: 7, piece: piece('right-escape-guard', 'bishop', 'gote') },
  ]);
}

function execute(state: BoardState, action: LegalAction): BoardState {
  const result = executeLegalAction(cloneBoardState(state), action);
  expect(result.type).toBe('applied');
  if (result.type !== 'applied') throw new Error('Test legal action was rejected.');
  return result.state;
}

function findMove(
  actions: LegalAction[],
  from: { row: number; col: number },
  to: { row: number; col: number }
): LegalAction {
  const action = actions.find(
    (candidate) => candidate.kind === 'move' &&
      candidate.from.row === from.row && candidate.from.col === from.col &&
      candidate.to.row === to.row && candidate.to.col === to.col
  );
  if (!action) throw new Error('Expected move was not legal in the test position.');
  return action;
}

describe('探索用局面評価', () => {
  it('active/checkでは既存の駒得評価を視点とカスタム評価表を保って使う', () => {
    const state = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
      { row: 4, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 4, col: 5, piece: piece('gote-silver', 'silver', 'gote') },
    ]);
    const table: MaterialValueTable = {
      unpromoted: { pawn: 1, lance: 2, knight: 3, silver: 5, gold: 6, bishop: 7, rook: 11, king: 0 },
      promoted: { pawn: 12, lance: 13, knight: 14, silver: 15, bishop: 16, rook: 17 },
    };

    expect(evaluateSearchPosition(state, 'sente', table)).toBe(evaluateMaterial(state, 'sente', table));
    expect(evaluateSearchPosition({ ...state, status: 'check' }, 'gote', table)).toBe(
      evaluateMaterial(state, 'gote', table)
    );
  });

  it.each([
    [{ winner: 'sente', loser: 'gote', endReason: 'checkmate' } satisfies GameResult, Number.POSITIVE_INFINITY],
    [{ winner: 'gote', loser: 'sente', endReason: 'resignation' } satisfies GameResult, Number.NEGATIVE_INFINITY],
    [{ winner: 'gote', loser: 'sente', endReason: 'foul_loss', foulReason: 'nifu' } satisfies GameResult, Number.NEGATIVE_INFINITY],
  ])('勝敗理由にかかわらず勝敗を有限の駒得より優先する', (result, expected) => {
    const state = createState([
      { row: 4, col: 4, piece: piece('sente-material', 'rook', 'sente') },
    ], [], [], 'sente', { status: 'ended', result });

    expect(evaluateSearchPosition(state, 'sente')).toBe(expected);
    expect(evaluateSearchPosition(state, 'gote')).toBe(-expected);
  });

  it.each([
    { winner: null, loser: null, endReason: 'repetition' },
    { winner: null, loser: null, endReason: 'five_hundred_move_jishogi' },
    { winner: null, loser: null, endReason: 'entering_king_draw' },
  ] as const satisfies readonly GameResult[])('勝者のない$endReasonを引き分けとして評価する', (result) => {
    const state = createState([], [], [], 'sente', { status: 'ended', result });
    expect(evaluateSearchPosition(state, 'sente')).toBe(0);
    expect(evaluateSearchPosition(state, 'gote')).toBe(0);
  });

  it('終局状態とresultの矛盾を通常の駒得として扱わず、入力も変更しない', () => {
    const state = createState([{ row: 4, col: 4, piece: piece('rook', 'rook', 'sente') }]);
    const snapshot = JSON.stringify(state);

    expect(() => evaluateSearchPosition({ ...state, status: 'ended', result: null }, 'sente')).toThrow(/result/);
    expect(() => evaluateSearchPosition({ ...state, result: { winner: 'sente', loser: 'gote', endReason: 'checkmate' } }, 'sente')).toThrow(/Non-ended/);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('2手読みミニマックスAI', () => {
  it('全root候補の最小評価が-∞でも固定順の最初の合法手を返す', () => {
    const state = forcedLossAfterEveryRootActionState();
    const snapshot = JSON.stringify(state);
    const rootActions = getLegalActions(state);

    expect(rootActions).toHaveLength(1);
    const worstEvaluations = rootActions.map((rootAction) => {
      const afterRootAction = execute(state, rootAction);
      const replies = getLegalActions(afterRootAction);
      expect(replies.length).toBeGreaterThan(0);
      return Math.min(...replies.map((reply) =>
        evaluateSearchPosition(execute(afterRootAction, reply), state.turn)
      ));
    });

    expect(worstEvaluations).toEqual([Number.NEGATIVE_INFINITY]);
    expect(selectBestTwoPlyMinimaxAction(state)).toEqual(rootActions[0]);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(selectBestTwoPlyMinimaxAction({
      ...state,
      status: 'ended',
      result: { winner: null, loser: null, endReason: 'repetition' },
    })).toBeNull();
  });

  it('目先の駒得後の取り返しを読んで、1手読みAIとは異なる安全な手を選ぶ', () => {
    const state = recaptureTrapState();
    const onePly = selectBestMaterialAction(state, 'sente');
    const twoPly = selectBestTwoPlyMinimaxAction(state);

    expect(onePly).toMatchObject({ kind: 'move', from: { row: 4, col: 4 }, to: { row: 4, col: 5 } });
    expect(twoPly).toMatchObject({ kind: 'move', from: { row: 4, col: 4 }, to: { row: 4, col: 0 } });
    if (!onePly || !twoPly) return;

    const afterTemptingCapture = execute(state, onePly);
    const recapture = findMove(getLegalActions(afterTemptingCapture), { row: 4, col: 6 }, { row: 4, col: 5 });
    const afterRecapture = execute(afterTemptingCapture, recapture);
    const afterSafeMove = execute(state, twoPly);
    const worstSafeReplyEvaluation = Math.min(...getLegalActions(afterSafeMove).map((reply) =>
      evaluateSearchPosition(execute(afterSafeMove, reply), 'sente')
    ));

    expect(evaluateSearchPosition(afterRecapture, 'sente')).toBeLessThan(
      worstSafeReplyEvaluation
    );
  });

  it('開始手番をrootPlayerに固定し、後手でも同じ最小化応手を読む', () => {
    const state = recaptureTrapState('gote');
    const selected = selectBestTwoPlyMinimaxAction(state);

    expect(selected).toMatchObject({ kind: 'move', from: { row: 4, col: 4 } });
    expect(selected).not.toMatchObject({ kind: 'move', to: { row: 4, col: 5 } });
    if (!selected) return;
    const afterRootAction = execute(state, selected);
    expect(afterRootAction.turn).toBe('sente');
    expect(evaluateSearchPosition(afterRootAction, 'gote')).toBe(
      -evaluateSearchPosition(afterRootAction, 'sente')
    );
  });

  it('詰みになる最初の手を有限の駒得候補より優先する', () => {
    const state = createState([
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 4, piece: piece('gote-king', 'king', 'gote') },
      { row: 2, col: 4, piece: piece('mating-rook', 'rook', 'sente') },
      { row: 1, col: 4, piece: piece('captured-silver', 'silver', 'gote') },
      { row: 2, col: 3, piece: piece('rook-defender', 'gold', 'sente') },
      { row: 2, col: 1, piece: piece('left-escape-guard', 'bishop', 'sente') },
      { row: 2, col: 7, piece: piece('right-escape-guard', 'bishop', 'sente') },
    ]);
    const selected = selectBestTwoPlyMinimaxAction(state);

    if (!selected) return;
    const afterMate = execute(state, selected);
    expect(afterMate.status).toBe('ended');
    expect(evaluateSearchPosition(afterMate, 'sente')).toBe(Number.POSITIVE_INFINITY);
  });

  it('カスタム評価表、同点の固定順、空候補、入力局面の非破壊を保つ', () => {
    const simpleCapture = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
      { row: 4, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 3, col: 4, piece: piece('gote-pawn', 'pawn', 'gote') },
      { row: 4, col: 5, piece: piece('gote-silver', 'silver', 'gote') },
    ]);
    const pawnFavoredTable: MaterialValueTable = {
      unpromoted: { pawn: 10000, lance: 300, knight: 300, silver: 1, gold: 500, bishop: 800, rook: 1, king: 0 },
      promoted: { pawn: 500, lance: 500, knight: 500, silver: 500, bishop: 1000, rook: 1200 },
    };
    const tieState = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
    ]);
    const snapshot = JSON.stringify(simpleCapture);

    expect(selectBestTwoPlyMinimaxAction(simpleCapture, pawnFavoredTable)).toMatchObject({
      kind: 'move', from: { row: 4, col: 4 }, to: { row: 3, col: 4 },
    });
    expect(selectBestTwoPlyMinimaxAction(tieState)).toEqual(getLegalActions(tieState)[0]);
    expect(selectBestTwoPlyMinimaxAction({ ...tieState, status: 'ended', result: { winner: null, loser: null, endReason: 'repetition' } })).toBeNull();
    expect(JSON.stringify(simpleCapture)).toBe(snapshot);
  });
});

describe('2手読みミニマックスAIの探索計測', () => {
  it('既存の選択手を保ったまま、候補評価と決定的な調査局面数を集約する', () => {
    const state = recaptureTrapState();
    const snapshot = JSON.stringify(state);
    const rootActions = getLegalActions(state);
    const expectedVisitedPositionCount = rootActions.reduce((count, action) => {
      const afterRootAction = execute(state, action);
      return count + 1 + (afterRootAction.status === 'ended'
        ? 0
        : getLegalActions(afterRootAction).length);
    }, 0);

    const result = analyzeTwoPlyMinimaxSearch(state);
    const selectedCandidate = result.topCandidates.find((candidate) =>
      JSON.stringify(candidate.action) === JSON.stringify(result.selectedAction)
    );

    expect(result.selectedAction).toEqual(selectBestTwoPlyMinimaxAction(state));
    expect(result.rootLegalActionCount).toBe(rootActions.length);
    expect(result.visitedPositionCount).toBe(expectedVisitedPositionCount);
    expect(result.depth).toBe(2);
    expect(result.selectedEvaluation).toBe(selectedCandidate?.evaluation);
    expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('上位候補をAI視点の降順かつ固定順の同点処理で最大3件にする', () => {
    const state = recaptureTrapState();
    const result = analyzeTwoPlyMinimaxSearch(state);

    expect(result.topCandidates).toHaveLength(Math.min(3, getLegalActions(state).length));
    for (let index = 1; index < result.topCandidates.length; index += 1) {
      expect(result.topCandidates[index - 1].evaluation).toBeGreaterThanOrEqual(
        result.topCandidates[index].evaluation
      );
    }

    const tieState = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
    ]);
    const tieResult = analyzeTwoPlyMinimaxSearch(tieState);
    expect(tieResult.selectedAction).toEqual(getLegalActions(tieState)[0]);
    expect(tieResult.topCandidates[0]?.action).toEqual(getLegalActions(tieState)[0]);
  });

  it('後手でも評価と候補順をroot AI視点で返す', () => {
    const state = recaptureTrapState('gote');
    const result = analyzeTwoPlyMinimaxSearch(state);
    if (!result.selectedAction) throw new Error('Expected a legal Gote action.');
    const afterSelectedAction = execute(state, result.selectedAction);
    const expectedGotePerspectiveEvaluation = Math.min(...getLegalActions(afterSelectedAction).map((reply) =>
      evaluateSearchPosition(execute(afterSelectedAction, reply), 'gote')
    ));

    expect(result.selectedAction).toEqual(selectBestTwoPlyMinimaxAction(state));
    expect(result.selectedEvaluation).toBe(expectedGotePerspectiveEvaluation);
    for (let index = 1; index < result.topCandidates.length; index += 1) {
      expect(result.topCandidates[index - 1].evaluation).toBeGreaterThanOrEqual(
        result.topCandidates[index].evaluation
      );
    }
  });

  it('合法手が3件未満でも結果を返し、終局局面では既存どおり手を選ばない', () => {
    const forcedLoss = forcedLossAfterEveryRootActionState();
    const result = analyzeTwoPlyMinimaxSearch(forcedLoss);
    const ended = {
      ...forcedLoss,
      status: 'ended' as const,
      result: { winner: null, loser: null, endReason: 'repetition' } satisfies GameResult,
    };

    expect(result.rootLegalActionCount).toBe(1);
    expect(result.topCandidates).toHaveLength(1);
    expect(result.selectedAction).toEqual(getLegalActions(forcedLoss)[0]);
    expect(analyzeTwoPlyMinimaxSearch(ended)).toMatchObject({
      selectedAction: null,
      selectedEvaluation: null,
      rootLegalActionCount: 0,
      visitedPositionCount: 0,
      topCandidates: [],
    });
  });
});
