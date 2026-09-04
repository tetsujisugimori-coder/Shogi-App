import type { BoardState } from '../../types/shogi';
import {
  createShogiGameRecordV1,
  SHOGI_GAME_RECORD_FORMAT,
  type ShogiGameRecordV1,
} from './gameRecord';
import {
  importShogiGameRecord,
  MAX_SHOGI_GAME_RECORD_FILE_BYTES,
  type ShogiGameRecordImportErrorCode,
  type ShogiGameRecordImportResult,
} from './gameRecordImport';
import {
  cloneGameRecordSession,
  cloneSelection,
  createGameRecordSession,
  type GameRecordSession,
  type GameRecordSessionBranch,
} from './branchSession';
import { cloneBoardState } from './replay';

/** A distinct envelope prevents a research session from being mistaken for a v1 game record. */
export const SHOGI_GAME_RECORD_SESSION_FORMAT = 'shogi-app-game-record-session' as const;
export const SHOGI_GAME_RECORD_SESSION_VERSION = 1 as const;
export const MAX_SHOGI_GAME_RECORD_SESSION_FILE_BYTES = 128 * 1024 * 1024;

export interface ShogiGameRecordSessionV1Branch {
  originHistoryIndex: number;
  originSequence: number;
  displayName: string;
  record: ShogiGameRecordV1;
}

export interface ShogiGameRecordSessionV1 {
  format: typeof SHOGI_GAME_RECORD_SESSION_FORMAT;
  version: typeof SHOGI_GAME_RECORD_SESSION_VERSION;
  exportedAt: string;
  mainline: ShogiGameRecordV1;
  branches: ShogiGameRecordSessionV1Branch[];
  selectedRecordId: string;
}

export type ShogiGameRecordSessionImportResult =
  | {
      ok: true;
      session: GameRecordSession;
      state: BoardState;
      metadata: {
        exportedAt: string;
        moveCount: number;
        isEnded: boolean;
        branchCount: number;
        isLegacyGameRecord: boolean;
      };
    }
  | { ok: false; code: ShogiGameRecordImportErrorCode; message: string };

class SessionImportFailure extends Error {
  constructor(
    readonly code: ShogiGameRecordImportErrorCode,
    message: string
  ) {
    super(message);
  }
}

type UnknownRecord = { [key: string]: unknown };

function fail(code: ShogiGameRecordImportErrorCode, message: string): never {
  throw new SessionImportFailure(code, message);
}

function toRecord(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid_value', `${path}はオブジェクトである必要があります。`);
  }
  return Object.fromEntries(Object.entries(value));
}

function exactKeys(value: unknown, required: readonly string[], optional: readonly string[], path: string): UnknownRecord {
  const object = toRecord(value, path);
  for (const key of required) {
    if (!Object.hasOwn(object, key)) fail('missing_required', `${path}.${key}がありません。必須項目を確認してください。`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail('invalid_value', `${path}にセッション形式で定義されていない項目があります。`);
  }
  return object;
}

function readString(value: unknown, path: string, maxLength = 10_000): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    fail('invalid_value', `${path}は空でない文字列である必要があります。`);
  }
  return value;
}

function readInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail('invalid_value', `${path}は${minimum}から${maximum}までの安全な整数である必要があります。`);
  }
  return value;
}

function readExportedAt(value: unknown): string {
  const exportedAt = readString(value, '$.exportedAt', 64);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(exportedAt) ||
    Number.isNaN(Date.parse(exportedAt)) ||
    new Date(exportedAt).toISOString() !== exportedAt
  ) {
    fail('invalid_value', '$.exportedAtは有効なISO 8601 UTC日時である必要があります。');
  }
  return exportedAt;
}

function importEmbeddedRecord(value: unknown, path: string): BoardState {
  const object = toRecord(value, path);
  // v1 accepts omitted recordId for historical compatibility. Session members need
  // explicit IDs because cross-record references and selection depend on them.
  if (!Object.hasOwn(object, 'recordId')) fail('missing_required', `${path}.recordIdがありません。`);
  const result = importShogiGameRecord(JSON.stringify(object));
  if (!result.ok) fail(result.code, `${path}: ${result.message}`);
  return cloneBoardState(result.state);
}

function sameMovePrefix(mainline: BoardState, branch: BoardState, ply: number): boolean {
  return JSON.stringify(mainline.history.slice(0, ply)) === JSON.stringify(branch.history.slice(0, ply));
}

function assertSessionRelationships(session: GameRecordSession): void {
  const mainlineRecordId = session.mainline.recordId;
  if (!mainlineRecordId || mainlineRecordId.trim().length === 0) {
    fail('invalid_value', '$.mainline.recordIdは空でない文字列である必要があります。');
  }
  if (session.mainline.branchFrom) {
    fail('inconsistent_record', '$.mainlineは分岐元を持てません。入れ子分岐は未対応です。');
  }

  const recordIds = new Set<string>([mainlineRecordId]);
  const sequences = new Set<string>();
  for (const branch of session.branches) {
    const branchRecordId = branch.state.recordId;
    if (!branchRecordId || branchRecordId.trim().length === 0 || recordIds.has(branchRecordId)) {
      fail('inconsistent_record', 'recordIdが重複しているか、分岐のrecordIdがありません。');
    }
    recordIds.add(branchRecordId);
    if (
      !Number.isSafeInteger(branch.originHistoryIndex) ||
      !Number.isSafeInteger(branch.originSequence) ||
      branch.originSequence < 1 ||
      typeof branch.displayName !== 'string' ||
      branch.displayName.trim().length === 0 ||
      branch.displayName.length > 256
    ) {
      fail('invalid_value', '分岐の手数・連番・表示名が不正です。');
    }
    if (!branch.state.branchFrom) {
      fail('inconsistent_record', '分岐にbranchFromがありません。');
    }
    if (branch.state.branchFrom.recordId !== mainlineRecordId) {
      fail('inconsistent_record', '分岐元recordIdは本譜のrecordIdと一致する必要があります。入れ子分岐は未対応です。');
    }
    if (branch.state.branchFrom.ply !== branch.originHistoryIndex) {
      fail('inconsistent_record', 'branchFrom.plyと分岐元手数が一致しません。');
    }
    if (
      branch.originHistoryIndex < 0 ||
      branch.originHistoryIndex >= session.mainline.history.length ||
      branch.state.history.length < branch.originHistoryIndex ||
      !sameMovePrefix(session.mainline, branch.state, branch.originHistoryIndex)
    ) {
      fail('inconsistent_record', '分岐元局面が本譜と一致しません。');
    }
    const sequenceKey = `${branch.originHistoryIndex}:${branch.originSequence}`;
    if (sequences.has(sequenceKey)) fail('inconsistent_record', '同じ分岐元に分岐連番の重複があります。');
    sequences.add(sequenceKey);
  }
}

/** Creates the JSON-safe, versioned envelope for a whole research session. */
export function createShogiGameRecordSessionV1(
  session: GameRecordSession,
  exportedAt: Date
): ShogiGameRecordSessionV1 {
  const snapshot = cloneGameRecordSession(session);
  assertSessionRelationships(snapshot);
  const mainlineRecordId = snapshot.mainline.recordId!;
  const selectedRecordId =
    snapshot.selection.kind === 'mainline' ? mainlineRecordId : snapshot.selection.recordId;
  const knownRecordIds = new Set([
    mainlineRecordId,
    ...snapshot.branches.map((branch) => branch.state.recordId),
  ]);
  if (!knownRecordIds.has(selectedRecordId)) {
    throw new TypeError('選択中のrecordIdがセッションに存在しません。');
  }
  return {
    format: SHOGI_GAME_RECORD_SESSION_FORMAT,
    version: SHOGI_GAME_RECORD_SESSION_VERSION,
    exportedAt: exportedAt.toISOString(),
    mainline: createShogiGameRecordV1(snapshot.mainline, exportedAt),
    branches: snapshot.branches.map((branch) => ({
      originHistoryIndex: branch.originHistoryIndex,
      originSequence: branch.originSequence,
      displayName: branch.displayName,
      record: createShogiGameRecordV1(branch.state, exportedAt),
    })),
    selectedRecordId,
  };
}

export function serializeShogiGameRecordSessionV1(session: GameRecordSession, exportedAt: Date): string {
  return `${JSON.stringify(createShogiGameRecordSessionV1(session, exportedAt), null, 2)}\n`;
}

function importSession(value: unknown): ShogiGameRecordSessionImportResult {
  try {
    const object = exactKeys(
      value,
      ['format', 'version', 'exportedAt', 'mainline', 'branches', 'selectedRecordId'],
      [],
      '$'
    );
    if (object.format !== SHOGI_GAME_RECORD_SESSION_FORMAT) {
      fail('wrong_format', 'このファイルはshogi-app研究セッション形式ではありません。');
    }
    if (!Number.isInteger(object.version)) fail('invalid_value', '$.versionの型または範囲が不正です。');
    if (object.version !== SHOGI_GAME_RECORD_SESSION_VERSION) {
      fail('unsupported_version', `この研究セッションのバージョン（${String(object.version)}）には対応していません。`);
    }
    const exportedAt = readExportedAt(object.exportedAt);
    const mainline = importEmbeddedRecord(object.mainline, '$.mainline');
    if (!Array.isArray(object.branches) || object.branches.length > 10_000) {
      fail('invalid_value', '$.branchesは10,000件以下の配列である必要があります。');
    }
    const branches: GameRecordSessionBranch[] = object.branches.map((item, index) => {
      const branch = exactKeys(item, ['originHistoryIndex', 'originSequence', 'displayName', 'record'], [], `$.branches[${index}]`);
      return {
        originHistoryIndex: readInteger(branch.originHistoryIndex, `$.branches[${index}].originHistoryIndex`, 0, 10_000),
        originSequence: readInteger(branch.originSequence, `$.branches[${index}].originSequence`, 1, 10_000),
        displayName: readString(branch.displayName, `$.branches[${index}].displayName`, 256),
        state: importEmbeddedRecord(branch.record, `$.branches[${index}].record`),
      };
    });
    const selectedRecordId = readString(object.selectedRecordId, '$.selectedRecordId', 256);
    const mainlineRecordId = mainline.recordId;
    if (!mainlineRecordId) fail('missing_required', '$.mainline.recordIdがありません。');
    const selection = selectedRecordId === mainlineRecordId
      ? { kind: 'mainline' as const }
      : { kind: 'branch' as const, recordId: selectedRecordId };
    const session = { mainline, branches, selection } satisfies GameRecordSession;
    assertSessionRelationships(session);
    if (selection.kind === 'branch' && !branches.some((branch) => branch.state.recordId === selection.recordId)) {
      fail('inconsistent_record', 'selectedRecordIdがセッション内の棋譜を指していません。');
    }
    const selectedState = selection.kind === 'mainline'
      ? cloneBoardState(session.mainline)
      : cloneBoardState(session.branches.find((branch) => branch.state.recordId === selection.recordId)!.state);
    return {
      ok: true,
      session: cloneGameRecordSession(session),
      state: selectedState,
      metadata: {
        exportedAt,
        moveCount: selectedState.history.length,
        isEnded: selectedState.status === 'ended',
        branchCount: branches.length,
        isLegacyGameRecord: false,
      },
    };
  } catch (error) {
    if (error instanceof SessionImportFailure) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: 'invalid_value', message: '研究セッションの値を安全に検証できませんでした。' };
  }
}

/**
 * Reads either the distinct session envelope or an existing v1 single-game
 * record. A legacy record becomes a new mainline-only session.
 */
export function importShogiGameRecordSession(json: string): ShogiGameRecordSessionImportResult {
  if (
    json.length > MAX_SHOGI_GAME_RECORD_SESSION_FILE_BYTES ||
    new TextEncoder().encode(json).byteLength > MAX_SHOGI_GAME_RECORD_SESSION_FILE_BYTES
  ) {
    return { ok: false, code: 'file_too_large', message: '研究セッションファイルが大きすぎます（上限128 MiB）。' };
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
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) &&
    Object.hasOwn(parsed, 'format') && (parsed as UnknownRecord).format === SHOGI_GAME_RECORD_SESSION_FORMAT) {
    return importSession(parsed);
  }
  const legacy = importShogiGameRecord(json);
  if (!legacy.ok) return legacy;
  const session = createGameRecordSession(legacy.state);
  return {
    ok: true,
    session,
    state: cloneBoardState(session.mainline),
    metadata: {
      ...legacy.metadata,
      branchCount: 0,
      isLegacyGameRecord: true,
    },
  };
}

/** Exposed for UI code that needs an independent current state after restore. */
export function getSelectedGameRecordSessionState(session: GameRecordSession): BoardState {
  const selection = cloneSelection(session.selection);
  if (selection.kind === 'mainline') return cloneBoardState(session.mainline);
  const branch = session.branches.find((item) => item.state.recordId === selection.recordId);
  if (!branch) throw new TypeError('選択中のrecordIdがセッションに存在しません。');
  return cloneBoardState(branch.state);
}

export { MAX_SHOGI_GAME_RECORD_FILE_BYTES };
