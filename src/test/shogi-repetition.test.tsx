import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import {
  classifyRepetition,
  cloneBoardSquares,
  createPositionKey,
  executeDrop,
  executeMove,
} from '../domain/shogi';
import {
  BoardState,
  Piece,
  Player,
  PositionRecord,
  createInitialBoardState,
} from '../types/shogi';

interface Placement {
  row: number;
  col: number;
  piece: Piece;
}

type MoveStep = readonly [number, number, number, number];

function createPosition(
  turn: Player,
  placements: Placement[],
  hands: { sente?: Piece[]; gote?: Piece[] } = {}
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) {
    for (const square of row) square.piece = null;
  }
  for (const placement of placements) {
    squares[placement.row][placement.col].piece = { ...placement.piece };
  }
  return {
    ...initial,
    squares,
    turn,
    senteHand: hands.sente?.map((piece) => ({ ...piece })) ?? [],
    goteHand: hands.gote?.map((piece) => ({ ...piece })) ?? [],
  };
}

function applySteps(
  initialState: BoardState,
  steps: readonly MoveStep[],
  mode: 'assist' | 'strict' = 'assist'
): BoardState[] {
  const states = [initialState];
  let state = initialState;
  for (const [fromRow, fromCol, toRow, toCol] of steps) {
    const piece = state.squares[fromRow][fromCol].piece;
    const result = executeMove(
      state,
      { row: fromRow, col: fromCol },
      { row: toRow, col: toCol },
      {
        mode,
        proposer: mode === 'strict' ? 'shogi_engine' : 'human',
        ...(piece?.type === 'rook' ? { promotion: 'decline' as const } : {}),
      }
    );
    const failure = result.type === 'rejected' ? result.reason : result.type;
    expect(result.type, `step ${fromRow},${fromCol} -> ${toRow},${toCol}: ${failure}`).toBe('applied');
    if (result.type !== 'applied') throw new Error('test move was unexpectedly rejected');
    state = result.state;
    states.push(state);
  }
  return states;
}

const kingCycle: readonly MoveStep[] = [
  [8, 4, 8, 3],
  [0, 4, 0, 3],
  [8, 3, 8, 4],
  [0, 3, 0, 4],
];

const senteCheckingCycle: readonly MoveStep[] = [
  [1, 3, 1, 4],
  [0, 4, 0, 3],
  [1, 4, 1, 3],
  [0, 3, 0, 4],
];

const goteCheckingCycle: readonly MoveStep[] = [
  [7, 3, 7, 4],
  [8, 4, 8, 3],
  [7, 4, 7, 3],
  [8, 3, 8, 4],
];

const repeatThreeTimes = (cycle: readonly MoveStep[]) => [...cycle, ...cycle, ...cycle];

function createKingCyclePosition(): BoardState {
  return createPosition('sente', [
    { row: 8, col: 4, piece: { id: 's-king', type: 'king', player: 'sente' } },
    { row: 0, col: 4, piece: { id: 'g-king', type: 'king', player: 'gote' } },
  ]);
}

function createSenteCheckingPosition(): BoardState {
  return createPosition('sente', [
    { row: 8, col: 8, piece: { id: 's-king', type: 'king', player: 'sente' } },
    { row: 0, col: 4, piece: { id: 'g-king', type: 'king', player: 'gote' } },
    { row: 1, col: 3, piece: { id: 's-rook', type: 'rook', player: 'sente' } },
  ]);
}

function createGoteCheckingPosition(): BoardState {
  return createPosition('gote', [
    { row: 8, col: 4, piece: { id: 's-king', type: 'king', player: 'sente' } },
    { row: 0, col: 8, piece: { id: 'g-king', type: 'king', player: 'gote' } },
    { row: 7, col: 3, piece: { id: 'g-rook', type: 'rook', player: 'gote' } },
  ]);
}

describe('決定的な局面キー', () => {
  it('同じ局面と、ID・持ち駒順だけが違う局面を同じキーにする', () => {
    const first = createPosition(
      'sente',
      [
        { row: 8, col: 4, piece: { id: 'king-a', type: 'king', player: 'sente' } },
        { row: 0, col: 4, piece: { id: 'king-b', type: 'king', player: 'gote' } },
      ],
      {
        sente: [
          { id: 'pawn-a', type: 'pawn', player: 'sente' },
          { id: 'gold-a', type: 'gold', player: 'sente' },
        ],
      }
    );
    const second: BoardState = {
      ...first,
      squares: cloneBoardSquares(first.squares),
      senteHand: [
        { id: 'gold-z', type: 'gold', player: 'sente' },
        { id: 'pawn-z', type: 'pawn', player: 'sente' },
      ],
    };
    second.squares[8][4].piece = { id: 'different-king-id', type: 'king', player: 'sente' };

    expect(createPositionKey(second)).toBe(createPositionKey(first));
  });

  it.each([
    ['位置', (state: BoardState) => {
      state.squares[7][4].piece = state.squares[8][4].piece;
      state.squares[8][4].piece = null;
    }],
    ['所有者', (state: BoardState) => { state.squares[8][4].piece!.player = 'gote'; }],
    ['駒種', (state: BoardState) => { state.squares[8][4].piece!.type = 'gold'; }],
    ['成り状態', (state: BoardState) => { state.squares[8][4].piece!.isPromoted = true; }],
    ['持ち駒種類', (state: BoardState) => { state.senteHand[0].type = 'gold'; }],
    ['持ち駒枚数', (state: BoardState) => {
      state.senteHand.push({ id: 'another', type: 'pawn', player: 'sente' });
    }],
    ['手番', (state: BoardState) => { state.turn = 'gote'; }],
  ] as const)('%sが違えば異なるキーにする', (_label, mutate) => {
    const base = createPosition(
      'sente',
      [
        { row: 8, col: 4, piece: { id: 's-king', type: 'king', player: 'sente' } },
        { row: 0, col: 4, piece: { id: 'g-king', type: 'king', player: 'gote' } },
      ],
      { sente: [{ id: 'pawn', type: 'pawn', player: 'sente' }] }
    );
    const changed: BoardState = {
      ...base,
      squares: cloneBoardSquares(base.squares),
      senteHand: base.senteHand.map((piece) => ({ ...piece })),
      goteHand: base.goteHand.map((piece) => ({ ...piece })),
    };
    mutate(changed);
    expect(createPositionKey(changed)).not.toBe(createPositionKey(base));
  });

  it('手数・棋譜・直前手・状態・結果などのメタデータをキーから除外する', () => {
    const state = createKingCyclePosition();
    const changed: BoardState = {
      ...state,
      moveNumber: 99,
      status: 'ended',
      history: [{
        kind: 'move', moveNumber: 98, player: 'gote', from: { row: 0, col: 3 },
        to: { row: 0, col: 4 }, pieceType: 'king', capturedPieceType: null,
        promotion: 'none', notation: 'metadata-only',
      }],
      lastMove: null,
      result: { winner: null, loser: null, endReason: 'repetition' },
      foulHistory: [],
      positionHistory: [],
    };
    expect(createPositionKey(changed)).toBe(createPositionKey(state));
  });

  it('state・盤面・持ち駒・駒オブジェクトを変更しない', () => {
    const state = createPosition(
      'sente',
      [
        { row: 8, col: 4, piece: { id: 's-king', type: 'king', player: 'sente' } },
        { row: 0, col: 4, piece: { id: 'g-king', type: 'king', player: 'gote' } },
      ],
      { sente: [{ id: 'pawn', type: 'pawn', player: 'sente' }] }
    );
    const snapshot = JSON.stringify(state);
    const squares = state.squares;
    const hand = state.senteHand;
    const boardPiece = state.squares[8][4].piece;
    const handPiece = state.senteHand[0];
    createPositionKey(state);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(state.squares).toBe(squares);
    expect(state.senteHand).toBe(hand);
    expect(state.squares[8][4].piece).toBe(boardPiece);
    expect(state.senteHand[0]).toBe(handPiece);
  });
});

describe('通常の千日手', () => {
  it('初期局面を1回目と数え、2・3回目は継続して4回目で無勝負にする', () => {
    const initial = createKingCyclePosition();
    const initialKey = createPositionKey(initial);
    const states = applySteps(initial, repeatThreeTimes(kingCycle));
    expect(states[4].status).toBe('active');
    expect(states[8].status).toBe('active');
    expect(states[12]).toMatchObject({
      status: 'ended',
      turn: 'sente',
      moveNumber: 13,
      result: {
        winner: null,
        loser: null,
        endReason: 'repetition',
      },
    });
    expect(states[12].positionHistory?.filter((record) => record.key === initialKey)).toHaveLength(4);
    expect(states[12].history).toHaveLength(12);
    expect(states[12].lastMove).toEqual(states[12].history[11]);
  });

  it('手番や持ち駒が違う局面を同一局面として数えない', () => {
    const initial = createKingCyclePosition();
    const key = createPositionKey(initial);
    const otherTurn = { ...initial, turn: 'gote' as const };
    const otherHand = {
      ...initial,
      senteHand: [{ id: 'extra-pawn', type: 'pawn' as const, player: 'sente' as const }],
    };
    expect(createPositionKey(otherTurn)).not.toBe(key);
    expect(createPositionKey(otherHand)).not.toBe(key);
  });

  it('循環に王手を含んでも王手側に非王手があれば通常の千日手にする', () => {
    const state = createPosition('sente', [
      { row: 8, col: 8, piece: { id: 's-king', type: 'king', player: 'sente' } },
      { row: 0, col: 4, piece: { id: 'g-king', type: 'king', player: 'gote' } },
      { row: 1, col: 3, piece: { id: 's-rook', type: 'rook', player: 'sente' } },
    ]);
    const mixedCycle: readonly MoveStep[] = [
      [8, 8, 8, 7], [0, 4, 0, 5], [8, 7, 8, 8], [0, 5, 0, 4],
      ...senteCheckingCycle,
    ];
    // The base position occurs after moves 4, 8, and 12; the interval still includes checks.
    const final = applySteps(state, [...mixedCycle, ...mixedCycle.slice(0, 4)]).at(-1)!;
    expect(final.result).toMatchObject({ endReason: 'repetition', winner: null, loser: null });
    expect(final.positionHistory?.some((record) => record.gaveCheck)).toBe(true);
  });

  it('駒打ちも共通終局処理を通り、4回目の局面を適用して記録する', () => {
    const gold: Piece = { id: 'drop-gold', type: 'gold', player: 'sente' };
    const state = createPosition(
      'sente',
      [
        { row: 8, col: 8, piece: { id: 's-king', type: 'king', player: 'sente' } },
        { row: 0, col: 0, piece: { id: 'g-king', type: 'king', player: 'gote' } },
      ],
      { sente: [gold] }
    );
    const finalPosition: BoardState = {
      ...state,
      squares: cloneBoardSquares(state.squares),
      senteHand: [],
      turn: 'gote',
    };
    finalPosition.squares[4][4].piece = { ...gold, isPromoted: false };
    const targetKey = createPositionKey(finalPosition);
    const currentKey = createPositionKey(state);
    state.positionHistory = [
      { key: targetKey, historyIndex: 1, movedBy: 'sente', gaveCheck: false },
      { key: 'other-1', historyIndex: 2, movedBy: 'gote', gaveCheck: false },
      { key: targetKey, historyIndex: 3, movedBy: 'sente', gaveCheck: false },
      { key: 'other-2', historyIndex: 4, movedBy: 'gote', gaveCheck: false },
      { key: targetKey, historyIndex: 5, movedBy: 'sente', gaveCheck: false },
      { key: currentKey, historyIndex: 6, movedBy: 'gote', gaveCheck: false },
    ];

    const result = executeDrop(state, gold.id, { row: 4, col: 4 }, { mode: 'strict' });
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.result).toMatchObject({ endReason: 'repetition', winner: null, loser: null });
    expect(result.state.squares[4][4].piece).toMatchObject({ type: 'gold', player: 'sente' });
    expect(result.state.senteHand).toEqual([]);
    expect(result.state.turn).toBe('gote');
    expect(result.state.moveNumber).toBe(2);
    expect(result.state.history).toHaveLength(1);
    expect(result.state.lastMove).toEqual(result.move);
    expect(result.state.positionHistory?.at(-1)).toMatchObject({
      key: targetKey,
      movedBy: 'sente',
      gaveCheck: false,
    });
  });
});

describe('連続王手の千日手', () => {
  it.each([
    ['先手', createSenteCheckingPosition, senteCheckingCycle, 'sente', 'gote'],
    ['後手', createGoteCheckingPosition, goteCheckingCycle, 'gote', 'sente'],
  ] as const)('%sが全着手で王手を続けると王手側の反則負けにする', (
    _label,
    createState,
    cycle,
    loser,
    winner
  ) => {
    const states = applySteps(createState(), repeatThreeTimes(cycle));
    expect(states[4].status).not.toBe('ended');
    expect(states[8].status).not.toBe('ended');
    expect(states[12]).toMatchObject({
      status: 'ended',
      moveNumber: 13,
      result: {
        winner,
        loser,
        endReason: 'foul_loss',
        foulReason: 'perpetual_check_repetition',
      },
    });
    expect(states[12].history).toHaveLength(12);
    expect(states[12].lastMove).toEqual(states[12].history[11]);
    expect(states[12].foulHistory).toEqual([]);
  });

  it('王手状態で始まる循環も履歴区間から先手の連続王手と判定する', () => {
    const state = createPosition('gote', [
      { row: 8, col: 8, piece: { id: 's-king', type: 'king', player: 'sente' } },
      { row: 0, col: 4, piece: { id: 'g-king', type: 'king', player: 'gote' } },
      { row: 1, col: 4, piece: { id: 's-rook', type: 'rook', player: 'sente' } },
    ]);
    state.status = 'check';
    const cycle: readonly MoveStep[] = [
      [0, 4, 0, 3], [1, 4, 1, 3], [0, 3, 0, 4], [1, 3, 1, 4],
    ];
    const final = applySteps(state, repeatThreeTimes(cycle)).at(-1)!;
    expect(final.result).toMatchObject({
      endReason: 'foul_loss',
      foulReason: 'perpetual_check_repetition',
      loser: 'sente',
      winner: 'gote',
    });
  });

  it('王手を解除した状態で始まる循環も先手の連続王手と判定する', () => {
    const final = applySteps(
      createSenteCheckingPosition(),
      repeatThreeTimes(senteCheckingCycle)
    ).at(-1)!;
    expect(final.result).toMatchObject({ loser: 'sente', foulReason: 'perpetual_check_repetition' });
  });

  it('相手側が区間中に一部だけ王手してもその側を反則負けにしない', () => {
    const key = 'same';
    const records: PositionRecord[] = [
      { key, historyIndex: 0, movedBy: null, gaveCheck: false },
      { key: 'a', historyIndex: 1, movedBy: 'sente', gaveCheck: true },
      { key: 'b', historyIndex: 2, movedBy: 'gote', gaveCheck: true },
      { key, historyIndex: 3, movedBy: 'sente', gaveCheck: true },
      { key: 'c', historyIndex: 4, movedBy: 'gote', gaveCheck: false },
      { key, historyIndex: 5, movedBy: 'sente', gaveCheck: true },
      { key, historyIndex: 6, movedBy: 'gote', gaveCheck: false },
    ];
    expect(classifyRepetition(records, key)).toEqual({
      kind: 'perpetual_check',
      checkingPlayer: 'sente',
    });
  });

  it('不整合データで両者の全着手が王手でも暗黙に敗者を選ばない', () => {
    const key = 'same';
    const records: PositionRecord[] = [
      { key, historyIndex: 0, movedBy: null, gaveCheck: false },
      { key: 'a', historyIndex: 1, movedBy: 'sente', gaveCheck: true },
      { key, historyIndex: 2, movedBy: 'gote', gaveCheck: true },
      { key: 'b', historyIndex: 3, movedBy: 'sente', gaveCheck: true },
      { key, historyIndex: 4, movedBy: 'gote', gaveCheck: true },
      { key: 'c', historyIndex: 5, movedBy: 'sente', gaveCheck: true },
      { key, historyIndex: 6, movedBy: 'gote', gaveCheck: true },
    ];
    expect(classifyRepetition(records, key)).toEqual({ kind: 'repetition' });
  });

  it('assistとstrictで同じ裁定になる', () => {
    const steps = repeatThreeTimes(senteCheckingCycle);
    const assist = applySteps(createSenteCheckingPosition(), steps, 'assist').at(-1)!;
    const strict = applySteps(createSenteCheckingPosition(), steps, 'strict').at(-1)!;
    expect(strict.result).toEqual(assist.result);
    expect(strict.history).toEqual(assist.history);
    expect(strict.positionHistory).toEqual(assist.positionHistory);
  });
});

describe('局面履歴の互換性・状態保護', () => {
  it('初期局面は作成時点で1回記録される', () => {
    const state = createInitialBoardState();
    expect(state.positionHistory).toEqual([{
      key: createPositionKey(state),
      historyIndex: 0,
      movedBy: null,
      gaveCheck: false,
    }]);
  });

  it('局面履歴がない外部局面は現在局面を基準にしてから合法手を記録する', () => {
    const state = createKingCyclePosition();
    delete state.positionHistory;
    const beforeKey = createPositionKey(state);
    const final = applySteps(state, [kingCycle[0]])[1];
    expect(final.positionHistory).toHaveLength(2);
    expect(final.positionHistory?.[0]).toMatchObject({ key: beforeKey, movedBy: null });
  });

  it('履歴末尾キーが現在局面と違えば古い履歴を捨てて安全に再初期化する', () => {
    const state = createKingCyclePosition();
    state.positionHistory = [
      { key: 'stale-key', historyIndex: 0, movedBy: null, gaveCheck: false },
      { key: 'also-stale', historyIndex: 1, movedBy: 'sente', gaveCheck: true },
    ];
    const beforeKey = createPositionKey(state);
    const final = applySteps(state, [kingCycle[0]])[1];
    expect(final.positionHistory).toHaveLength(2);
    expect(final.positionHistory?.[0]).toMatchObject({ key: beforeKey, movedBy: null });
    expect(final.positionHistory?.some((record) => record.key === 'stale-key')).toBe(false);
  });

  it('不正提案・strict反則・終局後提案では局面履歴を変更しない', () => {
    const state = createInitialBoardState();
    const history = state.positionHistory;
    const assist = executeMove(state, { row: 6, col: 2 }, { row: 4, col: 2 }, { mode: 'assist' });
    const strict = executeMove(state, { row: 6, col: 2 }, { row: 4, col: 2 }, { mode: 'strict' });
    expect(assist.state.positionHistory).toBe(history);
    expect(strict.state.positionHistory).toBe(history);

    const ended = applySteps(createKingCyclePosition(), repeatThreeTimes(kingCycle)).at(-1)!;
    const endedHistory = ended.positionHistory;
    const afterEnd = executeMove(ended, { row: 8, col: 4 }, { row: 8, col: 3 }, { mode: 'strict' });
    expect(afterEnd).toMatchObject({ type: 'rejected', reason: 'game_already_ended' });
    expect(afterEnd.state).toBe(ended);
    expect(afterEnd.state.positionHistory).toBe(endedHistory);
  });

  it('合法手は入力stateと既存配列を変更しない', () => {
    const state = createKingCyclePosition();
    const snapshot = JSON.stringify(state);
    const positions = state.positionHistory;
    const history = state.history;
    applySteps(state, [kingCycle[0]]);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(state.positionHistory).toBe(positions);
    expect(state.history).toBe(history);
  });
});

describe('千日手UI', () => {
  it('通常の千日手を勝者なし・無勝負と文字表示し、終局後操作を停止する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createKingCyclePosition()} />);
    for (const [fromRow, fromCol, toRow, toCol] of repeatThreeTimes(kingCycle)) {
      const from = document.querySelector(
        `[data-file="${9 - fromCol}"][data-rank="${fromRow + 1}"]`
      ) as HTMLElement;
      const to = document.querySelector(
        `[data-file="${9 - toCol}"][data-rank="${toRow + 1}"]`
      ) as HTMLElement;
      await user.click(from);
      await user.click(to);
    }
    expect(screen.getByRole('status')).toHaveTextContent('終局 / 千日手（無勝負）');
    expect(document.querySelector('[data-selected="true"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-candidate="true"]')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'false');
    expect(document.getElementById('piece-stand-gote')).toHaveAttribute('data-active', 'false');
  });

  it.each([
    [createSenteCheckingPosition, senteCheckingCycle, '終局 / 先手反則負け（連続王手の千日手）'],
    [createGoteCheckingPosition, goteCheckingCycle, '終局 / 後手反則負け（連続王手の千日手）'],
  ] as const)('連続王手の敗者を正しい向きで表示する', (createState, cycle, text) => {
    const final = applySteps(createState(), repeatThreeTimes(cycle)).at(-1)!;
    render(<ShogiResearchScreen initialState={final} />);
    expect(screen.getByRole('status')).toHaveTextContent(text);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('フッターで千日手と連続王手の千日手への対応を案内する', () => {
    render(<ShogiResearchScreen />);
    expect(screen.getByText(/千日手・連続王手の千日手の終局処理に対応/)).toBeInTheDocument();
  });
});
