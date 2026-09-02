import type {
  BoardSquare,
  BoardState,
  BoardStatus,
  FoulRecord,
  GameResult,
  IllegalMoveReason,
  MovePromotion,
  MoveRecord,
  Piece,
  PieceType,
  Player,
  PositionRecord,
  PositionSnapshot,
  ProposerType,
} from '../../types/shogi';
import { createInitialBoardState } from '../../types/shogi';
import { evaluateAgreedJishogi } from './agreedJishogi';
import { executeDrop } from './drops';
import { executeEnteringKingDeclaration } from './enteringKing';
import { executeMove } from './gameState';
import {
  createShogiGameRecordV1,
  isShogiGameRecordV1FoulCoordinateValue,
  SHOGI_GAME_RECORD_FORMAT,
  SHOGI_GAME_RECORD_VERSION,
  type SavedBoardStatusV1,
  type SavedFoulRecordV1,
  type SavedGameResultV1,
  type SavedIllegalMoveReasonV1,
  type SavedLatestStateV1,
  type SavedMoveLimitJishogiStateV1,
  type SavedMovePromotionV1,
  type SavedMoveRecordV1,
  type SavedPieceTypeV1,
  type SavedPieceV1,
  type SavedPlayerV1,
  type SavedPositionRecordV1,
  type SavedPositionSnapshotV1,
  type SavedProposerTypeV1,
  type SavedSquareV1,
  type ShogiGameRecordV1,
} from './gameRecord';
import { executeResignation } from './resignation';

/**
 * 500手規模では再生スナップショットが大半を占めるため、余裕を持って32 MiBとする。
 * ブラウザではFile.sizeを先に確認し、ドメイン層でも文字列の実バイト数を再確認する。
 */
export const MAX_SHOGI_GAME_RECORD_FILE_BYTES = 32 * 1024 * 1024;

const MAX_COLLECTION_ITEMS = 10_000;
const MAX_SHORT_STRING_LENGTH = 10_000;
const ISO_8601_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type ShogiGameRecordImportErrorCode =
  | 'invalid_json'
  | 'wrong_format'
  | 'unsupported_version'
  | 'missing_required'
  | 'invalid_value'
  | 'inconsistent_record'
  | 'file_too_large';

export type ShogiGameRecordImportResult =
  | {
      ok: true;
      state: BoardState;
      metadata: {
        exportedAt: string;
        moveCount: number;
        isEnded: boolean;
      };
    }
  | {
      ok: false;
      code: ShogiGameRecordImportErrorCode;
      message: string;
    };

class ImportFailure extends Error {
  constructor(
    readonly code: ShogiGameRecordImportErrorCode,
    message: string
  ) {
    super(message);
  }
}

type UnknownRecord = { [key: string]: unknown };

function fail(code: ShogiGameRecordImportErrorCode, message: string): never {
  throw new ImportFailure(code, message);
}

function toRecord(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid_value', `${path}はオブジェクトである必要があります。`);
  }
  return Object.fromEntries(Object.entries(value));
}

function exactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  path: string
): UnknownRecord {
  const object = toRecord(value, path);
  for (const key of required) {
    if (!Object.hasOwn(object, key)) {
      fail('missing_required', `${path}.${key}がありません。必須項目を確認してください。`);
    }
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      fail('invalid_value', `${path}にv1で定義されていない項目があります。`);
    }
  }
  return object;
}

function readArray(value: unknown, path: string, exactLength?: number): unknown[] {
  if (!Array.isArray(value)) {
    return fail('invalid_value', `${path}は配列である必要があります。`);
  }
  if (exactLength !== undefined && value.length !== exactLength) {
    fail('invalid_value', `${path}の要素数が正しくありません。`);
  }
  if (value.length > MAX_COLLECTION_ITEMS) {
    fail('invalid_value', `${path}の要素数が上限を超えています。`);
  }
  return value;
}

function readString(
  value: unknown,
  path: string,
  options: { nonEmpty?: boolean; maxLength?: number } = {}
): string {
  if (typeof value !== 'string') {
    return fail('invalid_value', `${path}は文字列である必要があります。`);
  }
  if (options.nonEmpty && value.trim().length === 0) {
    fail('invalid_value', `${path}は空文字列にできません。`);
  }
  if (value.length > (options.maxLength ?? MAX_SHORT_STRING_LENGTH)) {
    fail('invalid_value', `${path}が長すぎます。`);
  }
  return value;
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    return fail('invalid_value', `${path}は真偽値である必要があります。`);
  }
  return value;
}

function readInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return fail('invalid_value', `${path}の型または範囲が不正です。`);
  }
  return value;
}

function readOptionalString(object: UnknownRecord, key: string, path: string): string | undefined {
  return Object.hasOwn(object, key) ? readString(object[key], `${path}.${key}`) : undefined;
}

function requireKey(object: UnknownRecord, key: string, path: string): void {
  if (!Object.hasOwn(object, key)) {
    fail('missing_required', `${path}.${key}がありません。必須項目を確認してください。`);
  }
}

function readPlayer(value: unknown, path: string): SavedPlayerV1 {
  if (value === 'sente' || value === 'gote') return value;
  return fail('invalid_value', `${path}のプレイヤー値が不正です。`);
}

function readNullablePlayer(value: unknown, path: string): SavedPlayerV1 | null {
  return value === null ? null : readPlayer(value, path);
}

function readPieceType(value: unknown, path: string): SavedPieceTypeV1 {
  switch (value) {
    case 'king':
    case 'rook':
    case 'bishop':
    case 'gold':
    case 'silver':
    case 'knight':
    case 'lance':
    case 'pawn':
      return value;
    default:
      return fail('invalid_value', `${path}の駒種が不正です。`);
  }
}

function readNullablePieceType(value: unknown, path: string): SavedPieceTypeV1 | null {
  return value === null ? null : readPieceType(value, path);
}

function readStatus(value: unknown, path: string): SavedBoardStatusV1 {
  switch (value) {
    case 'preparation':
    case 'active':
    case 'check':
    case 'blunder':
    case 'evaluating':
    case 'ended':
      return value;
    default:
      return fail('invalid_value', `${path}の盤面状態が不正です。`);
  }
}

function readPromotion(value: unknown, path: string): SavedMovePromotionV1 {
  if (value === 'none' || value === 'promote' || value === 'decline') return value;
  return fail('invalid_value', `${path}の成り状態が不正です。`);
}

function readIllegalMoveReason(value: unknown, path: string): SavedIllegalMoveReasonV1 {
  switch (value) {
    case 'out_of_bounds':
    case 'no_piece_at_source':
    case 'not_current_turn':
    case 'not_own_piece':
    case 'invalid_piece_move':
    case 'occupied_by_own_piece':
    case 'captured_king':
    case 'dead_piece':
    case 'promotion_choice_required':
    case 'invalid_promotion':
    case 'promotion_required':
    case 'king_suicide':
    case 'self_check_unresolved':
    case 'hand_piece_not_found':
    case 'not_own_hand_piece':
    case 'occupied_drop_square':
    case 'undroppable_piece':
    case 'invalid_hand_piece_state':
    case 'dead_piece_drop':
    case 'nifu':
    case 'pawn_drop_mate':
    case 'game_already_ended':
      return value;
    default:
      return fail('invalid_value', `${path}の反則理由が不正です。`);
  }
}

function readProposer(value: unknown, path: string): SavedProposerTypeV1 {
  if (value === 'human' || value === 'local_ai' || value === 'shogi_engine') return value;
  return fail('invalid_value', `${path}の提案者が不正です。`);
}

function readBoardCoordinate(value: unknown, path: string): { row: number; col: number } {
  const object = exactKeys(value, ['row', 'col'], [], path);
  return {
    row: readInteger(object.row, `${path}.row`, 0, 8),
    col: readInteger(object.col, `${path}.col`, 0, 8),
  };
}

function readFoulProposalCoordinate(value: unknown, path: string): { row: number; col: number } {
  const object = exactKeys(value, ['row', 'col'], [], path);
  if (
    !isShogiGameRecordV1FoulCoordinateValue(object.row) ||
    !isShogiGameRecordV1FoulCoordinateValue(object.col)
  ) {
    return fail('invalid_value', `${path}のrowとcolは安全な整数である必要があります。`);
  }
  return { row: object.row, col: object.col };
}

function readPiece(value: unknown, path: string): SavedPieceV1 {
  const object = exactKeys(value, ['id', 'type', 'player', 'isPromoted'], [], path);
  return {
    id: readString(object.id, `${path}.id`, { nonEmpty: true, maxLength: 256 }),
    type: readPieceType(object.type, `${path}.type`),
    player: readPlayer(object.player, `${path}.player`),
    isPromoted: readBoolean(object.isPromoted, `${path}.isPromoted`),
  };
}

function readHand(value: unknown, player: SavedPlayerV1, path: string): SavedPieceV1[] {
  return readArray(value, path).map((item, index) => {
    const piece = readPiece(item, `${path}[${index}]`);
    if (piece.player !== player) {
      fail('invalid_value', `${path}の持ち駒所有者が一致しません。`);
    }
    if (piece.type === 'king') {
      fail('invalid_value', `${path}に玉を含めることはできません。`);
    }
    if (piece.isPromoted) {
      fail('invalid_value', `${path}に成った持ち駒を含めることはできません。`);
    }
    return piece;
  });
}

function readSquares(value: unknown, path: string): SavedSquareV1[][] {
  const rows = readArray(value, path, 9);
  const squares = rows.map((rowValue, row) =>
    readArray(rowValue, `${path}[${row}]`, 9).map((squareValue, col) => {
      const object = exactKeys(squareValue, ['row', 'col', 'piece'], [], `${path}[${row}][${col}]`);
      const savedRow = readInteger(object.row, `${path}[${row}][${col}].row`, 0, 8);
      const savedCol = readInteger(object.col, `${path}[${row}][${col}].col`, 0, 8);
      if (savedRow !== row || savedCol !== col) {
        fail('invalid_value', `${path}のマス座標と配列位置が一致しません。`);
      }
      return {
        row: savedRow,
        col: savedCol,
        piece: object.piece === null ? null : readPiece(object.piece, `${path}[${row}][${col}].piece`),
      };
    })
  );
  return squares;
}

function assertUniquePositionPieceIds(
  squares: readonly (readonly SavedSquareV1[])[],
  senteHand: readonly SavedPieceV1[],
  goteHand: readonly SavedPieceV1[],
  path: string
): void {
  const ids = new Set<string>();
  const pieces = [
    ...squares.flatMap((row) => row.flatMap((square) => (square.piece ? [square.piece] : []))),
    ...senteHand,
    ...goteHand,
  ];
  for (const piece of pieces) {
    if (ids.has(piece.id)) {
      fail('invalid_value', `${path}に重複した駒IDがあります。`);
    }
    ids.add(piece.id);
  }
}

function readMove(value: unknown, path: string): SavedMoveRecordV1 {
  const baseRequired = [
    'kind',
    'moveNumber',
    'player',
    'from',
    'to',
    'pieceType',
    'capturedPieceType',
    'promotion',
    'notation',
  ] as const;
  const probe = toRecord(value, path);
  requireKey(probe, 'kind', path);
  const kind = probe.kind;
  if (kind === 'move') {
    const object = exactKeys(value, baseRequired, [], path);
    return {
      kind: 'move',
      moveNumber: readInteger(object.moveNumber, `${path}.moveNumber`, 1, MAX_COLLECTION_ITEMS),
      player: readPlayer(object.player, `${path}.player`),
      from: readBoardCoordinate(object.from, `${path}.from`),
      to: readBoardCoordinate(object.to, `${path}.to`),
      pieceType: readPieceType(object.pieceType, `${path}.pieceType`),
      capturedPieceType: readNullablePieceType(object.capturedPieceType, `${path}.capturedPieceType`),
      promotion: readPromotion(object.promotion, `${path}.promotion`),
      notation: readString(object.notation, `${path}.notation`, { nonEmpty: true, maxLength: 256 }),
    };
  }
  if (kind === 'drop') {
    const object = exactKeys(value, [...baseRequired, 'pieceId'], [], path);
    if (object.from !== null || object.capturedPieceType !== null || object.promotion !== 'none') {
      fail('invalid_value', `${path}の駒打ちフィールドの組み合わせが不正です。`);
    }
    return {
      kind: 'drop',
      moveNumber: readInteger(object.moveNumber, `${path}.moveNumber`, 1, MAX_COLLECTION_ITEMS),
      player: readPlayer(object.player, `${path}.player`),
      from: null,
      to: readBoardCoordinate(object.to, `${path}.to`),
      pieceId: readString(object.pieceId, `${path}.pieceId`, { nonEmpty: true, maxLength: 256 }),
      pieceType: readPieceType(object.pieceType, `${path}.pieceType`),
      capturedPieceType: null,
      promotion: 'none',
      notation: readString(object.notation, `${path}.notation`, { nonEmpty: true, maxLength: 256 }),
    };
  }
  return fail('invalid_value', `${path}の着手種別が不正です。`);
}

function readMoves(value: unknown, path: string): SavedMoveRecordV1[] {
  return readArray(value, path).map((item, index) => readMove(item, `${path}[${index}]`));
}

function readFoul(value: unknown, path: string): SavedFoulRecordV1 {
  const common = [
    'kind',
    'moveNumber',
    'player',
    'from',
    'to',
    'pieceType',
    'reason',
    'message',
    'proposer',
  ] as const;
  const probe = toRecord(value, path);
  requireKey(probe, 'kind', path);
  const required = probe.kind === 'drop' ? [...common, 'pieceId'] : common;
  const object = exactKeys(value, required, ['engineName', 'timestamp'], path);
  const commonValues = {
    moveNumber: readInteger(object.moveNumber, `${path}.moveNumber`, 1, MAX_COLLECTION_ITEMS),
    player: readPlayer(object.player, `${path}.player`),
    to: readFoulProposalCoordinate(object.to, `${path}.to`),
    pieceType: readNullablePieceType(object.pieceType, `${path}.pieceType`),
    reason: readIllegalMoveReason(object.reason, `${path}.reason`),
    message: readString(object.message, `${path}.message`),
    proposer: readProposer(object.proposer, `${path}.proposer`),
  };
  const engineName = readOptionalString(object, 'engineName', path);
  const timestamp = Object.hasOwn(object, 'timestamp')
    ? readInteger(object.timestamp, `${path}.timestamp`, 0, Number.MAX_SAFE_INTEGER)
    : undefined;
  if (probe.kind === 'move') {
    const foul: SavedFoulRecordV1 = {
      kind: 'move',
      ...commonValues,
      from: readFoulProposalCoordinate(object.from, `${path}.from`),
    };
    if (engineName !== undefined) foul.engineName = engineName;
    if (timestamp !== undefined) foul.timestamp = timestamp;
    return foul;
  }
  if (probe.kind === 'drop') {
    if (object.from !== null) fail('invalid_value', `${path}.fromはnullである必要があります。`);
    const foul: SavedFoulRecordV1 = {
      kind: 'drop',
      ...commonValues,
      from: null,
      pieceId: readString(object.pieceId, `${path}.pieceId`, { nonEmpty: true, maxLength: 256 }),
    };
    if (engineName !== undefined) foul.engineName = engineName;
    if (timestamp !== undefined) foul.timestamp = timestamp;
    return foul;
  }
  return fail('invalid_value', `${path}の反則記録種別が不正です。`);
}

function readFouls(value: unknown, path: string): SavedFoulRecordV1[] {
  return readArray(value, path).map((item, index) => readFoul(item, `${path}[${index}]`));
}

function attachDetails<T extends SavedGameResultV1>(result: T, details: string | undefined): T {
  if (details !== undefined) result.details = details;
  return result;
}

function readResult(value: unknown, path: string): SavedGameResultV1 | null {
  if (value === null) return null;
  const probe = toRecord(value, path);
  requireKey(probe, 'endReason', path);
  const endReason = readString(probe.endReason, `${path}.endReason`);
  const detailsProbe = readOptionalString(probe, 'details', path);
  const decisive = (winnerValue: unknown, loserValue: unknown) => {
    const winner = readPlayer(winnerValue, `${path}.winner`);
    const loser = readPlayer(loserValue, `${path}.loser`);
    if (winner === loser) fail('invalid_value', `${path}の勝者と敗者が同一です。`);
    return { winner, loser };
  };
  switch (endReason) {
    case 'foul_loss': {
      const object = exactKeys(value, ['winner', 'loser', 'endReason', 'foulReason'], ['details'], path);
      const players = decisive(object.winner, object.loser);
      const foulReason = object.foulReason === 'perpetual_check_repetition'
        ? 'perpetual_check_repetition'
        : readIllegalMoveReason(object.foulReason, `${path}.foulReason`);
      return attachDetails({ ...players, endReason: 'foul_loss', foulReason }, detailsProbe);
    }
    case 'checkmate':
    case 'resignation': {
      const object = exactKeys(value, ['winner', 'loser', 'endReason'], ['details'], path);
      const players = decisive(object.winner, object.loser);
      return endReason === 'checkmate'
        ? attachDetails({ ...players, endReason: 'checkmate' }, detailsProbe)
        : attachDetails({ ...players, endReason: 'resignation' }, detailsProbe);
    }
    case 'repetition':
    case 'five_hundred_move_jishogi':
    case 'entering_king_draw': {
      const object = exactKeys(value, ['winner', 'loser', 'endReason'], ['details'], path);
      if (object.winner !== null || object.loser !== null) {
        fail('invalid_value', `${path}の無勝負結果には勝者・敗者を指定できません。`);
      }
      if (endReason === 'repetition') {
        return attachDetails({ winner: null, loser: null, endReason: 'repetition' }, detailsProbe);
      }
      if (endReason === 'five_hundred_move_jishogi') {
        return attachDetails({ winner: null, loser: null, endReason: 'five_hundred_move_jishogi' }, detailsProbe);
      }
      return attachDetails({ winner: null, loser: null, endReason: 'entering_king_draw' }, detailsProbe);
    }
    case 'agreed_jishogi_draw': {
      const object = exactKeys(value, ['winner', 'loser', 'endReason', 'sentePoints', 'gotePoints'], ['details'], path);
      if (object.winner !== null || object.loser !== null) {
        fail('invalid_value', `${path}の無勝負結果には勝者・敗者を指定できません。`);
      }
      return attachDetails({
        winner: null,
        loser: null,
        endReason: 'agreed_jishogi_draw',
        sentePoints: readInteger(object.sentePoints, `${path}.sentePoints`, 0, 54),
        gotePoints: readInteger(object.gotePoints, `${path}.gotePoints`, 0, 54),
      }, detailsProbe);
    }
    case 'agreed_jishogi_point_loss': {
      const object = exactKeys(value, ['winner', 'loser', 'endReason', 'sentePoints', 'gotePoints'], ['details'], path);
      return attachDetails({
        ...decisive(object.winner, object.loser),
        endReason: 'agreed_jishogi_point_loss',
        sentePoints: readInteger(object.sentePoints, `${path}.sentePoints`, 0, 54),
        gotePoints: readInteger(object.gotePoints, `${path}.gotePoints`, 0, 54),
      }, detailsProbe);
    }
    case 'entering_king_win':
    case 'entering_king_declaration_failure': {
      const object = exactKeys(value, ['winner', 'loser', 'endReason'], ['details'], path);
      const players = decisive(object.winner, object.loser);
      return endReason === 'entering_king_win'
        ? attachDetails({ ...players, endReason: 'entering_king_win' }, detailsProbe)
        : attachDetails({ ...players, endReason: 'entering_king_declaration_failure' }, detailsProbe);
    }
    default:
      return fail('invalid_value', `${path}の終局理由が不正です。`);
  }
}

function readLatestState(value: unknown, path: string): SavedLatestStateV1 {
  const object = exactKeys(value, ['squares', 'senteHand', 'goteHand', 'turn', 'moveNumber', 'status'], [], path);
  const squares = readSquares(object.squares, `${path}.squares`);
  const senteHand = readHand(object.senteHand, 'sente', `${path}.senteHand`);
  const goteHand = readHand(object.goteHand, 'gote', `${path}.goteHand`);
  assertUniquePositionPieceIds(squares, senteHand, goteHand, path);
  return {
    squares,
    senteHand,
    goteHand,
    turn: readPlayer(object.turn, `${path}.turn`),
    moveNumber: readInteger(object.moveNumber, `${path}.moveNumber`, 1, MAX_COLLECTION_ITEMS),
    status: readStatus(object.status, `${path}.status`),
  };
}

function readPositionHistory(value: unknown, path: string): SavedPositionRecordV1[] {
  return readArray(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const object = exactKeys(item, ['key', 'historyIndex', 'movedBy', 'gaveCheck'], [], itemPath);
    return {
      key: readString(object.key, `${itemPath}.key`, { nonEmpty: true, maxLength: 100_000 }),
      historyIndex: readInteger(object.historyIndex, `${itemPath}.historyIndex`, 0, MAX_COLLECTION_ITEMS),
      movedBy: readNullablePlayer(object.movedBy, `${itemPath}.movedBy`),
      gaveCheck: readBoolean(object.gaveCheck, `${itemPath}.gaveCheck`),
    };
  });
}

function readSnapshot(value: unknown, path: string): SavedPositionSnapshotV1 {
  const object = exactKeys(
    value,
    ['historyIndex', 'squares', 'senteHand', 'goteHand', 'turn', 'moveNumber', 'status', 'lastMove', 'result'],
    [],
    path
  );
  const squares = readSquares(object.squares, `${path}.squares`);
  const senteHand = readHand(object.senteHand, 'sente', `${path}.senteHand`);
  const goteHand = readHand(object.goteHand, 'gote', `${path}.goteHand`);
  assertUniquePositionPieceIds(squares, senteHand, goteHand, path);
  return {
    historyIndex: readInteger(object.historyIndex, `${path}.historyIndex`, 0, MAX_COLLECTION_ITEMS),
    squares,
    senteHand,
    goteHand,
    turn: readPlayer(object.turn, `${path}.turn`),
    moveNumber: readInteger(object.moveNumber, `${path}.moveNumber`, 1, MAX_COLLECTION_ITEMS),
    status: readStatus(object.status, `${path}.status`),
    lastMove: object.lastMove === null ? null : readMove(object.lastMove, `${path}.lastMove`),
    result: readResult(object.result, `${path}.result`),
  };
}

function readMoveLimit(value: unknown, path: string): SavedMoveLimitJishogiStateV1 | null {
  if (value === null) return null;
  const object = exactKeys(value, ['kind', 'checkingPlayer'], [], path);
  if (object.kind !== 'awaiting_continuous_check_end') {
    fail('invalid_value', `${path}.kindの値が不正です。`);
  }
  return {
    kind: 'awaiting_continuous_check_end',
    checkingPlayer: readPlayer(object.checkingPlayer, `${path}.checkingPlayer`),
  };
}

function readTopLevel(value: unknown): ShogiGameRecordV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid_value', 'トップレベルはJSONオブジェクトである必要があります。');
  }
  const probe = toRecord(value, '$');
  if (!Object.hasOwn(probe, 'format')) {
    fail('missing_required', '$.formatがありません。必須項目を確認してください。');
  }
  if (probe.format !== SHOGI_GAME_RECORD_FORMAT) {
    fail('wrong_format', 'このファイルはshogi-app-game-record形式ではありません。');
  }
  if (!Object.hasOwn(probe, 'version')) {
    fail('missing_required', '$.versionがありません。必須項目を確認してください。');
  }
  if (typeof probe.version !== 'number' || !Number.isInteger(probe.version)) {
    fail('invalid_value', '$.versionの型または範囲が不正です。');
  }
  if (probe.version !== SHOGI_GAME_RECORD_VERSION) {
    fail('unsupported_version', `この対局記録のバージョン（${probe.version}）には対応していません。`);
  }
  const object = exactKeys(
    value,
    [
      'format',
      'version',
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
    ],
    [],
    '$'
  );
  const exportedAt = readString(object.exportedAt, '$.exportedAt', { nonEmpty: true, maxLength: 64 });
  if (
    !ISO_8601_UTC_PATTERN.test(exportedAt) ||
    Number.isNaN(Date.parse(exportedAt)) ||
    new Date(exportedAt).toISOString() !== exportedAt
  ) {
    fail('invalid_value', '$.exportedAtは有効なISO 8601 UTC日時である必要があります。');
  }
  if (object.initialPosition !== 'hirate') {
    fail('invalid_value', '$.initialPositionはhirateである必要があります。');
  }
  return {
    format: SHOGI_GAME_RECORD_FORMAT,
    version: SHOGI_GAME_RECORD_VERSION,
    exportedAt,
    initialPosition: 'hirate',
    latestState: readLatestState(object.latestState, '$.latestState'),
    history: readMoves(object.history, '$.history'),
    lastMove: object.lastMove === null ? null : readMove(object.lastMove, '$.lastMove'),
    result: readResult(object.result, '$.result'),
    foulHistory: readFouls(object.foulHistory, '$.foulHistory'),
    positionHistory: readPositionHistory(object.positionHistory, '$.positionHistory'),
    positionSnapshots: readArray(object.positionSnapshots, '$.positionSnapshots').map((item, index) =>
      readSnapshot(item, `$.positionSnapshots[${index}]`)
    ),
    moveLimitJishogi: readMoveLimit(object.moveLimitJishogi, '$.moveLimitJishogi'),
  };
}

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => same(item, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object'
  ) {
    return false;
  }
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  );
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  );
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, item], index) =>
        key === rightEntries[index][0] && same(item, rightEntries[index][1])
    )
  );
}

function toPiece(piece: SavedPieceV1): Piece {
  return { id: piece.id, type: piece.type, player: piece.player, isPromoted: piece.isPromoted };
}

function toSquares(squares: readonly (readonly SavedSquareV1[])[]): BoardSquare[][] {
  const template = createInitialBoardState().squares;
  return squares.map((row, rowIndex) =>
    row.map((square, colIndex) => ({
      row: square.row,
      col: square.col,
      file: template[rowIndex][colIndex].file,
      rank: template[rowIndex][colIndex].rank,
      rankKanji: template[rowIndex][colIndex].rankKanji,
      coordinateLabel: template[rowIndex][colIndex].coordinateLabel,
      piece: square.piece ? toPiece(square.piece) : null,
      hasBottomRightStarMarker: template[rowIndex][colIndex].hasBottomRightStarMarker,
    }))
  );
}

function toMove(move: SavedMoveRecordV1): MoveRecord {
  if (move.kind === 'move') {
    return {
      kind: 'move', moveNumber: move.moveNumber, player: move.player,
      from: { row: move.from.row, col: move.from.col },
      to: { row: move.to.row, col: move.to.col }, pieceType: move.pieceType,
      capturedPieceType: move.capturedPieceType, promotion: move.promotion, notation: move.notation,
    };
  }
  return {
    kind: 'drop', moveNumber: move.moveNumber, player: move.player, from: null,
    to: { row: move.to.row, col: move.to.col }, pieceId: move.pieceId,
    pieceType: move.pieceType, capturedPieceType: null, promotion: 'none', notation: move.notation,
  };
}

function toResult(result: SavedGameResultV1 | null): GameResult | null {
  if (result === null) return null;
  switch (result.endReason) {
    case 'foul_loss':
      return { winner: result.winner, loser: result.loser, endReason: 'foul_loss', foulReason: result.foulReason, ...(result.details === undefined ? {} : { details: result.details }) };
    case 'checkmate':
      return { winner: result.winner, loser: result.loser, endReason: 'checkmate', ...(result.details === undefined ? {} : { details: result.details }) };
    case 'resignation':
      return { winner: result.winner, loser: result.loser, endReason: 'resignation', ...(result.details === undefined ? {} : { details: result.details }) };
    case 'repetition':
      return { winner: null, loser: null, endReason: 'repetition', ...(result.details === undefined ? {} : { details: result.details }) };
    case 'five_hundred_move_jishogi':
      return { winner: null, loser: null, endReason: 'five_hundred_move_jishogi', ...(result.details === undefined ? {} : { details: result.details }) };
    case 'agreed_jishogi_draw':
      return { winner: null, loser: null, endReason: 'agreed_jishogi_draw', sentePoints: result.sentePoints, gotePoints: result.gotePoints, ...(result.details === undefined ? {} : { details: result.details }) };
    case 'agreed_jishogi_point_loss':
      return { winner: result.winner, loser: result.loser, endReason: 'agreed_jishogi_point_loss', sentePoints: result.sentePoints, gotePoints: result.gotePoints, ...(result.details === undefined ? {} : { details: result.details }) };
    case 'entering_king_win':
      return { winner: result.winner, loser: result.loser, endReason: 'entering_king_win', ...(result.details === undefined ? {} : { details: result.details }) };
    case 'entering_king_draw':
      return { winner: null, loser: null, endReason: 'entering_king_draw', ...(result.details === undefined ? {} : { details: result.details }) };
    case 'entering_king_declaration_failure':
      return { winner: result.winner, loser: result.loser, endReason: 'entering_king_declaration_failure', ...(result.details === undefined ? {} : { details: result.details }) };
  }
}

function toFoul(foul: SavedFoulRecordV1): FoulRecord {
  const common = {
    moveNumber: foul.moveNumber, player: foul.player, to: { row: foul.to.row, col: foul.to.col },
    pieceType: foul.pieceType, reason: foul.reason, message: foul.message, proposer: foul.proposer,
  };
  if (foul.kind === 'move') {
    return { kind: 'move', ...common, from: { row: foul.from.row, col: foul.from.col }, ...(foul.engineName === undefined ? {} : { engineName: foul.engineName }), ...(foul.timestamp === undefined ? {} : { timestamp: foul.timestamp }) };
  }
  return { kind: 'drop', ...common, from: null, pieceId: foul.pieceId, ...(foul.engineName === undefined ? {} : { engineName: foul.engineName }), ...(foul.timestamp === undefined ? {} : { timestamp: foul.timestamp }) };
}

function toPositionRecord(position: SavedPositionRecordV1): PositionRecord {
  return { key: position.key, historyIndex: position.historyIndex, movedBy: position.movedBy, gaveCheck: position.gaveCheck };
}

function toSnapshot(snapshot: SavedPositionSnapshotV1): PositionSnapshot {
  return {
    historyIndex: snapshot.historyIndex,
    squares: toSquares(snapshot.squares),
    senteHand: snapshot.senteHand.map(toPiece),
    goteHand: snapshot.goteHand.map(toPiece),
    turn: snapshot.turn,
    moveNumber: snapshot.moveNumber,
    status: snapshot.status,
    lastMove: snapshot.lastMove ? toMove(snapshot.lastMove) : null,
    result: toResult(snapshot.result),
  };
}

function validateFouls(fouls: readonly SavedFoulRecordV1[], latestMoveNumber: number): void {
  for (const foul of fouls) {
    if (foul.moveNumber > latestMoveNumber) {
      fail('inconsistent_record', '反則履歴と現在の手数が不整合です。');
    }
    const expectedPlayer: SavedPlayerV1 = foul.moveNumber % 2 === 1 ? 'sente' : 'gote';
    if (foul.player !== expectedPlayer) {
      fail('inconsistent_record', '反則履歴の手番が棋譜と不整合です。');
    }
  }
}

function validateFoulHistorySemantics(
  savedResult: SavedGameResultV1 | null,
  fouls: readonly SavedFoulRecordV1[],
  isNonMoveEnding: boolean
): void {
  if (savedResult?.endReason !== 'foul_loss') {
    if (fouls.length !== 0) {
      fail('inconsistent_record', '反則負けではない対局に反則履歴が含まれています。');
    }
    return;
  }

  // 連続王手の千日手は着手の再実行中に判定され、既存ドメインはfoulHistoryを追加しない。
  if (savedResult.foulReason === 'perpetual_check_repetition') {
    if (fouls.length !== 0) {
      fail('inconsistent_record', '連続王手の千日手結果に終端反則履歴を含めることはできません。');
    }
    return;
  }

  // strict方式は最初の不正提案で即時終局するため、新規対局から生成可能なのは終端反則1件だけ。
  if (!isNonMoveEnding || fouls.length !== 1) {
    fail('inconsistent_record', 'strict方式の反則負けには終端反則履歴が1件必要です。');
  }
}

function validateNonMoveResult(
  saved: SavedGameResultV1,
  replayed: BoardState,
  fouls: readonly SavedFoulRecordV1[]
): void {
  const expectedOpponent: SavedPlayerV1 = replayed.turn === 'sente' ? 'gote' : 'sente';
  if (saved.endReason === 'resignation') {
    const execution = executeResignation(replayed);
    if (execution.type !== 'applied' || !same(createShogiGameRecordV1(execution.state, new Date(0)).result, saved)) {
      fail('inconsistent_record', '投了結果と終局直前の局面が不整合です。');
    }
    return;
  }
  if (saved.endReason === 'foul_loss') {
    if (saved.foulReason === 'perpetual_check_repetition') {
      fail('inconsistent_record', '連続王手の千日手結果を棋譜から再現できません。');
    }
    if (fouls.length !== 1) {
      fail('inconsistent_record', 'strict方式の反則負けには終端反則履歴が1件必要です。');
    }
    const lastFoul = fouls[0];
    if (
      saved.loser !== replayed.turn || saved.winner !== expectedOpponent || !lastFoul ||
      lastFoul.moveNumber !== replayed.moveNumber || lastFoul.player !== replayed.turn ||
      lastFoul.reason !== saved.foulReason
    ) {
      fail('inconsistent_record', '反則負け結果と反則履歴が不整合です。');
    }
    const execution = lastFoul.kind === 'move'
      ? executeMove(replayed, lastFoul.from, lastFoul.to, {
          mode: 'strict',
          proposer: lastFoul.proposer,
          engineName: lastFoul.engineName,
        })
      : executeDrop(replayed, lastFoul.pieceId, lastFoul.to, {
          mode: 'strict',
          proposer: lastFoul.proposer,
          engineName: lastFoul.engineName,
        });
    if (execution.type !== 'foul_loss') {
      fail('inconsistent_record', '反則履歴の提案は保存局面では反則になりません。');
    }
    const reproducedFoul = execution.foul;
    const commonFoulMatches =
      reproducedFoul.kind === lastFoul.kind &&
      reproducedFoul.moveNumber === lastFoul.moveNumber &&
      reproducedFoul.player === lastFoul.player &&
      same(reproducedFoul.to, lastFoul.to) &&
      reproducedFoul.pieceType === lastFoul.pieceType &&
      reproducedFoul.reason === lastFoul.reason &&
      reproducedFoul.message === lastFoul.message &&
      reproducedFoul.proposer === lastFoul.proposer &&
      reproducedFoul.engineName === lastFoul.engineName;
    const kindSpecificFoulMatches =
      reproducedFoul.kind === 'move' && lastFoul.kind === 'move'
        ? same(reproducedFoul.from, lastFoul.from)
        : reproducedFoul.kind === 'drop' && lastFoul.kind === 'drop'
          ? reproducedFoul.from === null && reproducedFoul.pieceId === lastFoul.pieceId
          : false;
    if (
      !commonFoulMatches ||
      !kindSpecificFoulMatches ||
      !same(createShogiGameRecordV1(execution.state, new Date(0)).result, saved)
    ) {
      fail('inconsistent_record', '反則負け結果を反則提案から再現できません。');
    }
    return;
  }
  if (saved.endReason === 'agreed_jishogi_draw' || saved.endReason === 'agreed_jishogi_point_loss') {
    const evaluation = evaluateAgreedJishogi(replayed);
    const pointsMatch = saved.sentePoints === evaluation.sentePoints && saved.gotePoints === evaluation.gotePoints;
    const outcomeMatches = saved.endReason === 'agreed_jishogi_draw'
      ? evaluation.outcome.kind === 'draw'
      : evaluation.outcome.kind === 'point_loss' && evaluation.outcome.winner === saved.winner && evaluation.outcome.loser === saved.loser;
    if (!evaluation.canPropose || !pointsMatch || !outcomeMatches) {
      fail('inconsistent_record', '合意持将棋の結果と局面が不整合です。');
    }
    return;
  }
  if (
    saved.endReason === 'entering_king_win' ||
    saved.endReason === 'entering_king_draw' ||
    saved.endReason === 'entering_king_declaration_failure'
  ) {
    const execution = executeEnteringKingDeclaration(replayed, { mode: 'strict', proposer: 'shogi_engine' });
    if (execution.type === 'rejected' || !same(createShogiGameRecordV1(execution.state, new Date(0)).result, saved)) {
      fail('inconsistent_record', '入玉宣言結果と局面が不整合です。');
    }
    return;
  }
  fail('inconsistent_record', '着手外の終局結果を局面から確認できません。');
}

function replayAndRestore(record: ShogiGameRecordV1): BoardState {
  if (record.history.length + 1 !== record.latestState.moveNumber) {
    fail('inconsistent_record', '棋譜の手数と現在の手数が不整合です。');
  }
  const expectedTurn: SavedPlayerV1 = record.history.length % 2 === 0 ? 'sente' : 'gote';
  if (record.latestState.turn !== expectedTurn) {
    fail('inconsistent_record', '棋譜の順序と現在の手番が不整合です。');
  }
  const expectedLastMove = record.history.at(-1) ?? null;
  if (!same(record.lastMove, expectedLastMove)) {
    fail('inconsistent_record', 'lastMoveと棋譜末尾が不整合です。');
  }
  validateFouls(record.foulHistory, record.latestState.moveNumber);

  let replayed = createInitialBoardState();
  for (let index = 0; index < record.history.length; index += 1) {
    const savedMove = record.history[index];
    const moveNumber = index + 1;
    const player: SavedPlayerV1 = moveNumber % 2 === 1 ? 'sente' : 'gote';
    if (savedMove.moveNumber !== moveNumber || savedMove.player !== player) {
      fail('inconsistent_record', '棋譜の手数または手番の順序が不整合です。');
    }
    if (replayed.status === 'ended') {
      fail('inconsistent_record', '終局後の着手が棋譜に含まれています。');
    }
    if (savedMove.kind === 'move') {
      const source = replayed.squares[savedMove.from.row][savedMove.from.col].piece;
      if (!source || source.type !== savedMove.pieceType || source.player !== savedMove.player) {
        fail('inconsistent_record', '棋譜の移動元の駒が局面と一致しません。');
      }
      const promotion = savedMove.promotion === 'none' ? undefined : savedMove.promotion;
      const execution = executeMove(replayed, savedMove.from, savedMove.to, {
        mode: 'assist', proposer: 'human', promotion,
      });
      if (execution.type !== 'applied' || !same(execution.move, savedMove)) {
        fail('inconsistent_record', '違法手または改ざんされた棋譜表記が含まれています。');
      }
      replayed = execution.state;
    } else {
      const hand = replayed.turn === 'sente' ? replayed.senteHand : replayed.goteHand;
      const piece = hand.find((candidate) => candidate.id === savedMove.pieceId);
      if (!piece || piece.type !== savedMove.pieceType || piece.player !== savedMove.player) {
        fail('inconsistent_record', '棋譜の駒打ち対象が持ち駒と一致しません。');
      }
      const execution = executeDrop(replayed, savedMove.pieceId, savedMove.to, { mode: 'assist', proposer: 'human' });
      if (execution.type !== 'applied' || !same(execution.move, savedMove)) {
        fail('inconsistent_record', '違法な駒打ちまたは改ざんされた棋譜表記が含まれています。');
      }
      replayed = execution.state;
    }
  }

  const replayRecord = createShogiGameRecordV1(replayed, new Date(record.exportedAt));
  const savedPosition = {
    squares: record.latestState.squares,
    senteHand: record.latestState.senteHand,
    goteHand: record.latestState.goteHand,
    turn: record.latestState.turn,
    moveNumber: record.latestState.moveNumber,
  };
  const replayPosition = {
    squares: replayRecord.latestState.squares,
    senteHand: replayRecord.latestState.senteHand,
    goteHand: replayRecord.latestState.goteHand,
    turn: replayRecord.latestState.turn,
    moveNumber: replayRecord.latestState.moveNumber,
  };
  if (!same(savedPosition, replayPosition)) {
    fail('inconsistent_record', '保存された最新局面と棋譜から再現した局面が不整合です。');
  }
  if (!same(record.history, replayRecord.history) || !same(record.lastMove, replayRecord.lastMove)) {
    fail('inconsistent_record', '棋譜と直前手が再計算結果と不整合です。');
  }
  if (!same(record.positionHistory, replayRecord.positionHistory)) {
    fail('inconsistent_record', '千日手判定用の局面履歴が棋譜と不整合です。');
  }
  if (!same(record.positionSnapshots, replayRecord.positionSnapshots)) {
    fail('inconsistent_record', '局面再生スナップショットが棋譜と不整合です。');
  }

  const statusAndResultMatch =
    record.latestState.status === replayRecord.latestState.status && same(record.result, replayRecord.result);
  const isNonMoveEnding =
    replayed.status !== 'ended' && record.latestState.status === 'ended' && record.result !== null;
  if (!statusAndResultMatch && !isNonMoveEnding) {
    fail('inconsistent_record', '対局状態と終局結果が棋譜と不整合です。');
  }
  if (record.latestState.status === 'ended' !== (record.result !== null)) {
    fail('inconsistent_record', '終局状態とresultの有無が不整合です。');
  }
  validateFoulHistorySemantics(record.result, record.foulHistory, isNonMoveEnding);
  if (isNonMoveEnding && record.result) validateNonMoveResult(record.result, replayed, record.foulHistory);
  const expectedMoveLimit = isNonMoveEnding ? null : replayRecord.moveLimitJishogi;
  if (!same(record.moveLimitJishogi, expectedMoveLimit)) {
    fail('inconsistent_record', '500手持将棋の待機状態が棋譜と不整合です。');
  }

  const restored: BoardState = {
    squares: toSquares(record.latestState.squares),
    senteHand: record.latestState.senteHand.map(toPiece),
    goteHand: record.latestState.goteHand.map(toPiece),
    turn: record.latestState.turn,
    moveNumber: record.latestState.moveNumber,
    status: record.latestState.status,
    viewMode: 'research',
    history: record.history.map(toMove),
    lastMove: record.lastMove ? toMove(record.lastMove) : null,
    result: toResult(record.result),
    foulHistory: record.foulHistory.map(toFoul),
    positionHistory: record.positionHistory.map(toPositionRecord),
    positionSnapshots: record.positionSnapshots.map(toSnapshot),
    moveLimitJishogi: record.moveLimitJishogi
      ? { kind: 'awaiting_continuous_check_end', checkingPlayer: record.moveLimitJishogi.checkingPlayer }
      : null,
  };
  const roundTripped = createShogiGameRecordV1(restored, new Date(record.exportedAt));
  if (!same(roundTripped, record)) {
    fail('inconsistent_record', '復元した対局状態が保存内容と一致しません。');
  }
  return restored;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Parses, validates, replays, and independently restores one v1 game record. */
export function importShogiGameRecord(json: string): ShogiGameRecordImportResult {
  if (
    json.length > MAX_SHOGI_GAME_RECORD_FILE_BYTES ||
    utf8ByteLength(json) > MAX_SHOGI_GAME_RECORD_FILE_BYTES
  ) {
    return { ok: false, code: 'file_too_large', message: '対局記録ファイルが大きすぎます（上限32 MiB）。' };
  }
  if (json.trim().length === 0) {
    return { ok: false, code: 'invalid_json', message: 'ファイルが空です。JSONの対局記録を選択してください。' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, code: 'invalid_json', message: 'JSONとして読み取れない対局記録です。' };
  }
  try {
    const record = readTopLevel(parsed);
    const state = replayAndRestore(record);
    return {
      ok: true,
      state,
      metadata: {
        exportedAt: record.exportedAt,
        moveCount: record.history.length,
        isEnded: record.latestState.status === 'ended',
      },
    };
  } catch (error) {
    if (error instanceof ImportFailure) {
      return { ok: false, code: error.code, message: error.message };
    }
    return { ok: false, code: 'invalid_value', message: '対局記録の値を安全に検証できませんでした。' };
  }
}
