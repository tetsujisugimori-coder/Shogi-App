import { describe, expect, it } from 'vitest';
import {
  cloneBoardSquares,
  executeLegalAction,
  getLegalActions,
  type LegalAction,
} from '../domain/shogi';
import {
  type BoardState,
  type Piece,
  type PieceType,
  type Player,
  createInitialBoardState,
} from '../types/shogi';

const senteKing: Piece = { id: 'king-s', type: 'king', player: 'sente' };
const goteKing: Piece = { id: 'king-g', type: 'king', player: 'gote' };

function createState(
  boardPieces: Array<{ row: number; col: number; piece: Piece }> = [
    { row: 8, col: 4, piece: senteKing },
    { row: 0, col: 4, piece: goteKing },
  ],
  senteHand: Piece[] = [],
  turn: Player = 'sente'
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) {
    for (const square of row) square.piece = null;
  }
  for (const item of boardPieces) squares[item.row][item.col].piece = { ...item.piece };
  return { ...initial, squares, senteHand, turn };
}

function dropActions(actions: LegalAction[]) {
  return actions.filter((action) => action.kind === 'drop');
}

function moveActions(actions: LegalAction[]) {
  return actions.filter((action) => action.kind === 'move');
}

function coordinateOrderIsSorted(actions: Array<{ to: { row: number; col: number } }>) {
  return actions.every((action, index) => {
    if (index === 0) return true;
    const previous = actions[index - 1].to;
    return previous.row < action.to.row ||
      (previous.row === action.to.row && previous.col <= action.to.col);
  });
}

function moveOrderIsSorted(actions: Extract<LegalAction, { kind: 'move' }>[]) {
  return actions.every((action, index) => {
    if (index === 0) return true;
    const previous = actions[index - 1];
    const sourceOrder = previous.from.row - action.from.row || previous.from.col - action.from.col;
    if (sourceOrder !== 0) return sourceOrder < 0;
    const destinationOrder = previous.to.row - action.to.row || previous.to.col - action.to.col;
    if (destinationOrder !== 0) return destinationOrder < 0;
    return previous.promotion === 'decline' && action.promotion === 'promote';
  });
}

function createPawnDropMateState(): { state: BoardState; forbidden: { row: number; col: number } } {
  const pawn: Piece = { id: 'mate-pawn', type: 'pawn', player: 'sente' };
  return {
    state: createState([
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
      { row: 2, col: 4, piece: { id: 'sente-guard', type: 'gold', player: 'sente' } },
      { row: 0, col: 3, piece: { id: 'gote-left-blocker', type: 'lance', player: 'gote' } },
      { row: 0, col: 5, piece: { id: 'gote-right-blocker', type: 'lance', player: 'gote' } },
      { row: 1, col: 3, piece: { id: 'gote-left-front', type: 'pawn', player: 'gote' } },
      { row: 1, col: 5, piece: { id: 'gote-right-front', type: 'pawn', player: 'gote' } },
    ], [pawn]),
    forbidden: { row: 1, col: 4 },
  };
}

describe('全合法手列挙API', () => {
  it('初期局面で手番だけの非空候補を、入力を変えず決定的に返す', () => {
    const state = createInitialBoardState();
    const snapshot = JSON.stringify(state);
    const first = getLegalActions(state);
    const second = getLegalActions(state);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(JSON.stringify(state)).toBe(snapshot);
    for (const action of first) {
      expect(action.player).toBe(state.turn);
      if (action.kind === 'move') {
        expect(state.squares[action.from.row][action.from.col].piece?.player).toBe(state.turn);
      }
    }
  });

  it('通常・任意成り・強制成りを正しいpromotion候補へ展開し、捕獲も含める', () => {
    const state = createState([
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
      { row: 6, col: 0, piece: { id: 'ordinary-pawn', type: 'pawn', player: 'sente' } },
      { row: 3, col: 4, piece: { id: 'optional-silver', type: 'silver', player: 'sente' } },
      { row: 2, col: 4, piece: { id: 'captured-pawn', type: 'pawn', player: 'gote' } },
      { row: 1, col: 3, piece: { id: 'required-pawn', type: 'pawn', player: 'sente' } },
    ]);
    const actions = moveActions(getLegalActions(state));

    expect(actions.filter((action) =>
      action.from.row === 6 && action.from.col === 0 && action.to.row === 5 && action.to.col === 0
    ).map((action) => action.promotion)).toEqual(['none']);
    expect(actions.filter((action) =>
      action.from.row === 3 && action.from.col === 4 && action.to.row === 2 && action.to.col === 4
    ).map((action) => action.promotion)).toEqual(['decline', 'promote']);
    expect(actions.filter((action) =>
      action.from.row === 1 && action.from.col === 3 && action.to.row === 0 && action.to.col === 3
    ).map((action) => action.promotion)).toEqual(['promote']);

    const capture = actions.find((action) =>
      action.from.row === 3 && action.from.col === 4 && action.to.row === 2 && action.to.col === 4 &&
      action.promotion === 'decline'
    );
    expect(capture).toBeDefined();
    if (!capture) return;
    const result = executeLegalAction(state, capture);
    expect(result).toMatchObject({ type: 'applied', move: { capturedPieceType: 'pawn' } });

    const optionalPromote = actions.find((action) =>
      action.from.row === 3 && action.from.col === 4 && action.to.row === 2 && action.to.col === 4 &&
      action.promotion === 'promote'
    );
    const requiredPromote = actions.find((action) =>
      action.from.row === 1 && action.from.col === 3 && action.to.row === 0 && action.to.col === 3
    );
    expect(optionalPromote && executeLegalAction(state, optionalPromote)).toMatchObject({
      type: 'applied', move: { promotion: 'promote' },
    });
    expect(requiredPromote && executeLegalAction(state, requiredPromote)).toMatchObject({
      type: 'applied', move: { promotion: 'promote' },
    });

    const optionalVariants = actions.filter((action) =>
      action.from.row === 3 && action.from.col === 4 && action.to.row === 2 && action.to.col === 4
    );
    expect(optionalVariants[0].from).not.toBe(optionalVariants[1].from);
    expect(optionalVariants[0].to).not.toBe(optionalVariants[1].to);
  });

  it('全ての初期局面候補は、元局面から独立して既存の実行経路で指せる', () => {
    const state = createInitialBoardState();
    const actions = getLegalActions(state);

    for (const action of actions) {
      expect(executeLegalAction(state, action, { proposer: 'local_ai' }).type).toBe('applied');
      expect(executeLegalAction(state, action, { proposer: 'shogi_engine' }).type).toBe('applied');
    }
  });

  it.each(['pawn', 'lance', 'knight', 'silver', 'gold', 'bishop', 'rook'] as const)(
    '持ち駒%sの打ち先を列挙する',
    (pieceType: PieceType) => {
      const piece: Piece = { id: `hand-${pieceType}`, type: pieceType, player: 'sente' };
      const state = createState(undefined, [piece]);
      const action = dropActions(getLegalActions(state)).find((candidate) => candidate.pieceType === pieceType);
      expect(action).toBeDefined();
      if (!action) return;
      expect(executeLegalAction(state, action).type).toBe('applied');
    }
  );

  it('王の持ち駒を列挙せず、二歩・行き所のない打ち先・打ち歩詰めを除外する', () => {
    const nifuState = createState([
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
      { row: 5, col: 3, piece: { id: 'board-pawn', type: 'pawn', player: 'sente' } },
    ], [
      { id: 'king-in-hand', type: 'king', player: 'sente' },
      { id: 'pawn-in-hand', type: 'pawn', player: 'sente' },
    ]);
    const nifuDrops = dropActions(getLegalActions(nifuState));
    expect(nifuDrops.some((action) => action.pieceType === 'king')).toBe(false);
    expect(nifuDrops).not.toContainEqual(expect.objectContaining({
      pieceType: 'pawn', to: { row: 4, col: 3 },
    }));
    expect(nifuDrops).not.toContainEqual(expect.objectContaining({
      pieceType: 'pawn', to: { row: 0, col: 4 },
    }));

    const { state, forbidden } = createPawnDropMateState();
    expect(dropActions(getLegalActions(state))).not.toContainEqual(expect.objectContaining({
      pieceType: 'pawn', to: forbidden,
    }));
  });

  it('王手では合駒だけを含め、無関係な駒打ちを含めない', () => {
    const state = createState([
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 8, piece: goteKing },
      { row: 0, col: 4, piece: { id: 'checking-rook', type: 'rook', player: 'gote' } },
    ], [{ id: 'blocking-gold', type: 'gold', player: 'sente' }]);
    const drops = dropActions(getLegalActions(state));

    expect(drops).toContainEqual(expect.objectContaining({ to: { row: 4, col: 4 } }));
    expect(drops.every((action) => action.to.col === 4)).toBe(true);
  });

  it('ピンされた駒には自玉を王手にさらさない候補だけを含める', () => {
    const state = createState([
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 8, piece: goteKing },
      { row: 0, col: 4, piece: { id: 'checking-rook', type: 'rook', player: 'gote' } },
      { row: 7, col: 4, piece: { id: 'pinned-gold', type: 'gold', player: 'sente' } },
    ]);
    const pinnedMoves = moveActions(getLegalActions(state)).filter((action) =>
      action.from.row === 7 && action.from.col === 4
    );

    expect(pinnedMoves).toEqual([expect.objectContaining({ to: { row: 6, col: 4 } })]);
  });

  it('同種の持ち駒を集約し、ID順の代表・手駒順序非破壊・固定順序を保証する', () => {
    const hands: Piece[] = [
      { id: 'pawn-z', type: 'pawn', player: 'sente' },
      { id: 'rook-z', type: 'rook', player: 'sente' },
      { id: 'gold-z', type: 'gold', player: 'sente' },
      { id: 'gold-a', type: 'gold', player: 'sente' },
      { id: 'bishop-z', type: 'bishop', player: 'sente' },
    ];
    const state = createState(undefined, hands);
    const beforeHand = JSON.stringify(state.senteHand);
    const drops = dropActions(getLegalActions(state));
    const typeSequence = [...new Set(drops.map((action) => action.pieceType))];

    expect(typeSequence).toEqual(['rook', 'bishop', 'gold', 'pawn']);
    expect(drops.filter((action) => action.pieceType === 'gold').every((action) => action.pieceId === 'gold-a')).toBe(true);
    expect(coordinateOrderIsSorted(drops.filter((action) => action.pieceType === 'gold'))).toBe(true);
    expect(JSON.stringify(state.senteHand)).toBe(beforeHand);

    const reordered = createState(undefined, [...hands].reverse());
    expect(getLegalActions(reordered)).toEqual(getLegalActions(state));
  });

  it('手を先、駒打ちを後にし、各座標オブジェクトを入力状態と共有しない', () => {
    const state = createState([
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
      { row: 6, col: 4, piece: { id: 'move-pawn', type: 'pawn', player: 'sente' } },
    ], [{ id: 'gold', type: 'gold', player: 'sente' }]);
    const actions = getLegalActions(state);
    const firstDrop = actions.findIndex((action) => action.kind === 'drop');

    expect(firstDrop).toBeGreaterThan(0);
    expect(actions.slice(0, firstDrop).every((action) => action.kind === 'move')).toBe(true);
    expect(actions.slice(firstDrop).every((action) => action.kind === 'drop')).toBe(true);
    expect(moveOrderIsSorted(moveActions(actions))).toBe(true);

    const move = actions.find((action) => action.kind === 'move');
    const drop = actions[firstDrop];
    if (!move || !drop || drop.kind !== 'drop') return;
    move.from.row = -1;
    move.to.row = -1;
    drop.to.row = -1;
    expect(state.squares[6][4].piece?.id).toBe('move-pawn');
    expect(state.squares[5][4].piece).toBeNull();
  });

  it('古い候補は既存の検証で拒否し、同種の別の持ち駒へすり替えない', () => {
    const initial = createInitialBoardState();
    const move = moveActions(getLegalActions(initial))[0];
    const moveResult = executeLegalAction(initial, move);
    expect(moveResult.type).toBe('applied');
    if (moveResult.type !== 'applied') return;
    expect(executeLegalAction(moveResult.state, move).type).toBe('rejected');

    const dropState = createState(undefined, [
      { id: 'gold-b', type: 'gold', player: 'sente' },
      { id: 'gold-a', type: 'gold', player: 'sente' },
    ]);
    const drop = dropActions(getLegalActions(dropState))[0];
    const dropResult = executeLegalAction(dropState, drop);
    expect(dropResult.type).toBe('applied');
    if (dropResult.type !== 'applied') return;
    const staleTurnState = { ...dropResult.state, turn: 'sente' as const };
    const staleResult = executeLegalAction(staleTurnState, drop);
    expect(staleResult).toMatchObject({ type: 'rejected', reason: 'hand_piece_not_found' });
    expect(staleTurnState.senteHand).toEqual([{ id: 'gold-b', type: 'gold', player: 'sente' }]);
  });

  it('終局済み局面は空配列を返す', () => {
    const state = { ...createInitialBoardState(), status: 'ended' as const };
    expect(getLegalActions(state)).toEqual([]);
  });
});
