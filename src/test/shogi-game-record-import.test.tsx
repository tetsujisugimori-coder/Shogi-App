import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import {
  createShogiGameRecordV1,
  addGameRecordSessionBranch,
  createGameRecordSession,
  executeDrop,
  executeEnteringKingDeclaration,
  executeMove,
  executeResignation,
  importShogiGameRecord,
  MAX_SHOGI_GAME_RECORD_FILE_BYTES,
  serializeShogiGameRecordV1,
  serializeShogiGameRecordSessionV1,
  storeGameRecordSessionState,
} from '../domain/shogi';
import { createInitialBoardState, type BoardState } from '../types/shogi';

const EXPORTED_AT = new Date('2026-09-02T03:04:05.678Z');

function createCapturedBishopState(): BoardState {
  const first = executeMove(
    createInitialBoardState(),
    { row: 6, col: 2 },
    { row: 5, col: 2 },
    { promotion: undefined }
  );
  if (first.type !== 'applied') throw new Error('first move failed');
  const second = executeMove(first.state, { row: 2, col: 6 }, { row: 3, col: 6 });
  if (second.type !== 'applied') throw new Error('second move failed');
  const capture = executeMove(
    second.state,
    { row: 7, col: 1 },
    { row: 1, col: 7 },
    { promotion: 'decline' }
  );
  if (capture.type !== 'applied') throw new Error('capture failed');
  const fourth = executeMove(capture.state, { row: 2, col: 0 }, { row: 3, col: 0 });
  if (fourth.type !== 'applied') throw new Error('fourth move failed');
  return fourth.state;
}

function createPlayedState(): BoardState {
  const drop = executeDrop(createCapturedBishopState(), 'gote-bishop-2', { row: 4, col: 4 });
  if (drop.type !== 'applied') throw new Error('drop failed');
  return drop.state;
}

function importState(state: BoardState) {
  return importShogiGameRecord(serializeShogiGameRecordV1(state, EXPORTED_AT));
}

function createRepetitionState(): BoardState {
  let state = createInitialBoardState();
  const cycle = [
    [{ row: 8, col: 3 }, { row: 7, col: 3 }],
    [{ row: 0, col: 3 }, { row: 1, col: 3 }],
    [{ row: 7, col: 3 }, { row: 8, col: 3 }],
    [{ row: 1, col: 3 }, { row: 0, col: 3 }],
  ] as const;
  for (let repetition = 0; repetition < 3; repetition += 1) {
    for (const [from, to] of cycle) {
      const execution = executeMove(state, from, to);
      if (execution.type !== 'applied') throw new Error('repetition fixture failed');
      state = execution.state;
    }
  }
  return state;
}

function createStrictInvalidMoveState(): BoardState {
  const foul = executeMove(
    createInitialBoardState(),
    { row: 6, col: 2 },
    { row: 4, col: 2 },
    { mode: 'strict', proposer: 'shogi_engine', engineName: 'strict-test-engine' }
  );
  if (foul.type !== 'foul_loss') throw new Error('strict foul fixture failed');
  return foul.state;
}

function createStrictInvalidDropState(): BoardState {
  const foul = executeDrop(
    createCapturedBishopState(),
    'gote-bishop-2',
    { row: 8, col: 4 },
    { mode: 'strict', proposer: 'shogi_engine', engineName: 'strict-drop-engine' }
  );
  if (foul.type !== 'foul_loss') throw new Error('strict drop fixture failed');
  return foul.state;
}

describe('v1対局記録の安全な読み込み', () => {
  it('初期局面を完全復元し、同じ日時の再書き出しでv1構造を維持する', () => {
    const json = serializeShogiGameRecordV1(createInitialBoardState(), EXPORTED_AT);
    const result = importShogiGameRecord(json);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata).toEqual({
      exportedAt: EXPORTED_AT.toISOString(),
      moveCount: 0,
      isEnded: false,
    });
    expect(serializeShogiGameRecordV1(result.state, EXPORTED_AT)).toBe(json);
    expect(result.state.viewMode).toBe('research');
  });

  it('移動、駒取り、不成、駒打ち後の盤・持ち駒・履歴・スナップショットを棋譜再実行で復元する', () => {
    const state = createPlayedState();
    const result = importState(state);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createShogiGameRecordV1(result.state, EXPORTED_AT)).toEqual(
      createShogiGameRecordV1(state, EXPORTED_AT)
    );
    expect(result.state.history.map((move) => move.promotion)).toEqual([
      'none',
      'none',
      'decline',
      'none',
      'none',
    ]);
    expect(result.state.squares[4][4].piece).toMatchObject({
      id: 'gote-bishop-2',
      player: 'sente',
      type: 'bishop',
    });
    expect(result.state.positionHistory).toHaveLength(6);
    expect(result.state.positionSnapshots).toHaveLength(6);
  });

  it('未終局局面の復元後に合法手を続行できる', () => {
    const result = importState(createPlayedState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const continued = executeMove(result.state, { row: 2, col: 1 }, { row: 3, col: 1 });
    expect(continued.type).toBe('applied');
    expect(continued.state.history).toHaveLength(6);
  });

  it('成りを保存記録どおり再実行して復元する', () => {
    const first = executeMove(createInitialBoardState(), { row: 6, col: 2 }, { row: 5, col: 2 });
    if (first.type !== 'applied') throw new Error('fixture failed');
    const second = executeMove(first.state, { row: 2, col: 6 }, { row: 3, col: 6 });
    if (second.type !== 'applied') throw new Error('fixture failed');
    const promoted = executeMove(second.state, { row: 7, col: 1 }, { row: 1, col: 7 }, {
      promotion: 'promote',
    });
    if (promoted.type !== 'applied') throw new Error('fixture failed');

    const result = importState(promoted.state);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.lastMove).toMatchObject({ promotion: 'promote', notation: '▲2二角成' });
      expect(result.state.squares[1][7].piece?.isPromoted).toBe(true);
    }
  });

  it('合法な往復手順で成立した千日手結果を棋譜から再現する', () => {
    const state = createRepetitionState();
    expect(state.result?.endReason).toBe('repetition');

    const result = importState(state);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.status).toBe('ended');
      expect(result.state.result?.endReason).toBe('repetition');
      expect(result.state.positionHistory).toHaveLength(13);
    }
  });

  it('投了、反則負け、入玉宣言失敗の着手外終局を復元する', () => {
    const resignation = executeResignation(createInitialBoardState());
    const foul = executeMove(
      createInitialBoardState(),
      { row: 4, col: 4 },
      { row: 3, col: 4 },
      { mode: 'strict', proposer: 'shogi_engine' }
    );
    const declaration = executeEnteringKingDeclaration(createInitialBoardState(), {
      mode: 'strict',
      proposer: 'shogi_engine',
    });
    if (resignation.type !== 'applied' || foul.type !== 'foul_loss' || declaration.type !== 'declaration_failure') {
      throw new Error('terminal fixture failed');
    }

    for (const state of [resignation.state, foul.state, declaration.state]) {
      const result = importState(state);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.state.status).toBe('ended');
        expect(result.state.result).toEqual(state.result);
        expect(createShogiGameRecordV1(result.state, EXPORTED_AT).positionSnapshots).toEqual(
          createShogiGameRecordV1(state, EXPORTED_AT).positionSnapshots
        );
      }
    }
  });

  it('strict方式の盤外移動による反則負けをv1 JSONで往復できる', () => {
    const foul = executeMove(
      createInitialBoardState(),
      { row: 6, col: 2 },
      { row: -1, col: 2 },
      { mode: 'strict', proposer: 'shogi_engine', engineName: 'out-of-bounds-engine' }
    );
    expect(foul.type).toBe('foul_loss');
    if (foul.type !== 'foul_loss') return;

    const result = importState(foul.state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restoredFouls = result.state.foulHistory ?? [];
    expect(restoredFouls).toEqual(foul.state.foulHistory);
    expect(restoredFouls[0]).toMatchObject({
      reason: 'out_of_bounds',
      from: { row: 6, col: 2 },
      to: { row: -1, col: 2 },
    });
    expect(result.state.status).toBe('ended');
    expect(result.state.result).toEqual(foul.state.result);
  });

  it('strict方式の盤外駒打ちによる反則負けをv1 JSONで往復できる', () => {
    const foul = executeDrop(
      createCapturedBishopState(),
      'gote-bishop-2',
      { row: 9, col: 4 },
      { mode: 'strict', proposer: 'local_ai', engineName: 'drop-engine' }
    );
    expect(foul.type).toBe('foul_loss');
    if (foul.type !== 'foul_loss') return;

    const result = importState(foul.state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restoredFouls = result.state.foulHistory ?? [];
    expect(restoredFouls).toEqual(foul.state.foulHistory);
    expect(restoredFouls[0]).toMatchObject({
      kind: 'drop',
      reason: 'out_of_bounds',
      from: null,
      to: { row: 9, col: 4 },
      pieceId: 'gote-bishop-2',
    });
    expect(result.state.result).toEqual(foul.state.result);
  });

  it('1,000,001を含むstrict盤外移動反則をv1 JSONで往復できる', () => {
    const foul = executeMove(
      createInitialBoardState(),
      { row: 6, col: 2 },
      { row: 1_000_001, col: 2 },
      { mode: 'strict', proposer: 'shogi_engine', engineName: 'large-coordinate-engine' }
    );
    expect(foul.type).toBe('foul_loss');
    if (foul.type !== 'foul_loss') return;

    const result = importState(foul.state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.foulHistory).toEqual(foul.state.foulHistory);
    expect(result.state.result).toEqual(foul.state.result);
  });

  it('-1,000,001を含むstrict盤外移動反則をv1 JSONで往復できる', () => {
    const foul = executeMove(
      createInitialBoardState(),
      { row: -1_000_001, col: 2 },
      { row: 5, col: 2 },
      { mode: 'strict', proposer: 'local_ai' }
    );
    expect(foul.type).toBe('foul_loss');
    if (foul.type !== 'foul_loss') return;

    const result = importState(foul.state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.foulHistory).toEqual(foul.state.foulHistory);
    expect(result.state.result).toEqual(foul.state.result);
  });

  it('1,000,001を含むstrict盤外駒打ち反則をv1 JSONで往復できる', () => {
    const foul = executeDrop(
      createCapturedBishopState(),
      'gote-bishop-2',
      { row: 1_000_001, col: 4 },
      { mode: 'strict', proposer: 'shogi_engine', engineName: 'large-drop-engine' }
    );
    expect(foul.type).toBe('foul_loss');
    if (foul.type !== 'foul_loss') return;

    const result = importState(foul.state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.foulHistory).toEqual(foul.state.foulHistory);
    expect(result.state.foulHistory?.[0]).toMatchObject({
      kind: 'drop',
      reason: 'out_of_bounds',
      to: { row: 1_000_001, col: 4 },
      pieceId: 'gote-bishop-2',
      proposer: 'shogi_engine',
      engineName: 'large-drop-engine',
    });
    expect(result.state.result).toEqual(foul.state.result);
    expect(result.state.status).toBe('ended');
  });

  it.each([
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ['MIN_SAFE_INTEGER', Number.MIN_SAFE_INTEGER],
  ])('%sを含むstrict反則記録を全フィールド維持して往復できる', (_label, row) => {
    const foul = executeMove(
      createInitialBoardState(),
      { row: 6, col: 2 },
      { row, col: 2 },
      { mode: 'strict', proposer: 'shogi_engine', engineName: 'safe-integer-engine' }
    );
    expect(foul.type).toBe('foul_loss');
    if (foul.type !== 'foul_loss') return;

    const result = importState(foul.state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.foulHistory).toEqual(foul.state.foulHistory);
    expect(result.state.foulHistory?.[0]).toMatchObject({
      kind: 'move',
      reason: 'out_of_bounds',
      from: { row: 6, col: 2 },
      to: { row, col: 2 },
      pieceType: 'pawn',
      proposer: 'shogi_engine',
      engineName: 'safe-integer-engine',
    });
    expect(result.state.result).toEqual(foul.state.result);
    expect(result.state.result).toMatchObject({ winner: 'gote', loser: 'sente' });
    expect(result.state.status).toBe('ended');
  });

  it('未終局の初期局面へ架空の反則履歴を追加した記録を拒否する', () => {
    const foul = executeMove(
      createInitialBoardState(),
      { row: 4, col: 4 },
      { row: 3, col: 4 },
      { mode: 'strict', proposer: 'shogi_engine' }
    );
    if (foul.type !== 'foul_loss') throw new Error('foul fixture failed');
    const record = createShogiGameRecordV1(createInitialBoardState(), EXPORTED_AT);
    record.foulHistory.push(structuredClone(foul.foul));

    expect(importShogiGameRecord(JSON.stringify(record))).toMatchObject({
      ok: false,
      code: 'inconsistent_record',
    });
  });

  it('正規の終端反則を複製した記録を拒否する', () => {
    const foul = executeMove(
      createInitialBoardState(),
      { row: 4, col: 4 },
      { row: 3, col: 4 },
      { mode: 'strict', proposer: 'shogi_engine' }
    );
    if (foul.type !== 'foul_loss') throw new Error('foul fixture failed');
    const record = createShogiGameRecordV1(foul.state, EXPORTED_AT);
    record.foulHistory.push(structuredClone(record.foulHistory[0]));

    expect(importShogiGameRecord(JSON.stringify(record))).toMatchObject({
      ok: false,
      code: 'inconsistent_record',
    });
  });

  it.each([
    ['小数', 9.5],
    ['文字列', '9'],
    ['null', null],
    ['MAX_SAFE_INTEGERを超える数値', Number.MAX_SAFE_INTEGER + 1],
    ['MIN_SAFE_INTEGERを下回る数値', Number.MIN_SAFE_INTEGER - 1],
  ])('反則提案座標の%sを拒否する', (_label, value) => {
    const record = createShogiGameRecordV1(createStrictInvalidMoveState(), EXPORTED_AT);
    Reflect.set(record.foulHistory[0].to, 'row', value);
    expect(importShogiGameRecord(JSON.stringify(record))).toMatchObject({
      ok: false,
      code: 'invalid_value',
    });
  });

  it('通常棋譜の盤外座標は反則提案座標と区別して拒否する', () => {
    const execution = executeMove(createInitialBoardState(), { row: 6, col: 2 }, { row: 5, col: 2 });
    if (execution.type !== 'applied') throw new Error('move fixture failed');
    const record = createShogiGameRecordV1(execution.state, EXPORTED_AT);
    record.history[0].to.row = 9;

    expect(importShogiGameRecord(JSON.stringify(record))).toMatchObject({
      ok: false,
      code: 'invalid_value',
    });
  });

  it.each([
    ['投了', () => {
      const execution = executeResignation(createInitialBoardState());
      if (execution.type !== 'applied') throw new Error('resignation fixture failed');
      return execution.state;
    }],
    ['通常の千日手', createRepetitionState],
  ])('%s記録へ架空の反則履歴を追加すると拒否する', (_label, createState) => {
    const fakeFoul = createShogiGameRecordV1(createStrictInvalidMoveState(), EXPORTED_AT).foulHistory[0];
    const record = createShogiGameRecordV1(createState(), EXPORTED_AT);
    record.foulHistory.push(structuredClone(fakeFoul));

    expect(importShogiGameRecord(JSON.stringify(record))).toMatchObject({
      ok: false,
      code: 'inconsistent_record',
    });
  });

  it.each([
    ['reason', (record: ReturnType<typeof createShogiGameRecordV1>) => {
      record.foulHistory[0].reason = 'no_piece_at_source';
    }],
    ['from', (record: ReturnType<typeof createShogiGameRecordV1>) => {
      if (record.foulHistory[0].kind === 'move') record.foulHistory[0].from = { row: 4, col: 4 };
    }],
    ['to', (record: ReturnType<typeof createShogiGameRecordV1>) => {
      record.foulHistory[0].to = { row: 5, col: 2 };
    }],
    ['pieceType', (record: ReturnType<typeof createShogiGameRecordV1>) => {
      record.foulHistory[0].pieceType = null;
    }],
    ['message', (record: ReturnType<typeof createShogiGameRecordV1>) => {
      record.foulHistory[0].message = '改ざんされたメッセージ';
    }],
  ])('終端反則の%s改ざんを再実行結果との不整合として拒否する', (_label, mutate) => {
    const record = createShogiGameRecordV1(createStrictInvalidMoveState(), EXPORTED_AT);
    mutate(record);
    expect(importShogiGameRecord(JSON.stringify(record))).toMatchObject({
      ok: false,
      code: 'inconsistent_record',
    });
  });

  it('駒打ち終端反則のpieceId改ざんを再実行結果との不整合として拒否する', () => {
    const record = createShogiGameRecordV1(createStrictInvalidDropState(), EXPORTED_AT);
    const foul = record.foulHistory[0];
    if (foul.kind !== 'drop') throw new Error('drop foul fixture failed');
    foul.pieceId = 'tampered-piece-id';

    expect(importShogiGameRecord(JSON.stringify(record))).toMatchObject({
      ok: false,
      code: 'inconsistent_record',
    });
  });

  it.each([
    ['kind', 'future_kind'],
    ['proposer', 'future_proposer'],
    ['engineName', 123],
  ])('終端反則の%sをv1未定義値へ改ざんすると拒否する', (key, value) => {
    const record = createShogiGameRecordV1(createStrictInvalidMoveState(), EXPORTED_AT);
    Reflect.set(record.foulHistory[0], key, value);
    expect(importShogiGameRecord(JSON.stringify(record))).toMatchObject({ ok: false });
  });

  it('反則履歴のtimestampは保存値を維持し、入力JSONと可変参照を共有しない', () => {
    const source = createShogiGameRecordV1(createStrictInvalidMoveState(), EXPORTED_AT);
    source.foulHistory[0].timestamp = 123_456;
    const result = importShogiGameRecord(JSON.stringify(source));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restoredFouls = result.state.foulHistory ?? [];
    expect(restoredFouls[0].timestamp).toBe(123_456);

    source.foulHistory[0].to.row = 999;
    expect(restoredFouls[0].to.row).toBe(4);
    restoredFouls[0].to.col = 999;
    expect(source.foulHistory[0].to.col).toBe(2);
  });

  it('入力JSONと盤・持ち駒・棋譜・履歴の可変参照を共有しない', () => {
    const source = createShogiGameRecordV1(createPlayedState(), EXPORTED_AT);
    const result = importShogiGameRecord(JSON.stringify(source));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const before = structuredClone(result.state);

    source.latestState.squares[4][4].piece = null;
    source.history[0].to.row = 0;
    source.positionHistory[0].key = 'changed';
    source.positionSnapshots[0].squares[0][0].piece = null;

    expect(result.state).toEqual(before);
    result.state.squares[4][4].piece = null;
    expect(source.latestState.squares[4][4].piece).toBeNull();
    expect(source.history[0].to.row).toBe(0);
  });

  it.each([
    ['', 'invalid_json'],
    ['not json', 'invalid_json'],
    ['null', 'invalid_value'],
    ['[]', 'invalid_value'],
    ['"text"', 'invalid_value'],
  ])('%s を分類して拒否する', (json, code) => {
    expect(importShogiGameRecord(json)).toMatchObject({ ok: false, code });
  });

  it('別形式、version欠落、型不正、未対応versionを区別する', () => {
    expect(importShogiGameRecord('{"format":"other","version":1}')).toMatchObject({
      ok: false,
      code: 'wrong_format',
    });
    expect(importShogiGameRecord('{"format":"shogi-app-game-record"}')).toMatchObject({
      ok: false,
      code: 'missing_required',
    });
    expect(importShogiGameRecord('{"format":"shogi-app-game-record","version":"1"}')).toMatchObject({
      ok: false,
      code: 'invalid_value',
    });
    expect(importShogiGameRecord('{"format":"shogi-app-game-record","version":2}')).toMatchObject({
      ok: false,
      code: 'unsupported_version',
    });
  });

  it.each([
    ['想定外キー', (record: ReturnType<typeof createShogiGameRecordV1>) => Object.assign(record, { __proto__: null, unexpected: true })],
    ['9行でない盤面', (record: ReturnType<typeof createShogiGameRecordV1>) => record.latestState.squares.pop()],
    ['座標ずれ', (record: ReturnType<typeof createShogiGameRecordV1>) => { record.latestState.squares[0][0].row = 1; }],
    ['小数手数', (record: ReturnType<typeof createShogiGameRecordV1>) => { record.latestState.moveNumber = 1.5; }],
    ['重複ID', (record: ReturnType<typeof createShogiGameRecordV1>) => {
      record.latestState.squares[0][1].piece!.id = record.latestState.squares[0][0].piece!.id;
    }],
    ['玉の持ち駒', (record: ReturnType<typeof createShogiGameRecordV1>) => {
      record.latestState.senteHand.push({ id: 'king-in-hand', type: 'king', player: 'sente', isPromoted: false });
    }],
    ['成った持ち駒', (record: ReturnType<typeof createShogiGameRecordV1>) => {
      record.latestState.senteHand.push({ id: 'promoted-hand', type: 'pawn', player: 'sente', isPromoted: true });
    }],
    ['所有者違いの持ち駒', (record: ReturnType<typeof createShogiGameRecordV1>) => {
      record.latestState.senteHand.push({ id: 'wrong-owner', type: 'pawn', player: 'gote', isPromoted: false });
    }],
  ])('%sを安全に拒否する', (_label, mutate) => {
    const record = createShogiGameRecordV1(createInitialBoardState(), EXPORTED_AT);
    mutate(record);
    expect(importShogiGameRecord(JSON.stringify(record))).toMatchObject({ ok: false });
  });

  it.each([
    ['棋譜表記', (record: ReturnType<typeof createShogiGameRecordV1>) => { record.history[0].notation = '▲改ざん'; }],
    ['最新盤面', (record: ReturnType<typeof createShogiGameRecordV1>) => { record.latestState.squares[5][2].piece = null; }],
    ['lastMove', (record: ReturnType<typeof createShogiGameRecordV1>) => { record.lastMove = null; }],
    ['positionHistory', (record: ReturnType<typeof createShogiGameRecordV1>) => { record.positionHistory[1].key = 'tampered'; }],
    ['positionSnapshots', (record: ReturnType<typeof createShogiGameRecordV1>) => { record.positionSnapshots.pop(); }],
    ['moveLimitJishogi', (record: ReturnType<typeof createShogiGameRecordV1>) => {
      record.moveLimitJishogi = { kind: 'awaiting_continuous_check_end', checkingPlayer: 'sente' };
    }],
  ])('%sの改ざんを棋譜との不整合として拒否する', (_label, mutate) => {
    const state = executeMove(createInitialBoardState(), { row: 6, col: 2 }, { row: 5, col: 2 });
    if (state.type !== 'applied') throw new Error('fixture failed');
    const record = createShogiGameRecordV1(state.state, EXPORTED_AT);
    mutate(record);
    expect(importShogiGameRecord(JSON.stringify(record))).toMatchObject({
      ok: false,
      code: 'inconsistent_record',
    });
  });

  it('ファイルサイズ上限の境界を分類する', () => {
    const atLimit = ' '.repeat(MAX_SHOGI_GAME_RECORD_FILE_BYTES);
    const overLimit = `${atLimit} `;
    expect(importShogiGameRecord(atLimit)).toMatchObject({ ok: false, code: 'invalid_json' });
    expect(importShogiGameRecord(overLimit)).toMatchObject({ ok: false, code: 'file_too_large' });
  });
});

describe('対局記録読み込みUI', () => {
  function getFileInput(): HTMLInputElement {
    const input = document.getElementById('shogi-game-record-file-input');
    if (!(input instanceof HTMLInputElement)) throw new Error('file input not found');
    return input;
  }

  it('JSON入力と読み込みボタンを関連付け、正常ファイルは確定まで現在局面を変えない', async () => {
    const user = userEvent.setup();
    const current = executeMove(createInitialBoardState(), { row: 6, col: 2 }, { row: 5, col: 2 });
    if (current.type !== 'applied') throw new Error('fixture failed');
    render(<ShogiResearchScreen initialState={current.state} />);
    const button = screen.getByRole('button', { name: '対局記録を読み込む' });
    expect(button).toHaveAttribute('aria-controls', 'shogi-game-record-file-input');
    expect(getFileInput()).toHaveAttribute('accept', '.json,application/json');

    await user.upload(
      getFileInput(),
      new File([serializeShogiGameRecordV1(createInitialBoardState(), EXPORTED_AT)], 'initial.json', {
        type: 'application/json',
      })
    );

    const dialog = await screen.findByRole('dialog', { name: 'この対局記録を読み込みますか？' });
    expect(dialog).toHaveTextContent('initial.json');
    expect(dialog).toHaveTextContent(EXPORTED_AT.toISOString());
    expect(dialog).toHaveTextContent('0手');
    expect(dialog).toHaveTextContent('未終局（続行可能）');
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '1');
    expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '読み込む' }));
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
    expect(screen.getByText(/対局記録を読み込みました/)).toHaveAttribute('role', 'status');
    expect(button).toHaveFocus();
  });

  it('研究セッションJSONは全分岐と選択中の分岐を復元し、本譜・分岐を切り替えられる', async () => {
    const user = userEvent.setup();
    const first = executeMove(createInitialBoardState(), { row: 6, col: 2 }, { row: 5, col: 2 });
    if (first.type !== 'applied') throw new Error('first move failed');
    const second = executeMove(first.state, { row: 2, col: 6 }, { row: 3, col: 6 });
    if (second.type !== 'applied') throw new Error('second move failed');
    const started = addGameRecordSessionBranch(createGameRecordSession(second.state), second.state, 1);
    if (!started.ok || !started.boardState) throw new Error('branch fixture failed');
    const branchMove = executeMove(started.boardState, { row: 2, col: 5 }, { row: 3, col: 5 });
    if (branchMove.type !== 'applied') throw new Error('branch move failed');
    const session = storeGameRecordSessionState(started.session, branchMove.state);
    const branchId = session.branches[0].state.recordId!;

    render(<ShogiResearchScreen initialState={createInitialBoardState()} />);
    await user.upload(
      getFileInput(),
      new File([serializeShogiGameRecordSessionV1(session, EXPORTED_AT)], 'research-session.json', {
        type: 'application/json',
      })
    );
    await user.click(await screen.findByRole('button', { name: '読み込む' }));

    const root = document.getElementById('shogi-research-screen');
    expect(root).toHaveAttribute('data-session-branch-count', '1');
    expect(root).toHaveAttribute('data-active-session-record', branchId);
    const branchButton = screen.getByRole('button', { name: '第1手後からの分岐 1' });
    expect(branchButton).toHaveAttribute('aria-current', 'page');
    expect(root).toHaveAttribute('data-last-move', '△4四歩');

    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    expect(root).toHaveAttribute('data-active-session-record', 'mainline');
    expect(root).toHaveAttribute('data-last-move', '△3四歩');

    await user.click(branchButton);
    expect(root).toHaveAttribute('data-active-session-record', branchId);
    expect(root).toHaveAttribute('data-last-move', '△4四歩');
  });

  it('Escape、背景クリック、キャンセルでは現在局面を維持し、同じファイルを再選択できる', async () => {
    const user = userEvent.setup();
    const current = executeMove(createInitialBoardState(), { row: 6, col: 2 }, { row: 5, col: 2 });
    if (current.type !== 'applied') throw new Error('fixture failed');
    render(<ShogiResearchScreen initialState={current.state} />);
    const file = new File([serializeShogiGameRecordV1(createInitialBoardState(), EXPORTED_AT)], 'same.json', {
      type: 'application/json',
    });

    await user.upload(getFileInput(), file);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '1');

    await user.upload(getFileInput(), file);
    const secondDialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(secondDialog.parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.upload(getFileInput(), file);
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '1');
  });

  it('不正JSONではalertを表示し、現在局面を変更しない', async () => {
    const user = userEvent.setup();
    const current = executeMove(createInitialBoardState(), { row: 6, col: 2 }, { row: 5, col: 2 });
    if (current.type !== 'applied') throw new Error('fixture failed');
    render(<ShogiResearchScreen initialState={current.state} />);

    await user.upload(getFileInput(), new File(['not-json'], 'broken.json', { type: 'application/json' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('JSONとして読み取れない'));
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ファイル読み取り失敗をalertにし、終局済み記録は閲覧専用で読み込む', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    const unreadable = new File(['unused'], 'unreadable.json', { type: 'application/json' });
    Object.defineProperty(unreadable, 'text', {
      value: vi.fn().mockRejectedValue(new Error('read failed')),
    });
    await user.upload(getFileInput(), unreadable);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ファイルを読み取れませんでした'));
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-result', '');

    const resignation = executeResignation(createInitialBoardState());
    if (resignation.type !== 'applied') throw new Error('fixture failed');
    await user.upload(
      getFileInput(),
      new File([serializeShogiGameRecordV1(resignation.state, EXPORTED_AT)], 'ended.json', {
        type: 'application/json',
      })
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('終局済み');
    await user.click(screen.getByRole('button', { name: '読み込む' }));
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-result', 'resignation');
    expect(screen.getByText('後手勝ち（先手投了）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '投了' })).toBeDisabled();
  });

  it('確認中は競合操作を停止し、TabとShift+Tabをダイアログ内へ閉じ込める', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    await user.upload(
      getFileInput(),
      new File([serializeShogiGameRecordV1(createInitialBoardState(), EXPORTED_AT)], 'record.json', {
        type: 'application/json',
      })
    );
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: '対局記録を保存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '新しい対局' })).toBeDisabled();
    const cancel = screen.getByRole('button', { name: 'キャンセル' });
    const confirm = screen.getByRole('button', { name: '読み込む' });
    expect(cancel).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(confirm).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(cancel).toHaveFocus();
  });
});
