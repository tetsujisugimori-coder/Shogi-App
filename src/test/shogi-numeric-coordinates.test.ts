import { describe, expect, it } from 'vitest';
import {
  executeDrop, executeMove, executeLegalAction, validateDrop, validateMove,
  simulateDropSquares, simulateMoveSquares, getLegalMoves, getPseudoLegalMoves,
  type LegalAction,
} from '../domain/shogi';
import { isWithinBoard } from '../domain/shogi/coordinates';
import { createInitialBoardState, type BoardState, type ExecutionMode, type ProposerType } from '../types/shogi';

// A legal position reached by a pawn exchange; both kings and all 40 pieces remain.
function createState(): BoardState {
  let state = createInitialBoardState();
  for (const [from, to] of [
    [{ row: 6, col: 0 }, { row: 5, col: 0 }],
    [{ row: 2, col: 0 }, { row: 3, col: 0 }],
    [{ row: 5, col: 0 }, { row: 4, col: 0 }],
    [{ row: 3, col: 0 }, { row: 4, col: 0 }],
    [{ row: 8, col: 0 }, { row: 4, col: 0 }],
    [{ row: 2, col: 1 }, { row: 3, col: 1 }],
  ]) {
    const result = executeMove(state, from, to);
    if (result.type !== 'applied') throw new Error(`Fixture move rejected: ${result.type}`);
    state = result.state;
  }
  return state;
}
const invalidNumbers = [0.5, 4.5, 8.5, -1, -0.5, 9, 10, NaN, Infinity, -Infinity];
const invalidCoordinates = invalidNumbers.flatMap(value => [
  { row: value, col: 4 }, { row: 4, col: value },
]);

function expectUnadvanced(next: BoardState, original: BoardState) {
  for (const key of [
    'squares', 'senteHand', 'goteHand', 'turn', 'moveNumber', 'history', 'lastMove',
    'positionHistory', 'positionSnapshots',
  ] as const) expect(next[key]).toEqual(original[key]);
}
function expectRejection(result: ReturnType<typeof executeLegalAction>, state: BoardState, mode: ExecutionMode) {
  expect(result.type).toBe(mode === 'strict' ? 'foul_loss' : 'rejected');
  expectUnadvanced(result.state, state);
  if (result.type === 'rejected') {
    expect(result.reason).toBe('out_of_bounds');
    expect(result.state).toBe(state);
  } else if (result.type === 'foul_loss') {
    expect(result.foul.reason).toBe('out_of_bounds');
    expect(result.state.status).toBe('ended');
    expect(result.result).toMatchObject({ winner: 'gote', loser: 'sente', foulReason: 'out_of_bounds' });
    expect(result.state.foulHistory).toEqual([...(state.foulHistory ?? []), result.foul]);
  }
}

describe('numeric board coordinates', () => {
  it.each(invalidCoordinates)('rejects $row / $col before drop or move access', coord => {
    const state = createState();
    const before = structuredClone(state);
    const piece = state.senteHand[0];
    expect(isWithinBoard(coord.row, coord.col)).toBe(false);
    expect(validateDrop(state, piece.id, coord)).toMatchObject({ isValid: false, reason: 'out_of_bounds' });
    const from = { row: 6, col: 1 }, to = { row: 5, col: 1 };
    const actions: LegalAction[] = [
      { kind: 'drop', player: 'sente', pieceId: piece.id, pieceType: piece.type, to: coord, promotion: 'none' },
      { kind: 'move', player: 'sente', from: coord, to, pieceType: 'pawn', promotion: 'none' },
      { kind: 'move', player: 'sente', from, to: coord, pieceType: 'pawn', promotion: 'none' },
    ];
    expect(validateMove(state, coord, to)).toMatchObject({ isValid: false, reason: 'out_of_bounds' });
    expect(validateMove(state, from, coord)).toMatchObject({ isValid: false, reason: 'out_of_bounds' });
    for (const mode of ['assist', 'strict'] as const) {
      expectRejection(executeDrop(state, piece.id, coord, { mode }), state, mode);
      expectRejection(executeMove(state, coord, to, { mode }), state, mode);
      expectRejection(executeMove(state, from, coord, { mode }), state, mode);
      for (const action of actions) expectRejection(executeLegalAction(state, action, { mode }), state, mode);
    }
    expect(getLegalMoves(state.squares, coord, state.turn)).toEqual([]);
    // Fractions cannot produce a valid step or ray destination.
    if (Number.isFinite(coord.row) && Number.isFinite(coord.col) &&
        (!Number.isInteger(coord.row) || !Number.isInteger(coord.col))) {
      expect(getPseudoLegalMoves(state.squares, coord, piece)).toEqual([]);
    }
    expect(state).toEqual(before);
  });

  it.each(invalidCoordinates)('returns an independent unchanged virtual board for $row / $col', coord => {
    const state = createState();
    const before = structuredClone(state);
    const copies = [
      simulateDropSquares(state.squares, state.senteHand[0], coord),
      simulateMoveSquares(state.squares, coord, { row: 5, col: 1 }),
      simulateMoveSquares(state.squares, { row: 6, col: 1 }, coord),
    ];
    for (const copy of copies) {
      expect(copy).toEqual(state.squares);
      expect(copy).not.toBe(state.squares);
      copy.forEach((row, r) => {
        expect(row).not.toBe(state.squares[r]);
        row.forEach((square, c) => {
          expect(square).not.toBe(state.squares[r][c]);
          if (square.piece) expect(square.piece).not.toBe(state.squares[r][c].piece);
        });
      });
      copy[0][0].piece!.isPromoted = true;
      copy[4][4].piece = { ...state.senteHand[0] };
    }
    expect(state).toEqual(before);
  });

  it.each([0, 8])('accepts boundary %s for rows and columns without correction', value => {
    expect(isWithinBoard(value, value)).toBe(true);
    for (const to of [{ row: value, col: 4 }, { row: 4, col: value }]) {
      const state = createState();
      // Use an empty board with both kings, and a gold to avoid dead-rank/nifu rules.
      state.squares.forEach(row => row.forEach(square => { square.piece = null; }));
      state.squares[8][3].piece = { id: 's-king', type: 'king', player: 'sente' };
      state.squares[0][3].piece = { id: 'g-king', type: 'king', player: 'gote' };
      const gold = { id: 'gold', type: 'gold', player: 'sente' } as const;
      state.senteHand = [gold];
      expect(validateDrop(state, gold.id, to)).toEqual({ isValid: true });
      expect(executeDrop(state, gold.id, to).type).toBe('applied');
      const from = { row: to.row === 0 ? 1 : to.row === 8 ? 7 : 4,
        col: to.col === 0 ? 1 : to.col === 8 ? 7 : 4 };
      state.squares[from.row][from.col].piece = { id: 'rook', type: 'rook', player: 'sente' };
      expect(validateMove(state, from, to)).toEqual({ isValid: true });
      expect(executeMove(state, from, to, { promotion: 'decline' }).type).toBe('applied');
      state.squares[from.row][from.col].piece = null;
      state.squares[to.row][to.col].piece = { id: 'rook', type: 'rook', player: 'sente' };
      expect(validateMove(state, to, from)).toEqual({ isValid: true });
      expect(executeMove(state, to, from, { promotion: 'decline' }).type).toBe('applied');
    }
  });

  it.each(['human', 'local_ai', 'shogi_engine'] as ProposerType[])('preserves default policy for %s', proposer => {
    const state = createState();
    const mode = proposer === 'human' ? 'assist' : 'strict';
    expectRejection(executeDrop(state, state.senteHand[0].id, { row: 0.5, col: 4 }, { proposer }), state, mode);
    expectRejection(executeMove(state, { row: 6, col: 1 }, { row: 4, col: 0.5 }, { proposer }), state, mode);
    expectRejection(executeDrop(state, state.senteHand[0].id, { row: 0.5, col: 4 },
      { proposer, mode: mode === 'strict' ? 'assist' : 'strict' }), state, mode === 'strict' ? 'assist' : 'strict');
  });

  it.each(invalidCoordinates)('preserves ended-game precedence for $row / $col', coord => {
    const state = createState();
    state.status = 'ended';
    const before = structuredClone(state);
    expect(validateDrop(state, state.senteHand[0].id, coord)).toMatchObject({ isValid: false, reason: 'game_already_ended' });
    // validateMove historically checks bounds first even on an ended state.
    expect(validateMove(state, coord, coord)).toMatchObject({ isValid: false, reason: 'out_of_bounds' });
    for (const mode of ['assist', 'strict'] as const) {
      for (const result of [
        executeDrop(state, state.senteHand[0].id, coord, { mode }),
        executeMove(state, coord, coord, { mode }),
        executeLegalAction(state, { kind: 'drop', player: 'sente', pieceId: state.senteHand[0].id,
          pieceType: 'pawn', to: coord, promotion: 'none' }, { mode }),
        executeLegalAction(state, { kind: 'move', player: 'sente', from: coord, to: coord,
          pieceType: 'pawn', promotion: 'none' }, { mode }),
      ]) {
        expect(result).toMatchObject({ type: 'rejected', reason: 'game_already_ended' });
        expect(result.state).toBe(state);
      }
    }
    expect(state).toEqual(before);
  });
});
