import { describe, expect, it } from 'vitest';
import { createInitialBoardState } from '../types/shogi';
import { createKifText, executeMove, importKifText, MAX_KIF_FILE_BYTES } from '../domain/shogi';

function applied(state: ReturnType<typeof createInitialBoardState>, from: { row: number; col: number }, to: { row: number; col: number }, promotion?: 'promote' | 'decline') {
  const result = executeMove(state, from, to, { mode: 'assist', proposer: 'human', promotion });
  if (result.type !== 'applied') throw new Error('テスト用の合法手を適用できませんでした。');
  return result.state;
}

function standardKif(lines: string[], newline = '\n'): string {
  return ['#KIF version=2.0 encoding=UTF-8', '手数----指手---------消費時間--', ...lines].join(newline) + newline;
}

describe('KIF 2.0 import', () => {
  it('書き出した未終局棋譜を既存APIで再実行して往復できる', () => {
    let state = createInitialBoardState();
    state = applied(state, { row: 6, col: 2 }, { row: 5, col: 2 });
    state = applied(state, { row: 2, col: 6 }, { row: 3, col: 6 });
    state = applied(state, { row: 7, col: 1 }, { row: 1, col: 7 }, 'decline');
    const imported = importKifText(createKifText(state));

    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.state.history).toHaveLength(3);
    expect(imported.state.history[2].promotion).toBe('decline');
    expect(imported.state.positionSnapshots).toHaveLength(4);
    expect(imported.state.turn).toBe(state.turn);
  });

  it('成・不成省略・成れない通常手・成駒の移動を区別して復元する', () => {
    const imported = importKifText(standardKif([
      '1 ７六歩(77)',
      '2 ３四歩(33)',
      '3 ２二角成(88)',
      '4 ２四歩(23)',
      '5 ２三馬(22)',
    ]));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.state.history.map((move) => move.promotion)).toEqual(['none', 'none', 'promote', 'none', 'none']);
    expect(imported.state.squares[2][7].piece).toMatchObject({ type: 'bishop', isPromoted: true });
  });

  it('「同」、時間表記、BOM、CRLF、消費時間付き投了を処理する', () => {
    const imported = importKifText('\uFEFF' + standardKif([
      '1 ７六歩(77) ( 0:00/00:00:00)',
      '2 ３四歩(33)',
      '3 ２二角成(88)',
      '4 同銀(31) ( 0:01/00:00:01)',
      '5 投了 ( 0:01/00:00:05)',
    ], '\r\n'));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.state.history).toHaveLength(4);
    expect(imported.state.status).toBe('ended');
    expect(imported.state.result?.endReason).toBe('resignation');
    expect(imported.state.result).toMatchObject({ winner: 'gote', loser: 'sente' });
  });

  it.each([
    ['不明な終局語', '1 中断 ( 0:01/00:00:05)'],
    ['不正な消費時間の括弧表記', '1 投了 ( 0:01)'],
    ['移動元座標だけを付けた終局語', '1 投了 (77)'],
    ['時間を除くと空になる指し手', '1 ( 0:01/00:00:05)'],
  ])('%sを時間表記として誤受理しない', (_label, line) => {
    const imported = importKifText(standardKif([line]));
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect('state' in imported).toBe(false);
  });

  it('駒取りと駒打ちを既存の合法手APIで復元する', () => {
    const imported = importKifText(standardKif([
      '1 ７六歩(77)', '2 ３四歩(33)', '3 ２二角成(88)', '4 ２四歩(23)',
      '5 ５五角打',
    ]));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.state.history.at(-1)).toMatchObject({ kind: 'drop', pieceType: 'bishop' });
  });

  it.each([
    ['手数飛び', standardKif(['2 ７六歩(77)'])],
    ['駒名不一致', standardKif(['1 ７六銀(77)'])],
    ['不正な成り', standardKif(['1 ７六歩成(77)'])],
    ['不正な駒打ち', standardKif(['1 ５五歩打(77)'])],
    ['不正な同', standardKif(['1 同歩(77)'])],
    ['未対応局面', standardKif(['手合割：香落ち'])],
  ])('%sを行番号付きで拒否する', (_label, kif) => {
    const imported = importKifText(kif);
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.message).toMatch(/行目|平手/);
  });

  it('反則理由を持たない反則負けと整合しない終局語を推測して受理しない', () => {
    const foul = importKifText(standardKif(['1 反則負け']));
    const mate = importKifText(standardKif(['1 ７六歩(77)', '2 詰み']));
    expect(foul.ok).toBe(false);
    expect(mate.ok).toBe(false);
  });

  it.each([
    ['バージョン宣言なし', '手数----指手---------消費時間--\n1 ７六歩(77)\n', 'バージョン宣言'],
    ['未対応バージョン', '#KIF version=2.1 encoding=UTF-8\n手数----指手---------消費時間--\n', '対応していないKIFバージョン'],
    ['未対応バージョン9.0', '#KIF version=9.0 encoding=UTF-8\n手数----指手---------消費時間--\n', '対応していないKIFバージョン'],
    ['未対応文字コード', '#KIF version=2.0 encoding=Shift_JIS\n手数----指手---------消費時間--\n', '対応していないKIFバージョン'],
    ['壊れたKIF宣言', '#KIF version=2.0\n手数----指手---------消費時間--\n', '対応していないKIFバージョン'],
    ['指し手表なし', '#KIF version=2.0 encoding=UTF-8\n1 ７六歩(77)\n', '指し手表ヘッダー'],
    ['コメントだけ', '# KIF comment\n', 'バージョン宣言'],
    ['メタデータだけ', '先手：先手太郎\n後手：後手花子\n', 'バージョン宣言'],
    ['KIFではない内容', 'これは将棋棋譜ではありません。\n', 'バージョン宣言'],
  ])('%sをKIF 2.0の基本構造エラーとして拒否する', (_label, kif, message) => {
    const imported = importKifText(kif);
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.message).toContain(message);
  });

  it.each([
    ['バージョン宣言の重複', [
      '#KIF version=2.0 encoding=UTF-8',
      '#KIF version=2.0 encoding=UTF-8',
      '手数----指手---------消費時間--',
    ], 'バージョン宣言が重複'],
    ['バージョン宣言が手数見出しより後', [
      '手数----指手---------消費時間--',
      '#KIF version=2.0 encoding=UTF-8',
    ], 'バージョン宣言がありません'],
    ['手数見出しの重複', [
      '#KIF version=2.0 encoding=UTF-8',
      '手数----指手---------消費時間--',
      '手数----指手---------消費時間--',
    ], '指し手表ヘッダーが重複'],
  ])('%sを行番号付きで拒否する', (_label, lines, message) => {
    const imported = importKifText(lines.join('\n') + '\n');
    expect(imported).toMatchObject({ ok: false, message: expect.stringContaining(message) });
    if (!imported.ok) expect(imported.message).toContain('行目');
  });

  it('正式な宣言と標準手数見出しを持つ0手KIF、および宣言後のコメントを受理する', () => {
    const imported = importKifText([
      '#KIF version=2.0 encoding=UTF-8',
      '# 任意のコメント',
      '手数----指手---------消費時間--',
      '# 指し手表後のコメント',
    ].join('\n') + '\n');
    expect(imported).toMatchObject({ ok: true, metadata: { moveCount: 0, isEnded: false } });
    if (imported.ok) {
      expect(imported.state.status).toBe('active');
      expect(imported.state.history).toHaveLength(0);
    }
  });

  it('既存ドメインが再実行で確定した千日手終局行を照合して復元する', () => {
    let state = createInitialBoardState();
    const cycle = [
      [{ row: 8, col: 3 }, { row: 7, col: 3 }],
      [{ row: 0, col: 3 }, { row: 1, col: 3 }],
      [{ row: 7, col: 3 }, { row: 8, col: 3 }],
      [{ row: 1, col: 3 }, { row: 0, col: 3 }],
    ] as const;
    for (let count = 0; count < 3; count += 1) {
      for (const [from, to] of cycle) state = applied(state, from, to);
    }
    expect(state.result?.endReason).toBe('repetition');
    const imported = importKifText(createKifText(state));
    expect(imported).toMatchObject({ ok: true, metadata: { isEnded: true } });
    if (imported.ok) expect(imported.state.result?.endReason).toBe('repetition');
  });

  it('32 MiB超過を拒否し、入力を部分的に状態化しない', () => {
    const imported = importKifText('#'.repeat(MAX_KIF_FILE_BYTES + 1));
    expect(imported).toMatchObject({ ok: false, code: 'file_too_large' });
  });
});
