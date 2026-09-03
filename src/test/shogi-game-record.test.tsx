import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import {
  createShogiGameRecordFilename,
  createShogiGameRecordV1,
  downloadShogiGameRecord,
  executeMove,
  serializeShogiGameRecordV1,
  SHOGI_GAME_RECORD_FORMAT,
  SHOGI_GAME_RECORD_MIME_TYPE,
  SHOGI_GAME_RECORD_VERSION,
} from '../domain/shogi';
import { applyMove } from '../domain/shogi/gameState';
import {
  createInitialBoardState,
  type BoardStatus,
  type BoardSquare,
  type BoardState,
  type FoulRecord,
  type GameResult,
  type IllegalMoveReason,
  type MoveLimitJishogiState,
  type MovePromotion,
  type MoveRecord,
  type Piece,
  type PieceType,
  type Player,
  type PositionRecord,
  type ProposerType,
} from '../types/shogi';

const EXPORTED_AT = new Date('2026-09-02T03:04:05.678Z');

const ALL_ILLEGAL_MOVE_REASONS: IllegalMoveReason[] = [
  'out_of_bounds',
  'no_piece_at_source',
  'not_current_turn',
  'not_own_piece',
  'invalid_piece_move',
  'occupied_by_own_piece',
  'captured_king',
  'dead_piece',
  'promotion_choice_required',
  'invalid_promotion',
  'promotion_required',
  'king_suicide',
  'self_check_unresolved',
  'hand_piece_not_found',
  'not_own_hand_piece',
  'occupied_drop_square',
  'undroppable_piece',
  'invalid_hand_piece_state',
  'dead_piece_drop',
  'nifu',
  'pawn_drop_mate',
  'game_already_ended',
];

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

function createRichState(): BoardState {
  const state = createInitialBoardState();
  const moves: MoveRecord[] = [
    {
      kind: 'move',
      moveNumber: 1,
      player: 'sente',
      from: { row: 6, col: 2 },
      to: { row: 5, col: 2 },
      pieceType: 'pawn',
      capturedPieceType: null,
      promotion: 'none',
      notation: '▲7六歩',
    },
    {
      kind: 'move',
      moveNumber: 21,
      player: 'sente',
      from: { row: 7, col: 1 },
      to: { row: 1, col: 7 },
      pieceType: 'bishop',
      capturedPieceType: 'silver',
      promotion: 'promote',
      notation: '▲2二角成',
    },
    {
      kind: 'move',
      moveNumber: 22,
      player: 'gote',
      from: { row: 1, col: 7 },
      to: { row: 7, col: 1 },
      pieceType: 'bishop',
      capturedPieceType: 'bishop',
      promotion: 'decline',
      notation: '△8八角不成',
    },
    {
      kind: 'drop',
      moveNumber: 23,
      player: 'sente',
      from: null,
      to: { row: 4, col: 4 },
      pieceId: 'captured-pawn',
      pieceType: 'pawn',
      capturedPieceType: null,
      promotion: 'none',
      notation: '▲5五歩打',
    },
  ];
  const senteHand: Piece = { id: 'sente-hand-rook', type: 'rook', player: 'sente' };
  const goteHand: Piece = {
    id: 'gote-hand-silver',
    type: 'silver',
    player: 'gote',
    isPromoted: false,
  };
  const foul: FoulRecord = {
    kind: 'drop',
    moveNumber: 24,
    player: 'gote',
    from: null,
    to: { row: 4, col: 4 },
    pieceId: 'foul-pawn',
    pieceType: 'pawn',
    reason: 'nifu',
    message: '二歩です',
    proposer: 'shogi_engine',
    engineName: 'test-engine',
    timestamp: 1_788_317_045_678,
  };

  state.history = moves;
  state.lastMove = moves.at(-1);
  state.senteHand = [senteHand];
  state.goteHand = [goteHand];
  state.status = 'check';
  state.turn = 'gote';
  state.moveNumber = 24;
  state.foulHistory = [foul];
  state.positionHistory = [
    { key: 'initial-key', historyIndex: 0, movedBy: null, gaveCheck: false },
    { key: 'check-key', historyIndex: 4, movedBy: 'sente', gaveCheck: true },
  ];
  state.positionSnapshots = [
    {
      historyIndex: 4,
      squares: state.squares,
      senteHand: state.senteHand,
      goteHand: state.goteHand,
      turn: state.turn,
      moveNumber: state.moveNumber,
      status: state.status,
      lastMove: state.lastMove ?? null,
      result: null,
    },
  ];
  state.moveLimitJishogi = {
    kind: 'awaiting_continuous_check_end',
    checkingPlayer: 'sente',
  };
  state.viewMode = 'spectator';
  return state;
}

interface DownloadMocks {
  createObjectURL: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.spyOn>;
  getClickedLink: () => HTMLAnchorElement | null;
}

function mockDownloadApis(): DownloadMocks {
  let clickedLink: HTMLAnchorElement | null = null;
  const createObjectURL = vi.fn(() => 'blob:shogi-record');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL,
    revokeObjectURL,
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      clickedLink = this;
    });
  return { createObjectURL, revokeObjectURL, click, getClickedLink: () => clickedLink };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('バージョン付き対局記録JSON', () => {
  it('固定識別子、version 1、ISO日時、平手初期局面を保存する', () => {
    const record = createShogiGameRecordV1(createInitialBoardState(), EXPORTED_AT);

    expect(record).toMatchObject({
      format: SHOGI_GAME_RECORD_FORMAT,
      version: SHOGI_GAME_RECORD_VERSION,
      exportedAt: '2026-09-02T03:04:05.678Z',
      initialPosition: 'hirate',
      latestState: {
        turn: 'sente',
        moveNumber: 1,
        status: 'active',
        senteHand: [],
        goteHand: [],
      },
      history: [],
      lastMove: null,
      result: null,
      foulHistory: [],
      moveLimitJishogi: null,
    });
    expect(record.latestState.squares).toHaveLength(9);
    expect(record.latestState.squares[0]).toHaveLength(9);
  });

  it('通常移動後の棋譜と最新局面を保存する', () => {
    const state = applyMove(
      createInitialBoardState(),
      { row: 6, col: 2 },
      { row: 5, col: 2 }
    );
    const record = createShogiGameRecordV1(state, EXPORTED_AT);

    expect(record.history).toHaveLength(1);
    expect(record.history[0]).toMatchObject({ notation: '▲7六歩', promotion: 'none' });
    expect(record.latestState.squares[5][2].piece).toMatchObject({
      type: 'pawn',
      player: 'sente',
    });
    expect(record.latestState.squares[6][2].piece).toBeNull();
  });

  it('成り、不成、駒取り、駒打ち、両者の持ち駒、王手、反則履歴を欠落なく保存する', () => {
    const state = createRichState();
    const record = createShogiGameRecordV1(state, EXPORTED_AT);

    expect(record.history.map((move) => move.promotion)).toEqual([
      'none',
      'promote',
      'decline',
      'none',
    ]);
    expect(record.history[1]).toMatchObject({ capturedPieceType: 'silver' });
    expect(record.history[3]).toMatchObject({ kind: 'drop', pieceId: 'captured-pawn' });
    expect(record.latestState.senteHand[0]).toMatchObject({ type: 'rook', isPromoted: false });
    expect(record.latestState.goteHand[0]).toMatchObject({ type: 'silver' });
    expect(record.latestState.status).toBe('check');
    expect(record.foulHistory[0]).toEqual({
      kind: 'drop',
      moveNumber: 24,
      player: 'gote',
      from: null,
      to: { row: 4, col: 4 },
      pieceId: 'foul-pawn',
      pieceType: 'pawn',
      reason: 'nifu',
      message: '二歩です',
      proposer: 'shogi_engine',
      engineName: 'test-engine',
      timestamp: 1_788_317_045_678,
    });
  });

  const gameResults: GameResult[] = [
    { winner: 'sente', loser: 'gote', endReason: 'checkmate', details: '詰み' },
    { winner: 'gote', loser: 'sente', endReason: 'resignation' },
    {
      winner: 'gote',
      loser: 'sente',
      endReason: 'foul_loss',
      foulReason: 'nifu',
    },
    {
      winner: 'gote',
      loser: 'sente',
      endReason: 'foul_loss',
      foulReason: 'perpetual_check_repetition',
    },
    { winner: null, loser: null, endReason: 'repetition' },
    { winner: null, loser: null, endReason: 'five_hundred_move_jishogi' },
    {
      winner: null,
      loser: null,
      endReason: 'agreed_jishogi_draw',
      sentePoints: 24,
      gotePoints: 24,
    },
    {
      winner: 'sente',
      loser: 'gote',
      endReason: 'agreed_jishogi_point_loss',
      sentePoints: 27,
      gotePoints: 23,
    },
    { winner: 'sente', loser: 'gote', endReason: 'entering_king_win' },
    { winner: null, loser: null, endReason: 'entering_king_draw' },
    {
      winner: 'gote',
      loser: 'sente',
      endReason: 'entering_king_declaration_failure',
    },
  ];

  it.each(gameResults)('$endReason の全結果フィールドを保存する', (result) => {
    const state = createInitialBoardState();
    state.status = 'ended';
    state.result = result;
    expect(createShogiGameRecordV1(state, EXPORTED_AT).result).toEqual(result);
  });

  it('positionHistory、positionSnapshots、500手待機状態の有無を保存する', () => {
    const state = createRichState();
    const withWaiting = createShogiGameRecordV1(state, EXPORTED_AT);
    state.moveLimitJishogi = undefined;
    const withoutWaiting = createShogiGameRecordV1(state, EXPORTED_AT);

    expect(withWaiting.positionHistory).toEqual(state.positionHistory);
    expect(withWaiting.positionSnapshots[0]).toMatchObject({
      historyIndex: 4,
      turn: 'gote',
      status: 'check',
    });
    expect(withWaiting.positionSnapshots[0].squares).not.toBe(state.positionSnapshots?.[0].squares);
    expect(withWaiting.moveLimitJishogi).toEqual({
      kind: 'awaiting_continuous_check_end',
      checkingPlayer: 'sente',
    });
    expect(withoutWaiting.moveLimitJishogi).toBeNull();
  });

  it('元状態を変更せず、生成物との可変参照を共有しない', () => {
    const state = createRichState();
    const before = structuredClone(state);
    const record = createShogiGameRecordV1(state, EXPORTED_AT);

    expect(state).toEqual(before);
    record.latestState.squares[0][0].piece = null;
    record.latestState.senteHand[0].id = 'changed';
    record.history[0].to.row = 0;
    record.foulHistory[0].to.row = 0;
    record.positionHistory[0].key = 'changed';
    record.positionSnapshots[0].squares[0][0].piece = null;
    if (record.moveLimitJishogi) record.moveLimitJishogi.checkingPlayer = 'gote';

    expect(state).toEqual(before);
  });

  it('同じ状態と日時から同じ、parse可能で末尾改行付きのJSONを生成する', () => {
    const state = createRichState();
    const first = serializeShogiGameRecordV1(state, EXPORTED_AT);
    const second = serializeShogiGameRecordV1(state, EXPORTED_AT);

    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);
    expect(JSON.parse(first)).toEqual(createShogiGameRecordV1(state, EXPORTED_AT));
    expect(first).toContain('\n  "format"');
  });

  it('viewMode、盤表示用メタデータ、Reactの一時状態を保存しない', () => {
    const json = serializeShogiGameRecordV1(createRichState(), EXPORTED_AT);

    expect(json).not.toContain('viewMode');
    expect(json).not.toContain('coordinateLabel');
    expect(json).not.toContain('hasBottomRightStarMarker');
    expect(json).not.toContain('replayHistoryIndex');
    expect(json).not.toContain('selection');
    expect(json).not.toContain('dialog');
    expect(json).not.toContain('focusRequest');
  });

  it('positionHistoryと500手待機へ追加された型外プロパティをv1へ混入させない', () => {
    const state = createRichState();
    const position = state.positionHistory?.[0] as PositionRecord & {
      futurePositionMetadata: string;
    };
    const moveLimit = state.moveLimitJishogi as MoveLimitJishogiState & {
      futureWaitingMetadata: string;
    };
    position.futurePositionMetadata = 'must-not-be-saved';
    moveLimit.futureWaitingMetadata = 'must-not-be-saved';

    const record = createShogiGameRecordV1(state, EXPORTED_AT);
    const json = serializeShogiGameRecordV1(state, EXPORTED_AT);

    expect(record.positionHistory[0]).toEqual({
      key: 'initial-key',
      historyIndex: 0,
      movedBy: null,
      gaveCheck: false,
    });
    expect(record.moveLimitJishogi).toEqual({
      kind: 'awaiting_continuous_check_end',
      checkingPlayer: 'sente',
    });
    expect(record.positionHistory[0]).not.toHaveProperty('futurePositionMetadata');
    expect(record.moveLimitJishogi).not.toHaveProperty('futureWaitingMetadata');
    expect(json).not.toContain('futurePositionMetadata');
    expect(json).not.toContain('futureWaitingMetadata');
  });

  it('v1の主要オブジェクトを定義済みキーだけで生成する', () => {
    const state = createRichState();
    state.result = { winner: 'sente', loser: 'gote', endReason: 'checkmate' };
    const record = createShogiGameRecordV1(state, EXPORTED_AT);

    expect(sortedKeys(record)).toEqual(
      [
        'format',
        'version',
        'recordId',
        'exportedAt',
        'initialPosition',
        'latestState',
        'history',
        'lastMove',
        'result',
        'foulHistory',
        'positionHistory',
        'positionSnapshots',
        'moveLimitJishogi',
      ].sort()
    );
    expect(sortedKeys(record.latestState)).toEqual(
      ['squares', 'senteHand', 'goteHand', 'turn', 'moveNumber', 'status'].sort()
    );
    expect(sortedKeys(record.latestState.squares[0][0])).toEqual(['row', 'col', 'piece'].sort());
    expect(sortedKeys(record.latestState.squares[0][0].piece as object)).toEqual(
      ['id', 'type', 'player', 'isPromoted'].sort()
    );
    expect(sortedKeys(record.history[0])).toEqual(
      [
        'kind',
        'moveNumber',
        'player',
        'from',
        'to',
        'pieceType',
        'capturedPieceType',
        'promotion',
        'notation',
      ].sort()
    );
    expect(sortedKeys(record.history[3])).toEqual(
      [
        'kind',
        'moveNumber',
        'player',
        'from',
        'to',
        'pieceId',
        'pieceType',
        'capturedPieceType',
        'promotion',
        'notation',
      ].sort()
    );
    expect(sortedKeys(record.foulHistory[0])).toEqual(
      [
        'kind',
        'moveNumber',
        'player',
        'from',
        'to',
        'pieceId',
        'pieceType',
        'reason',
        'message',
        'proposer',
        'engineName',
        'timestamp',
      ].sort()
    );
    expect(sortedKeys(record.positionHistory[0])).toEqual(
      ['key', 'historyIndex', 'movedBy', 'gaveCheck'].sort()
    );
    expect(sortedKeys(record.positionSnapshots[0])).toEqual(
      [
        'historyIndex',
        'squares',
        'senteHand',
        'goteHand',
        'turn',
        'moveNumber',
        'status',
        'lastMove',
        'result',
      ].sort()
    );
    expect(sortedKeys(record.moveLimitJishogi as object)).toEqual(
      ['kind', 'checkingPlayer'].sort()
    );
    expect(sortedKeys(record.result as object)).toEqual(
      ['winner', 'loser', 'endReason'].sort()
    );
  });

  const unknownValueCases: ReadonlyArray<{
    label: string;
    expected: RegExp;
    mutate: (state: BoardState) => void;
  }> = [
    {
      label: '駒種',
      expected: /駒種.*future_piece/,
      mutate: (state) => {
        const piece = state.squares[0][0].piece as Piece;
        piece.type = 'future_piece' as unknown as PieceType;
      },
    },
    {
      label: '盤面状態',
      expected: /盤面状態.*future_status/,
      mutate: (state) => {
        state.status = 'future_status' as unknown as BoardStatus;
      },
    },
    {
      label: '反則理由',
      expected: /反則理由.*future_reason/,
      mutate: (state) => {
        const foul = state.foulHistory?.[0] as FoulRecord;
        foul.reason = 'future_reason' as unknown as IllegalMoveReason;
      },
    },
    {
      label: 'プレイヤー',
      expected: /プレイヤー.*future_player/,
      mutate: (state) => {
        state.turn = 'future_player' as unknown as Player;
      },
    },
    {
      label: '成り状態',
      expected: /成り状態.*future_promotion/,
      mutate: (state) => {
        state.history[0].promotion = 'future_promotion' as unknown as MovePromotion;
      },
    },
    {
      label: '提案者種別',
      expected: /提案者種別.*future_proposer/,
      mutate: (state) => {
        const foul = state.foulHistory?.[0] as FoulRecord;
        foul.proposer = 'future_proposer' as unknown as ProposerType;
      },
    },
    {
      label: '500手持将棋待機種別',
      expected: /500手持将棋待機種別.*future_waiting/,
      mutate: (state) => {
        const waiting = state.moveLimitJishogi as MoveLimitJishogiState;
        waiting.kind = 'future_waiting' as unknown as MoveLimitJishogiState['kind'];
      },
    },
    {
      label: '終局結果',
      expected: /終局結果.*future_result/,
      mutate: (state) => {
        state.result = {
          winner: null,
          loser: null,
          endReason: 'future_result',
        } as unknown as GameResult;
      },
    },
  ];

  it.each(unknownValueCases)('$label の未知値をv1へ出力せず例外にする', ({ mutate, expected }) => {
    const state = createRichState();
    mutate(state);
    expect(() => serializeShogiGameRecordV1(state, EXPORTED_AT)).toThrow(expected);
  });

  it('現在サポートする固定値を従来どおりすべて出力できる', () => {
    const pieceState = createInitialBoardState();
    const pieceTypes = [
      ...new Set(
        createShogiGameRecordV1(pieceState, EXPORTED_AT).latestState.squares
          .flat()
          .flatMap((square) => (square.piece ? [square.piece.type] : []))
      ),
    ].sort();
    expect(pieceTypes).toEqual(
      ['king', 'rook', 'bishop', 'gold', 'silver', 'knight', 'lance', 'pawn'].sort()
    );

    const statuses: BoardStatus[] = [
      'preparation',
      'active',
      'check',
      'blunder',
      'evaluating',
      'ended',
    ];
    expect(
      statuses.map((status) => {
        const state = createInitialBoardState();
        state.status = status;
        return createShogiGameRecordV1(state, EXPORTED_AT).latestState.status;
      })
    ).toEqual(statuses);

    const proposers: ProposerType[] = ['human', 'local_ai', 'shogi_engine'];
    const foulState = createInitialBoardState();
    foulState.foulHistory = ALL_ILLEGAL_MOVE_REASONS.map((reason, index) => ({
      kind: 'move',
      moveNumber: index + 1,
      player: index % 2 === 0 ? 'sente' : 'gote',
      from: { row: 6, col: 0 },
      to: { row: 5, col: 0 },
      pieceType: 'pawn',
      reason,
      message: reason,
      proposer: proposers[index % proposers.length],
    }));
    const foulRecord = createShogiGameRecordV1(foulState, EXPORTED_AT);
    expect(foulRecord.foulHistory.map((foul) => foul.reason)).toEqual(
      ALL_ILLEGAL_MOVE_REASONS
    );
    expect([...new Set(foulRecord.foulHistory.map((foul) => foul.proposer))]).toEqual(
      proposers
    );
    expect(createShogiGameRecordV1(createRichState(), EXPORTED_AT).history.map((move) => move.promotion)).toEqual([
      'none',
      'promote',
      'decline',
      'none',
    ]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('正しくない数値 %s を安全に拒否する', (value) => {
    const state = createInitialBoardState();
    state.moveNumber = value;
    expect(() => serializeShogiGameRecordV1(state, EXPORTED_AT)).toThrow(/有限でない数値/);
  });

  it.each([
    ['MAX_SAFE_INTEGER超過', { row: 6, col: 2 }, { row: Number.MAX_SAFE_INTEGER + 1, col: 2 }],
    ['MIN_SAFE_INTEGER未満', { row: Number.MIN_SAFE_INTEGER - 1, col: 2 }, { row: 5, col: 2 }],
    ['小数', { row: 6, col: 2 }, { row: 9.5, col: 2 }],
    ['NaN', { row: 6, col: 2 }, { row: Number.NaN, col: 2 }],
    ['Infinity', { row: 6, col: 2 }, { row: Number.POSITIVE_INFINITY, col: 2 }],
  ])('v1で表現不能な反則提案座標（%s）を保存時に拒否する', (_label, from, to) => {
    const execution = executeMove(createInitialBoardState(), from, to, {
      mode: 'strict',
      proposer: 'shogi_engine',
    });
    if (execution.type !== 'foul_loss') throw new Error('foul fixture failed');

    expect(() => serializeShogiGameRecordV1(execution.state, EXPORTED_AT)).toThrow(
      /反則提案座標(?:from|to).*安全な整数/
    );
  });

  it('循環した盤配列を黙ってJSON化しない', () => {
    const state = createInitialBoardState();
    const cyclic: BoardSquare[][] = [];
    cyclic.push(cyclic as unknown as BoardSquare[]);
    state.squares = cyclic;
    expect(() => serializeShogiGameRecordV1(state, EXPORTED_AT)).toThrow();
  });

  it('Windowsでも安全な衝突しにくい日時入りファイル名を作る', () => {
    expect(createShogiGameRecordFilename(EXPORTED_AT)).toBe(
      'shogi-game-20260902-030405.678Z.json'
    );
    expect(createShogiGameRecordFilename(EXPORTED_AT)).not.toMatch(/[<>:"/\\|?*]/);
  });
});

describe('対局記録のブラウザダウンロード', () => {
  it('UTF-8 JSON Blobと一時リンクを使い、リンク除去後にObject URLを解放する', () => {
    vi.useFakeTimers();
    const mocks = mockDownloadApis();
    const json = '{\n  "version": 1\n}\n';

    downloadShogiGameRecord(json, 'shogi-game-test.json');

    const blob = mocks.createObjectURL.mock.calls[0][0] as Blob;
    const link = mocks.getClickedLink();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(SHOGI_GAME_RECORD_MIME_TYPE);
    expect(link?.download).toBe('shogi-game-test.json');
    expect(link?.href).toBe('blob:shogi-record');
    expect(link?.isConnected).toBe(false);
    expect(mocks.revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:shogi-record');
  });

  it('クリックが失敗しても一時リンクとObject URLを後始末する', () => {
    vi.useFakeTimers();
    const mocks = mockDownloadApis();
    mocks.click.mockImplementation(() => {
      throw new Error('download blocked');
    });

    expect(() => downloadShogiGameRecord('{}\n', 'record.json')).toThrow('download blocked');
    expect(document.querySelector('a[download="record.json"]')).not.toBeInTheDocument();
    vi.runAllTimers();
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:shogi-record');
  });
});

describe('対局記録を保存するUI', () => {
  it.each([
    ['対局開始直後', () => createInitialBoardState()],
    [
      '対局途中',
      () =>
        applyMove(createInitialBoardState(), { row: 6, col: 2 }, { row: 5, col: 2 }),
    ],
    [
      '王手中',
      () => {
        const state = createInitialBoardState();
        state.status = 'check';
        return state;
      },
    ],
    [
      '終局後',
      () => {
        const state = createInitialBoardState();
        state.status = 'ended';
        state.result = { winner: 'sente', loser: 'gote', endReason: 'checkmate' };
        return state;
      },
    ],
  ] as const)('%sに明確なラベルの保存ボタンを利用できる', async (_label, makeState) => {
    const user = userEvent.setup();
    const mocks = mockDownloadApis();
    render(<ShogiResearchScreen initialState={makeState()} />);

    const button = screen.getByRole('button', { name: '対局記録を保存' });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(mocks.createObjectURL).toHaveBeenCalledOnce();
    cleanup();
  });

  it('再生中も最新実状態を保存し、再生位置と対局状態を変えず成功通知する', async () => {
    const user = userEvent.setup();
    const mocks = mockDownloadApis();
    const afterFirst = applyMove(
      createInitialBoardState(),
      { row: 6, col: 2 },
      { row: 5, col: 2 }
    );
    const state = applyMove(afterFirst, { row: 2, col: 6 }, { row: 3, col: 6 });
    render(<ShogiResearchScreen initialState={state} />);

    await user.click(screen.getByRole('button', { name: /1手目 ▲7六歩の局面を表示/ }));
    const root = document.getElementById('shogi-research-screen');
    expect(root).toHaveAttribute('data-replay-history-index', '1');
    expect(root).toHaveAttribute('data-history-count', '2');

    const button = screen.getByRole('button', { name: '対局記録を保存' });
    expect(button).toBeEnabled();
    await user.click(button);

    const blob = mocks.createObjectURL.mock.calls[0][0] as Blob;
    const saved = JSON.parse(await blob.text());
    expect(saved.history).toHaveLength(2);
    expect(saved.lastMove.notation).toBe('△3四歩');
    expect(saved.latestState.squares[3][6].piece).toMatchObject({
      type: 'pawn',
      player: 'gote',
    });
    expect(root).toHaveAttribute('data-replay-history-index', '1');
    expect(root).toHaveAttribute('data-history-count', '2');
    const notice = screen.getByText(/対局記録を保存しました/);
    expect(notice).toHaveAttribute('role', 'status');
    expect(mocks.getClickedLink()?.download).toMatch(
      /^shogi-game-\d{8}-\d{6}\.\d{3}Z\.json$/
    );
  });

  it('ブラウザ処理が失敗すると日本語のrole=alertを表示し、対局を変えない', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => {
        throw new Error('blocked');
      }),
      revokeObjectURL: vi.fn(),
    });
    const state = applyMove(
      createInitialBoardState(),
      { row: 6, col: 2 },
      { row: 5, col: 2 }
    );
    render(<ShogiResearchScreen initialState={state} />);

    await user.click(screen.getByRole('button', { name: '対局記録を保存' }));

    expect(screen.getByRole('alert')).toHaveTextContent('対局記録を保存できませんでした');
    const root = document.getElementById('shogi-research-screen');
    expect(root).toHaveAttribute('data-history-count', '1');
    expect(root).toHaveAttribute('data-last-move', '▲7六歩');
    expect(root).toHaveAttribute('data-replay-history-index', '');
  });
});
