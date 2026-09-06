import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createShogiGameRecordSessionV1,
  createShogiGameRecordV1,
  importShogiGameRecordSession,
  serializeShogiGameRecordSessionV1,
  SHOGI_GAME_RECORD_FORMAT,
  SHOGI_GAME_RECORD_SESSION_FORMAT,
  SHOGI_GAME_RECORD_SESSION_VERSION,
  SHOGI_GAME_RECORD_VERSION,
  type ShogiGameRecordSessionV1,
} from '../domain/shogi';
import {
  createEndedSessionFixture,
  createMainlineOnlySessionFixture,
  createSingleBranchSessionFixture,
} from './fixtures/game-record-session/sessionFixtures';

const EXPORTED_AT = new Date('2026-09-07T00:00:00.000Z');
const STATIC_MAINLINE_FIXTURE_PATH = resolve(
  process.cwd(),
  'src/test/fixtures/game-record-session/mainline-only-v1.json'
);

function normalizeExchangeJson(value: ShogiGameRecordSessionV1): Omit<ShogiGameRecordSessionV1, 'exportedAt'> {
  const { exportedAt: _exportedAt, ...stable } = value;
  return stable;
}

function assertSessionContract(value: ShogiGameRecordSessionV1): void {
  expect(value.format).toBe(SHOGI_GAME_RECORD_SESSION_FORMAT);
  expect(value.version).toBe(SHOGI_GAME_RECORD_SESSION_VERSION);
  expect(value).toEqual(expect.objectContaining({
    format: SHOGI_GAME_RECORD_SESSION_FORMAT,
    version: 1,
    exportedAt: expect.any(String),
    mainline: expect.any(Object),
    branches: expect.any(Array),
    selectedRecordId: expect.any(String),
  }));
  expect(value.mainline.format).toBe(SHOGI_GAME_RECORD_FORMAT);
  expect(value.mainline.version).toBe(SHOGI_GAME_RECORD_VERSION);
  expect(value.mainline.recordId).not.toHaveLength(0);

  const recordIds = new Set([value.mainline.recordId, ...value.branches.map((branch) => branch.record.recordId)]);
  expect(recordIds).toContain(value.selectedRecordId);
  for (const branch of value.branches) {
    expect(branch).toEqual(expect.objectContaining({
      originHistoryIndex: expect.any(Number),
      originSequence: expect.any(Number),
      displayName: expect.any(String),
      record: expect.any(Object),
    }));
    expect(branch.record.branchFrom).toEqual({
      recordId: value.mainline.recordId,
      ply: branch.originHistoryIndex,
    });
  }
}

describe('Shogi-App JSON Exchange Format v1', () => {
  it.each([
    ['本譜のみ', createMainlineOnlySessionFixture],
    ['分岐1件', createSingleBranchSessionFixture],
    ['終局済み', createEndedSessionFixture],
  ])('%s fixtureはセッションv1の外部交換契約を満たす', (_label, createFixture) => {
    const value = createShogiGameRecordSessionV1(createFixture(), EXPORTED_AT);
    assertSessionContract(value);
  });

  it('終局済みfixtureは投了結果と ended 状態を保存する', () => {
    const value = createShogiGameRecordSessionV1(createEndedSessionFixture(), EXPORTED_AT);
    expect(value.mainline.latestState.status).toBe('ended');
    expect(value.mainline.result).toMatchObject({ endReason: 'resignation' });
  });

  it('静的JSON fixtureを読み込み、再シリアライズ後も時刻以外の意味的内容を維持する', () => {
    const json = readFileSync(STATIC_MAINLINE_FIXTURE_PATH, 'utf8');
    const parsed = JSON.parse(json) as ShogiGameRecordSessionV1;
    assertSessionContract(parsed);
    const imported = importShogiGameRecordSession(json);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.metadata).toMatchObject({ branchCount: 0, isLegacyGameRecord: false });
    const reserialized = JSON.parse(serializeShogiGameRecordSessionV1(imported.session, EXPORTED_AT)) as ShogiGameRecordSessionV1;
    expect(normalizeExchangeJson(reserialized)).toEqual(normalizeExchangeJson({ ...parsed, exportedAt: EXPORTED_AT.toISOString() }));
  });

  it('serialize → import の往復で本譜、分岐、選択中棋譜を維持する', () => {
    const source = createSingleBranchSessionFixture();
    const serialized = serializeShogiGameRecordSessionV1(source, EXPORTED_AT);
    const imported = importShogiGameRecordSession(serialized);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.metadata).toMatchObject({ branchCount: 1, isLegacyGameRecord: false });
    expect(imported.session.selection).toEqual(source.selection);
    expect(imported.state.recordId).toBe(source.branches[0].state.recordId);
  });

  it('入れ子分岐を受け付けない', () => {
    const value = createShogiGameRecordSessionV1(createSingleBranchSessionFixture(), EXPORTED_AT);
    value.branches[0].record.branchFrom!.recordId = 'a-branch-cannot-be-a-parent';
    expect(importShogiGameRecordSession(JSON.stringify(value))).toMatchObject({ ok: false, code: 'inconsistent_record' });
  });

  it('旧来の単一棋譜v1を本譜のみのセッションとして読み込む', () => {
    const legacyJson = JSON.stringify(createShogiGameRecordV1(createMainlineOnlySessionFixture().mainline, EXPORTED_AT));
    const imported = importShogiGameRecordSession(legacyJson);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.metadata).toMatchObject({ branchCount: 0, isLegacyGameRecord: true });
    expect(imported.session.branches).toEqual([]);
    expect(imported.session.selection).toEqual({ kind: 'mainline' });
  });
});
