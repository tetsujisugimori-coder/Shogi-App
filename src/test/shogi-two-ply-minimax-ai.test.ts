import { describe, expect, it } from 'vitest';
import {
  cloneBoardSquares,
  cloneBoardState,
  analyzeAlphaBetaSearch,
  analyzeIterativeDeepeningAlphaBetaSearch,
  analyzeTwoPlyAlphaBetaSearch,
  analyzeTwoPlyMinimaxSearch,
  evaluateMaterial,
  evaluateSearchPosition,
  executeLegalAction,
  getLegalActions,
  selectBestMaterialAction,
  selectBestAlphaBetaAction,
  selectBestIterativeDeepeningAlphaBetaAction,
  selectBestTwoPlyAlphaBetaAction,
  selectBestTwoPlyMinimaxAction,
  TWO_PLY_ALPHA_BETA_SEARCH_DEPTH,
  type LegalAction,
  type MaterialValueTable,
} from '../domain/shogi';
import {
  orderAlphaBetaNodeActions,
  orderIterativeDeepeningRootActions,
} from '../domain/shogi/twoPlyAlphaBetaAi';
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

/** Contains one action from each move-ordering class plus a legal drop. */
function moveOrderingActionState(): BoardState {
  return createState([
    { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
    { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
    { row: 1, col: 4, piece: piece('promotion-capturing-pawn', 'pawn', 'sente') },
    { row: 0, col: 4, piece: piece('captured-silver', 'silver', 'gote') },
    { row: 4, col: 4, piece: piece('capturing-rook', 'rook', 'sente') },
    { row: 4, col: 5, piece: piece('captured-pawn', 'pawn', 'gote') },
    { row: 2, col: 2, piece: piece('promotion-pawn', 'pawn', 'sente') },
  ], [piece('sente-hand-gold', 'gold', 'sente')]);
}

/** A depth-three fixture where an early tactical reply improves cutoffs. */
function moveOrderingBenefitState(): BoardState {
  return createState([
    { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
    { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
    { row: 4, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
    { row: 3, col: 4, piece: piece('gote-pawn-forward', 'pawn', 'gote') },
    { row: 4, col: 5, piece: piece('gote-silver', 'silver', 'gote') },
    { row: 4, col: 6, piece: piece('gote-rook', 'rook', 'gote') },
    { row: 5, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') },
  ]);
}

function execute(state: BoardState, action: LegalAction): BoardState {
  const result = executeLegalAction(cloneBoardState(state), action);
  expect(result.type).toBe('applied');
  if (result.type !== 'applied') throw new Error('Test legal action was rejected.');
  return result.state;
}

/**
 * A deliberately small, test-only minimax reference. It uses the public
 * search primitives but does not carry alpha or beta, so it explores every
 * legal branch up to the supplied ply depth. Production code must continue to
 * use the single alpha-beta implementation instead of this helper.
 */
function analyzeUnprunedMinimaxForTest(
  state: BoardState,
  depth: number,
  valueTable?: MaterialValueTable
): {
  selectedAction: LegalAction | null;
  selectedEvaluation: number | null;
  visitedPositionCount: number;
  deepestEvaluatedPly: number;
  terminalLeafCount: number;
} {
  const rootPlayer = state.turn;
  let visitedPositionCount = 0;
  let deepestEvaluatedPly = 0;
  let terminalLeafCount = 0;

  const evaluateLeaf = (position: BoardState, ply: number): number => {
    deepestEvaluatedPly = Math.max(deepestEvaluatedPly, ply);
    if (position.status === 'ended') terminalLeafCount += 1;
    return evaluateSearchPosition(position, rootPlayer, valueTable);
  };

  const searchNode = (position: BoardState, remainingDepth: number, maximizing: boolean, ply: number): number => {
    if (position.status === 'ended' || remainingDepth === 0) {
      return evaluateLeaf(position, ply);
    }

    const actions = getLegalActions(position);
    if (actions.length === 0) return evaluateLeaf(position, ply);

    let value = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    for (const action of actions) {
      const child = execute(position, action);
      visitedPositionCount += 1;
      const childValue = searchNode(child, remainingDepth - 1, !maximizing, ply + 1);
      if (maximizing ? childValue > value : childValue < value) value = childValue;
    }
    return value;
  };

  if (depth === 0) {
    return {
      selectedAction: null,
      selectedEvaluation: evaluateLeaf(state, 0),
      visitedPositionCount,
      deepestEvaluatedPly,
      terminalLeafCount,
    };
  }

  let selectedAction: LegalAction | null = null;
  let selectedEvaluation = Number.NEGATIVE_INFINITY;
  for (const action of getLegalActions(state)) {
    const child = execute(state, action);
    visitedPositionCount += 1;
    const candidateEvaluation = searchNode(child, depth - 1, false, 1);
    if (selectedAction === null || candidateEvaluation > selectedEvaluation) {
      selectedAction = action;
      selectedEvaluation = candidateEvaluation;
    }
  }

  return {
    selectedAction,
    selectedEvaluation: selectedAction === null ? null : selectedEvaluation,
    visitedPositionCount,
    deepestEvaluatedPly,
    terminalLeafCount,
  };
}

/**
 * Test-only alpha-beta baseline that intentionally keeps every non-root
 * `getLegalActions` order. It makes the move-ordering node reduction
 * measurable without adding another production search implementation.
 */
function analyzeUnorderedAlphaBetaForTest(
  state: BoardState,
  depth: number,
  valueTable?: MaterialValueTable
): {
  selectedAction: LegalAction | null;
  selectedEvaluation: number | null;
  visitedPositionCount: number;
  cutoffCount: number;
  skippedActionCount: number;
} {
  const rootPlayer = state.turn;
  let visitedPositionCount = 0;
  let cutoffCount = 0;
  let skippedActionCount = 0;

  const searchNode = (
    position: BoardState,
    remainingDepth: number,
    maximizing: boolean,
    alpha: number,
    beta: number
  ): number => {
    if (position.status === 'ended' || remainingDepth === 0) {
      return evaluateSearchPosition(position, rootPlayer, valueTable);
    }

    const actions = getLegalActions(position);
    if (actions.length === 0) return evaluateSearchPosition(position, rootPlayer, valueTable);

    let value = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
      const child = execute(position, actions[actionIndex]);
      visitedPositionCount += 1;
      const childValue = searchNode(child, remainingDepth - 1, !maximizing, alpha, beta);
      if (maximizing) {
        if (childValue > value) value = childValue;
        if (value > alpha) alpha = value;
      } else {
        if (childValue < value) value = childValue;
        if (value < beta) beta = value;
      }

      const remainingActionCount = actions.length - actionIndex - 1;
      if (alpha >= beta && remainingActionCount > 0) {
        cutoffCount += 1;
        skippedActionCount += remainingActionCount;
        break;
      }
    }
    return value;
  };

  if (depth === 0) {
    return {
      selectedAction: null,
      selectedEvaluation: evaluateSearchPosition(state, rootPlayer, valueTable),
      visitedPositionCount,
      cutoffCount,
      skippedActionCount,
    };
  }

  let selectedAction: LegalAction | null = null;
  let selectedEvaluation = Number.NEGATIVE_INFINITY;
  let alpha = Number.NEGATIVE_INFINITY;
  const beta = Number.POSITIVE_INFINITY;
  for (const action of getLegalActions(state)) {
    const child = execute(state, action);
    visitedPositionCount += 1;
    const candidateEvaluation = searchNode(child, depth - 1, false, alpha, beta);
    if (selectedAction === null || candidateEvaluation > selectedEvaluation) {
      selectedAction = action;
      selectedEvaluation = candidateEvaluation;
    }
    if (selectedEvaluation > alpha) alpha = selectedEvaluation;
  }

  return {
    selectedAction,
    selectedEvaluation: selectedAction === null ? null : selectedEvaluation,
    visitedPositionCount,
    cutoffCount,
    skippedActionCount,
  };
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

describe('再帰型αβ探索の手の並べ替え', () => {
  it('駒取り＋成り、駒取り、成り、その他の優先順と同一優先度の元順を保つ', () => {
    const state = moveOrderingActionState();
    const actions = getLegalActions(state);
    const capturePromotion = actions.find((action) => action.kind === 'move' &&
      action.from.row === 1 && action.from.col === 4 && action.to.row === 0 && action.to.col === 4 &&
      action.promotion === 'promote');
    const capture = actions.find((action) => action.kind === 'move' &&
      action.from.row === 4 && action.from.col === 4 && action.to.row === 4 && action.to.col === 5);
    const promotion = actions.find((action) => action.kind === 'move' &&
      action.from.row === 2 && action.from.col === 2 && action.to.row === 1 && action.to.col === 2 &&
      action.promotion === 'promote');
    const normal = actions.find((action) => action.kind === 'move' &&
      action.from.row === 4 && action.from.col === 4 && action.to.row === 4 && action.to.col === 3);
    const anotherNormal = actions.find((action) => action.kind === 'move' &&
      action.from.row === 4 && action.from.col === 4 && action.to.row === 3 && action.to.col === 4 &&
      action.promotion === 'none');
    const drop = actions.find((action) => action.kind === 'drop');
    if (!capturePromotion || !capture || !promotion || !normal || !anotherNormal || !drop) {
      throw new Error('Expected every move-ordering class in the fixture.');
    }

    const source = [normal, drop, anotherNormal, promotion, capture, capturePromotion];

    expect(orderAlphaBetaNodeActions(state, source)).toEqual([
      capturePromotion,
      capture,
      promotion,
      normal,
      drop,
      anotherNormal,
    ]);
  });

  it('駒打ちをその他として扱い、元の候補配列と入力局面を変更しない', () => {
    const state = moveOrderingActionState();
    const snapshot = JSON.stringify(state);
    const source = getLegalActions(state);
    const sourceSnapshot = [...source];
    const ordered = orderAlphaBetaNodeActions(state, source);
    const firstDropIndex = ordered.findIndex((action) => action.kind === 'drop');
    const firstPriorityThreeIndex = ordered.findIndex((action) => action.kind === 'move' &&
      action.promotion !== 'promote' && state.squares[action.to.row][action.to.col].piece === null);

    expect(ordered).not.toBe(source);
    expect(source).toEqual(sourceSnapshot);
    expect(firstDropIndex).toBeGreaterThanOrEqual(firstPriorityThreeIndex);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('root候補は並べ替えず、同点では元の先頭手を選ぶ', () => {
    const state = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
      { row: 4, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 4, col: 5, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);
    const rootActions = getLegalActions(state);
    const zeroValueTable: MaterialValueTable = {
      unpromoted: { pawn: 0, lance: 0, knight: 0, silver: 0, gold: 0, bishop: 0, rook: 0, king: 0 },
      promoted: { pawn: 0, lance: 0, knight: 0, silver: 0, bishop: 0, rook: 0 },
    };

    expect(orderAlphaBetaNodeActions(state, rootActions)[0]).not.toEqual(rootActions[0]);
    expect(analyzeAlphaBetaSearch(state, 1, zeroValueTable).selectedAction).toEqual(rootActions[0]);
  });

  it('深さ3では並べ替えなしαβより少ない局面を生成し、選択手と評価値を保つ', () => {
    const state = moveOrderingBenefitState();
    const unordered = analyzeUnorderedAlphaBetaForTest(state, 3);
    const ordered = analyzeAlphaBetaSearch(state, 3);
    const minimax = analyzeUnprunedMinimaxForTest(state, 3);

    expect(ordered.selectedAction).toEqual(unordered.selectedAction);
    expect(ordered.selectedEvaluation).toBe(unordered.selectedEvaluation);
    expect(ordered.selectedAction).toEqual(minimax.selectedAction);
    expect(ordered.selectedEvaluation).toBe(minimax.selectedEvaluation);
    expect(ordered.visitedPositionCount).toBeLessThan(unordered.visitedPositionCount);
  });
});

describe('反復深化αβ探索', () => {
  it('最大深さ3では深さ1、2、3を順に完了し、最深反復を最終結果として返す', () => {
    const state = moveOrderingBenefitState();
    const directDepth3 = analyzeAlphaBetaSearch(state, 3, undefined, () => 0);
    const iterative = analyzeIterativeDeepeningAlphaBetaSearch(state, 3, undefined, () => 0);

    expect(iterative.iterations.map((iteration) => iteration.depth)).toEqual([1, 2, 3]);
    expect(iterative.selectedAction).toEqual(directDepth3.selectedAction);
    expect(iterative.selectedEvaluation).toBe(directDepth3.selectedEvaluation);
    expect(iterative.visitedPositionCount).toBe(iterative.iterations[2].visitedPositionCount);
    expect(iterative.cutoffCount).toBe(iterative.iterations[2].cutoffCount);
    expect(iterative.skippedActionCount).toBe(iterative.iterations[2].skippedActionCount);
  });

  it('最大深さ1では深さ1だけを実行し、その結果を返す', () => {
    const state = recaptureTrapState();
    const directDepth1 = analyzeAlphaBetaSearch(state, 1, undefined, () => 0);
    const iterative = analyzeIterativeDeepeningAlphaBetaSearch(state, 1, undefined, () => 0);

    expect(iterative.iterations).toHaveLength(1);
    expect(iterative.iterations[0]).toMatchObject(directDepth1);
    expect(iterative.selectedAction).toEqual(directDepth1.selectedAction);
    expect(selectBestIterativeDeepeningAlphaBetaAction(state, 1)).toEqual(directDepth1.selectedAction);
  });

  it('前回最善手をroot先頭へ置き、残りは既存の分類順にする', () => {
    const state = moveOrderingActionState();
    const rootActions = getLegalActions(state);
    const previousBestAction = rootActions.find((action) => action.kind === 'move' &&
      action.from.row === 4 && action.from.col === 4 && action.to.row === 4 && action.to.col === 5);
    if (!previousBestAction) throw new Error('Expected a non-leading previous best action.');

    const ordered = orderIterativeDeepeningRootActions(state, rootActions, previousBestAction);
    const expectedRemaining = orderAlphaBetaNodeActions(
      state,
      rootActions.filter((action) => action !== previousBestAction)
    );

    expect(ordered[0]).toEqual(previousBestAction);
    expect(ordered.slice(1)).toEqual(expectedRemaining);
    expect(rootActions).not.toEqual(ordered);
  });

  it('前回最善手が現局面の合法手にない場合は既存root順で続行する', () => {
    const state = moveOrderingActionState();
    const rootActions = getLegalActions(state);
    const unavailableAction = getLegalActions(execute(state, rootActions[0]))[0];

    expect(orderIterativeDeepeningRootActions(state, rootActions, unavailableAction)).toEqual(rootActions);
    expect(analyzeIterativeDeepeningAlphaBetaSearch(state, 2).selectedAction).toEqual(
      analyzeAlphaBetaSearch(state, 2).selectedAction
    );
  });

  it('探索順が変わっても同点時は元の合法手順の先頭を選ぶ', () => {
    const state = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
      { row: 4, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 4, col: 5, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);
    const rootActions = getLegalActions(state);
    const zeroValueTable: MaterialValueTable = {
      unpromoted: { pawn: 0, lance: 0, knight: 0, silver: 0, gold: 0, bishop: 0, rook: 0, king: 0 },
      promoted: { pawn: 0, lance: 0, knight: 0, silver: 0, bishop: 0, rook: 0 },
    };

    const forcedReorder = orderIterativeDeepeningRootActions(state, rootActions, rootActions.at(-1) ?? null);
    expect(forcedReorder[0]).not.toEqual(rootActions[0]);
    expect(analyzeIterativeDeepeningAlphaBetaSearch(state, 2, zeroValueTable).selectedAction).toEqual(rootActions[0]);
  });

  it('深さ別統計を独立して記録し、累計を二重加算しない', () => {
    const state = moveOrderingBenefitState();
    const iterative = analyzeIterativeDeepeningAlphaBetaSearch(state, 3, undefined, () => 0);
    const totals = iterative.iterations.reduce(
      (sum, iteration) => ({
        visited: sum.visited + iteration.visitedPositionCount,
        cutoffs: sum.cutoffs + iteration.cutoffCount,
        skipped: sum.skipped + iteration.skippedActionCount,
      }),
      { visited: 0, cutoffs: 0, skipped: 0 }
    );

    expect(iterative.iterations.every((iteration) => iteration.rootLegalActionCount > 0)).toBe(true);
    expect(iterative.totalVisitedPositionCount).toBe(totals.visited);
    expect(iterative.totalCutoffCount).toBe(totals.cutoffs);
    expect(iterative.totalSkippedActionCount).toBe(totals.skipped);
    expect(iterative.totalVisitedPositionCount).toBeGreaterThan(iterative.visitedPositionCount);
  });

  it('専用局面の深さ3でも選択手4,4 -> 4,0と評価-600を保ち、結果と統計は決定的', () => {
    const state = moveOrderingBenefitState();
    const snapshot = JSON.stringify(state);
    const first = analyzeIterativeDeepeningAlphaBetaSearch(state, 3, undefined, () => 0);
    const second = analyzeIterativeDeepeningAlphaBetaSearch(state, 3, undefined, () => 0);

    expect(first.selectedAction).toMatchObject({
      kind: 'move', from: { row: 4, col: 4 }, to: { row: 4, col: 0 },
    });
    expect(first.selectedEvaluation).toBe(-600);
    expect(second).toMatchObject({
      selectedAction: first.selectedAction,
      selectedEvaluation: first.selectedEvaluation,
      visitedPositionCount: first.visitedPositionCount,
      cutoffCount: first.cutoffCount,
      skippedActionCount: first.skippedActionCount,
      totalVisitedPositionCount: first.totalVisitedPositionCount,
      totalCutoffCount: first.totalCutoffCount,
      totalSkippedActionCount: first.totalSkippedActionCount,
    });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('終局局面でも各反復を安全に完了し、無効な最大深さを拒否する', () => {
    const ended = {
      ...recaptureTrapState(),
      status: 'ended' as const,
      result: { winner: null, loser: null, endReason: 'repetition' } satisfies GameResult,
    };
    const result = analyzeIterativeDeepeningAlphaBetaSearch(ended, 3, undefined, () => 0);

    expect(result.iterations).toHaveLength(3);
    expect(result.iterations.every((iteration) => iteration.selectedAction === null)).toBe(true);
    expect(result.totalVisitedPositionCount).toBe(0);
    expect(result.totalCutoffCount).toBe(0);
    expect(result.totalSkippedActionCount).toBe(0);
    expect(() => analyzeIterativeDeepeningAlphaBetaSearch(ended, 0)).toThrow(/positive integer/);
    expect(() => analyzeIterativeDeepeningAlphaBetaSearch(ended, -1)).toThrow(/non-negative integer/);
    expect(() => analyzeIterativeDeepeningAlphaBetaSearch(ended, 1.5)).toThrow(/non-negative integer/);
  });
});

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

describe('2手読みαβ枝刈り探索', () => {
  it('通常局面で既存ミニマックスと選択手・選択評価値を一致させ、入力局面を変えない', () => {
    const state = recaptureTrapState();
    const snapshot = JSON.stringify(state);
    const minimax = analyzeTwoPlyMinimaxSearch(state);
    const alphaBeta = analyzeTwoPlyAlphaBetaSearch(state);

    expect(alphaBeta.selectedAction).toEqual(minimax.selectedAction);
    expect(alphaBeta.selectedEvaluation).toBe(minimax.selectedEvaluation);
    expect(selectBestTwoPlyAlphaBetaAction(state)).toEqual(selectBestTwoPlyMinimaxAction(state));
    expect(alphaBeta.rootLegalActionCount).toBe(getLegalActions(state).length);
    expect(alphaBeta.depth).toBe(2);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('先手・後手とも開始時のroot AI視点を固定し、カスタム駒価値表でもミニマックスと一致する', () => {
    const table: MaterialValueTable = {
      unpromoted: { pawn: 13, lance: 2, knight: 3, silver: 17, gold: 5, bishop: 7, rook: 19, king: 0 },
      promoted: { pawn: 23, lance: 29, knight: 31, silver: 37, bishop: 41, rook: 43 },
    };

    for (const turn of ['sente', 'gote'] as const) {
      const state = recaptureTrapState(turn);
      const minimax = analyzeTwoPlyMinimaxSearch(state, table);
      const alphaBeta = analyzeTwoPlyAlphaBetaSearch(state, table);

      expect(alphaBeta.selectedAction).toEqual(minimax.selectedAction);
      expect(alphaBeta.selectedEvaluation).toBe(minimax.selectedEvaluation);
      if (!alphaBeta.selectedAction) throw new Error('Expected a legal root action.');
      const afterRootAction = execute(state, alphaBeta.selectedAction);
      const replies = getLegalActions(afterRootAction);
      expect(alphaBeta.selectedEvaluation).toBe(Math.min(...replies.map((reply) =>
        evaluateSearchPosition(execute(afterRootAction, reply), turn, table)
      )));
    }
  });

  it('同点では固定順の先頭を選び、全候補が-∞でも最初の合法手を返す', () => {
    const tieState = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
    ]);
    const forcedLoss = forcedLossAfterEveryRootActionState();

    expect(selectBestTwoPlyAlphaBetaAction(tieState)).toEqual(getLegalActions(tieState)[0]);
    expect(selectBestTwoPlyAlphaBetaAction(forcedLoss)).toEqual(getLegalActions(forcedLoss)[0]);
    expect(analyzeTwoPlyAlphaBetaSearch(forcedLoss).selectedEvaluation).toBe(Number.NEGATIVE_INFINITY);
  });

  it('詰みの+∞を有限の駒得候補より優先して、ミニマックスと一致する', () => {
    const state = createState([
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 4, piece: piece('gote-king', 'king', 'gote') },
      { row: 2, col: 4, piece: piece('mating-rook', 'rook', 'sente') },
      { row: 1, col: 4, piece: piece('captured-silver', 'silver', 'gote') },
      { row: 2, col: 3, piece: piece('rook-defender', 'gold', 'sente') },
      { row: 2, col: 1, piece: piece('left-escape-guard', 'bishop', 'sente') },
      { row: 2, col: 7, piece: piece('right-escape-guard', 'bishop', 'sente') },
    ]);
    const minimax = analyzeTwoPlyMinimaxSearch(state);
    const alphaBeta = analyzeTwoPlyAlphaBetaSearch(state);

    expect(alphaBeta.selectedAction).toEqual(minimax.selectedAction);
    expect(alphaBeta.selectedEvaluation).toBe(Number.POSITIVE_INFINITY);
    if (!alphaBeta.selectedAction) throw new Error('Expected a mating action.');
    expect(evaluateSearchPosition(execute(state, alphaBeta.selectedAction), 'sente')).toBe(Number.POSITIVE_INFINITY);
  });

  it('終局済み局面では手を選ばず、枝刈り計測はすべて0にする', () => {
    const ended = {
      ...forcedLossAfterEveryRootActionState(),
      status: 'ended' as const,
      result: { winner: null, loser: null, endReason: 'repetition' } satisfies GameResult,
    };

    expect(analyzeTwoPlyAlphaBetaSearch(ended, undefined, () => 50)).toMatchObject({
      selectedAction: null,
      selectedEvaluation: null,
      rootLegalActionCount: 0,
      visitedPositionCount: 0,
      depth: 2,
      elapsedMilliseconds: 0,
      prunedRootCandidateCount: 0,
      skippedOpponentReplyCount: 0,
    });
  });

  it('打ち切ったroot候補数と未実行応手数を、実際に省略した探索局面として数える', () => {
    const state = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
    ]);
    const minimax = analyzeTwoPlyMinimaxSearch(state);
    const alphaBeta = analyzeTwoPlyAlphaBetaSearch(state);

    // The first root action establishes alpha=0. Later tied candidates have
    // more legal replies, so their first evaluated reply proves they cannot
    // displace the fixed-order winner and leaves replies unexecuted.
    expect(alphaBeta.prunedRootCandidateCount).toBeGreaterThanOrEqual(1);
    expect(alphaBeta.skippedOpponentReplyCount).toBeGreaterThan(0);
    expect(alphaBeta.visitedPositionCount).toBeLessThan(minimax.visitedPositionCount);
    expect(alphaBeta.visitedPositionCount + alphaBeta.skippedOpponentReplyCount).toBe(
      minimax.visitedPositionCount
    );
  });

  it('打ち切りが発生しない終局局面では、打ち切り計測を0のまま保つ', () => {
    const ended = {
      ...forcedLossAfterEveryRootActionState(),
      status: 'ended' as const,
      result: { winner: null, loser: null, endReason: 'entering_king_draw' } satisfies GameResult,
    };
    const result = analyzeTwoPlyAlphaBetaSearch(ended);

    expect(result.prunedRootCandidateCount).toBe(0);
    expect(result.skippedOpponentReplyCount).toBe(0);
  });

  it('注入時計は経過時間だけを測り、決定的な探索結果を変えない', () => {
    const state = recaptureTrapState();
    const readings = [100, 137];
    const clock = () => readings.shift() ?? 137;
    const measured = analyzeTwoPlyAlphaBetaSearch(state, undefined, clock);
    const baseline = analyzeTwoPlyAlphaBetaSearch(state, undefined, () => 0);

    expect(measured.elapsedMilliseconds).toBe(37);
    expect(measured.selectedAction).toEqual(baseline.selectedAction);
    expect(measured.selectedEvaluation).toBe(baseline.selectedEvaluation);
    expect(measured.visitedPositionCount).toBe(baseline.visitedPositionCount);
    expect(measured.prunedRootCandidateCount).toBe(baseline.prunedRootCandidateCount);
    expect(measured.skippedOpponentReplyCount).toBe(baseline.skippedOpponentReplyCount);
  });
});

describe('再帰型αβ枝刈り探索', () => {
  it('深さ2は旧2 plyミニマックスと互換ラッパーの選択手・評価値・統計を保つ', () => {
    const state = recaptureTrapState();
    const snapshot = JSON.stringify(state);
    const minimax = analyzeTwoPlyMinimaxSearch(state);
    const legacyTwoPly = analyzeTwoPlyAlphaBetaSearch(state);
    const recursive = analyzeAlphaBetaSearch(state, 2);

    expect(recursive.selectedAction).toEqual(minimax.selectedAction);
    expect(recursive.selectedEvaluation).toBe(minimax.selectedEvaluation);
    expect(recursive.selectedAction).toEqual(legacyTwoPly.selectedAction);
    expect(recursive.selectedEvaluation).toBe(legacyTwoPly.selectedEvaluation);
    expect(recursive.visitedPositionCount).toBe(legacyTwoPly.visitedPositionCount);
    expect(recursive.cutoffCount).toBe(legacyTwoPly.prunedRootCandidateCount);
    expect(recursive.skippedActionCount).toBe(legacyTwoPly.skippedOpponentReplyCount);
    expect(selectBestAlphaBetaAction(state, 2)).toEqual(selectBestTwoPlyAlphaBetaAction(state));
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('深さ0は局面だけを評価して子局面を生成せず、深さ1/2/3はrootを含むply数で読む', () => {
    const state = recaptureTrapState();
    const depth0 = analyzeAlphaBetaSearch(state, 0);
    const depth1 = analyzeAlphaBetaSearch(state, 1);
    const depth2 = analyzeAlphaBetaSearch(state, 2);
    const depth3 = analyzeAlphaBetaSearch(state, 3);

    expect(depth0).toMatchObject({
      selectedAction: null,
      selectedEvaluation: evaluateSearchPosition(state, state.turn),
      rootLegalActionCount: 0,
      visitedPositionCount: 0,
      cutoffCount: 0,
      skippedActionCount: 0,
    });
    // depth 1 generates root successors only. The recursive call receives
    // depth - 1, making depth 2 root/opponent and depth 3 root/opponent/root.
    expect(depth1.visitedPositionCount).toBe(getLegalActions(state).length);
    expect(depth2.visitedPositionCount).toBeGreaterThan(depth1.visitedPositionCount);
    expect(depth3.visitedPositionCount).toBeGreaterThan(depth2.visitedPositionCount);
    expect([depth1.depth, depth2.depth, depth3.depth]).toEqual([1, 2, 3]);
  });

  it('深さ3は合法手と探索統計を返し、入力局面を破壊せず決定的に完了する', () => {
    const state = recaptureTrapState();
    const snapshot = JSON.stringify(state);
    const first = analyzeAlphaBetaSearch(state, 3);
    const second = analyzeAlphaBetaSearch(state, 3);
    const rootActions = getLegalActions(state);

    expect(first.selectedAction).not.toBeNull();
    expect(rootActions).toContainEqual(first.selectedAction);
    expect(first.selectedAction).toEqual(second.selectedAction);
    expect(first.selectedEvaluation).toBe(second.selectedEvaluation);
    expect(first.visitedPositionCount).toBeGreaterThan(0);
    expect(first.cutoffCount).toBeGreaterThanOrEqual(0);
    expect(first.skippedActionCount).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('alpha >= betaのカットオフは結果を変えず、深さ1ではカットオフなしでも正しく探索する', () => {
    const tieState = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
    ]);
    const depth1 = analyzeAlphaBetaSearch(tieState, 1);
    const depth2 = analyzeAlphaBetaSearch(tieState, 2);
    const minimax = analyzeTwoPlyMinimaxSearch(tieState);

    expect(depth1.cutoffCount).toBe(0);
    expect(depth1.skippedActionCount).toBe(0);
    expect(depth1.selectedAction).toEqual(getLegalActions(tieState)[0]);
    expect(depth2.cutoffCount).toBeGreaterThanOrEqual(1);
    expect(depth2.skippedActionCount).toBeGreaterThan(0);
    expect(depth2.selectedAction).toEqual(minimax.selectedAction);
    expect(depth2.selectedEvaluation).toBe(minimax.selectedEvaluation);
    expect(depth2.visitedPositionCount).toBeLessThanOrEqual(minimax.visitedPositionCount);
  });

  it('終局・合法手なし局面では例外や無限再帰を起こさず、探索統計は探索ごとに初期化する', () => {
    const ended = {
      ...forcedLossAfterEveryRootActionState(),
      status: 'ended' as const,
      result: { winner: null, loser: null, endReason: 'repetition' } satisfies GameResult,
    };
    const active = recaptureTrapState();
    const first = analyzeAlphaBetaSearch(active, 2);
    const second = analyzeAlphaBetaSearch(active, 2);

    expect(() => analyzeAlphaBetaSearch(ended, 3)).not.toThrow();
    expect(analyzeAlphaBetaSearch(ended, 3)).toMatchObject({
      selectedAction: null,
      selectedEvaluation: null,
      rootLegalActionCount: 0,
      visitedPositionCount: 0,
      cutoffCount: 0,
      skippedActionCount: 0,
    });
    expect(second.visitedPositionCount).toBe(first.visitedPositionCount);
    expect(second.cutoffCount).toBe(first.cutoffCount);
    expect(second.skippedActionCount).toBe(first.skippedActionCount);
  });

  it('既定の2 ply APIは深さ2のままで、無効な深さは明示的に拒否する', () => {
    const state = recaptureTrapState();
    const defaultDepthResult = analyzeTwoPlyAlphaBetaSearch(state);

    expect(TWO_PLY_ALPHA_BETA_SEARCH_DEPTH).toBe(2);
    expect(defaultDepthResult.depth).toBe(2);
    expect(defaultDepthResult.selectedAction).toEqual(analyzeAlphaBetaSearch(state, 2).selectedAction);
    expect(() => analyzeAlphaBetaSearch(state, -1)).toThrow(/non-negative integer/);
    expect(() => analyzeAlphaBetaSearch(state, 1.5)).toThrow(/non-negative integer/);
  });

  it('深さ3は最大化→最小化→最大化で3 ply先を評価し、枝刈りなし参照探索と選択・評価が一致する', () => {
    const state = recaptureTrapState();
    const reference = analyzeUnprunedMinimaxForTest(state, 3);
    const result = analyzeAlphaBetaSearch(state, 3);

    expect(reference.deepestEvaluatedPly).toBe(3);
    expect(result.depth).toBe(3);
    expect(result.selectedAction).toEqual(reference.selectedAction);
    expect(result.selectedEvaluation).toBe(reference.selectedEvaluation);
    expect(result.selectedAction).toMatchObject({
      kind: 'move', from: { row: 4, col: 4 }, to: { row: 8, col: 4 },
    });
    expect(result.visitedPositionCount).toBeLessThanOrEqual(reference.visitedPositionCount);
    expect(result.cutoffCount).toBeGreaterThan(0);
  });

  it('深さ3の途中で詰みへ到達した枝は、それ以上の子局面を生成せず既存の終局評価を返す', () => {
    const state = createState([
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 4, piece: piece('gote-king', 'king', 'gote') },
      { row: 2, col: 4, piece: piece('mating-rook', 'rook', 'sente') },
      { row: 1, col: 4, piece: piece('captured-silver', 'silver', 'gote') },
      { row: 2, col: 3, piece: piece('rook-defender', 'gold', 'sente') },
      { row: 2, col: 1, piece: piece('left-escape-guard', 'bishop', 'sente') },
      { row: 2, col: 7, piece: piece('right-escape-guard', 'bishop', 'sente') },
    ]);
    const reference = analyzeUnprunedMinimaxForTest(state, 3);
    const result = analyzeAlphaBetaSearch(state, 3);

    expect(result.selectedAction).toEqual(reference.selectedAction);
    expect(result.selectedEvaluation).toBe(Number.POSITIVE_INFINITY);
    if (!result.selectedAction) throw new Error('Expected a mating action.');
    const afterMate = execute(state, result.selectedAction);
    expect(afterMate.status).toBe('ended');
    expect(getLegalActions(afterMate)).toEqual([]);
    expect(reference.terminalLeafCount).toBeGreaterThan(0);
    expect(result.visitedPositionCount).toBeLessThanOrEqual(reference.visitedPositionCount);
  });

  it('深さ2と深さ3の統計を同じ定義で比較でき、深さ3の同点でも固定順を保つ', () => {
    const state = recaptureTrapState();
    const depth2 = analyzeAlphaBetaSearch(state, 2);
    const depth3 = analyzeAlphaBetaSearch(state, 3);
    const tieState = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
    ]);
    const tieDepth3 = analyzeAlphaBetaSearch(tieState, 3);

    expect(depth2.depth).toBe(2);
    expect(depth3.depth).toBe(3);
    expect(depth3.visitedPositionCount).toBeGreaterThan(depth2.visitedPositionCount);
    expect(depth2.cutoffCount).toBeGreaterThanOrEqual(0);
    expect(depth3.cutoffCount).toBeGreaterThanOrEqual(0);
    expect(tieDepth3.selectedAction).toEqual(getLegalActions(tieState)[0]);
  });
});
