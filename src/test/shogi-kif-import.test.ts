import { describe, expect, it } from 'vitest';
import { createInitialBoardState } from '../types/shogi';
import { createKifText, executeMove, importKifBytes, importKifText, MAX_KIF_FILE_BYTES } from '../domain/shogi';

function applied(state: ReturnType<typeof createInitialBoardState>, from: { row: number; col: number }, to: { row: number; col: number }, promotion?: 'promote' | 'decline') {
  const result = executeMove(state, from, to, { mode: 'assist', proposer: 'human', promotion });
  if (result.type !== 'applied') throw new Error('テスト用の合法手を適用できませんでした。');
  return result.state;
}

function standardKif(lines: string[], newline = '\n'): string {
  return ['#KIF version=2.0 encoding=UTF-8', '手数----指手---------消費時間--', ...lines].join(newline) + newline;
}

function createShiftJisKifThatExpandsBeyondUtf8Limit(): Uint8Array {
  const encoder = new TextEncoder();
  const prefix = encoder.encode('#KIF version=2.0 encoding=Shift_JIS\n*');
  const suffix = new Uint8Array([
    0x0a, 0x8e, 0xe8, 0x90, 0x94, 0x2d, 0x2d, 0x2d, 0x2d, 0x8e, 0x77, 0x8e, 0xe8,
    0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x8f, 0xc1, 0x94, 0xef,
    0x8e, 0x9e, 0x8a, 0xd4, 0x2d, 0x2d, 0x0a,
  ]);
  // Shift_JIS「あ」is two bytes and UTF-8「あ」is three bytes. This is only
  // about 22.4 MiB on disk, but becomes just over 32 MiB after UTF-8 decoding.
  const characterCount = Math.floor((MAX_KIF_FILE_BYTES - prefix.byteLength - suffix.byteLength) / 3) + 1;
  const bytes = new Uint8Array(prefix.byteLength + characterCount * 2 + suffix.byteLength);
  bytes.set(prefix);
  for (let index = prefix.byteLength; index < prefix.byteLength + characterCount * 2; index += 2) {
    bytes[index] = 0x82;
    bytes[index + 1] = 0xa0;
  }
  bytes.set(suffix, prefix.byteLength + characterCount * 2);
  return bytes;
}

function withDeclarationTrailingWhitespace(bytes: Uint8Array, whitespace: number): Uint8Array {
  const declarationEnd = bytes.indexOf(0x0d);
  if (declarationEnd < 0) throw new Error('テスト用Shift_JIS宣言の行末がありません。');
  const result = new Uint8Array(bytes.byteLength + 1);
  result.set(bytes.subarray(0, declarationEnd));
  result[declarationEnd] = whitespace;
  result.set(bytes.subarray(declarationEnd), declarationEnd + 1);
  return result;
}

// Fixed CP932/Shift_JIS fixtures. They deliberately use real encoded bytes, not
// strings passed directly to the text parser, so browser TextDecoder is exercised.
const SHIFT_JIS_DECLARED_KIF = new Uint8Array([
  0x23, 0x4b, 0x49, 0x46, 0x20, 0x76, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e, 0x3d, 0x32, 0x2e, 0x30, 0x20, 0x65, 0x6e, 0x63, 0x6f, 0x64, 0x69, 0x6e, 0x67, 0x3d, 0x53, 0x68, 0x69, 0x66, 0x74, 0x5f, 0x4a, 0x49, 0x53, 0x0d, 0x0a, 0x90, 0xe6, 0x8e, 0xe8, 0x81, 0x46, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x91, 0xbe, 0x98, 0x59, 0x0d, 0x0a, 0x8c, 0xe3, 0x8e, 0xe8, 0x81, 0x46, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x89, 0xd4, 0x8e, 0x71, 0x0d, 0x0a, 0x8e, 0xe8, 0x90, 0x94, 0x2d, 0x2d, 0x2d, 0x2d, 0x8e, 0x77, 0x8e, 0xe8, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x8f, 0xc1, 0x94, 0xef, 0x8e, 0x9e, 0x8a, 0xd4, 0x2d, 0x2d, 0x0d, 0x0a, 0x31, 0x20, 0x82, 0x56, 0x98, 0x5a, 0x95, 0xe0, 0x28, 0x37, 0x37, 0x29, 0x20, 0x28, 0x20, 0x30, 0x3a, 0x30, 0x31, 0x2f, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x31, 0x29, 0x0d, 0x0a, 0x32, 0x20, 0x82, 0x52, 0x8e, 0x6c, 0x95, 0xe0, 0x28, 0x33, 0x33, 0x29, 0x0d, 0x0a, 0x33, 0x20, 0x82, 0x51, 0x93, 0xf1, 0x8a, 0x70, 0x90, 0xac, 0x28, 0x38, 0x38, 0x29, 0x0d, 0x0a, 0x34, 0x20, 0x93, 0xaf, 0x8b, 0xe2, 0x28, 0x33, 0x31, 0x29, 0x0d, 0x0a, 0x35, 0x20, 0x93, 0x8a, 0x97, 0xb9, 0x0d, 0x0a,
]);
const SHIFT_JIS_LEGACY_KIF = new Uint8Array([
  0x90, 0xe6, 0x8e, 0xe8, 0x81, 0x46, 0x8b, 0x8c, 0x8c, 0x60, 0x8e, 0xae, 0x0d, 0x0a, 0x8e, 0xe8, 0x90, 0x94, 0x2d, 0x2d, 0x2d, 0x2d, 0x8e, 0x77, 0x8e, 0xe8, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x8f, 0xc1, 0x94, 0xef, 0x8e, 0x9e, 0x8a, 0xd4, 0x2d, 0x2d, 0x0d, 0x0a, 0x31, 0x20, 0x82, 0x56, 0x98, 0x5a, 0x95, 0xe0, 0x28, 0x37, 0x37, 0x29, 0x0d, 0x0a, 0x32, 0x20, 0x82, 0x52, 0x8e, 0x6c, 0x95, 0xe0, 0x28, 0x33, 0x33, 0x29, 0x0d, 0x0a, 0x33, 0x20, 0x82, 0x51, 0x93, 0xf1, 0x8a, 0x70, 0x90, 0xac, 0x28, 0x38, 0x38, 0x29, 0x0d, 0x0a, 0x34, 0x20, 0x82, 0x51, 0x8e, 0x6c, 0x95, 0xe0, 0x28, 0x32, 0x33, 0x29, 0x0d, 0x0a, 0x35, 0x20, 0x82, 0x54, 0x8c, 0xdc, 0x8a, 0x70, 0x91, 0xc5, 0x0d, 0x0a,
]);

describe('KIF 2.0 import', () => {
  it.each([
    ['半角空白', '#KIF version=2.0 encoding=UTF-8   '],
    ['タブ', '#KIF version=2.0 encoding=UTF-8\t'],
  ])('UTF-8宣言末尾の%sをパーサーと同様に除去して読み込む', (_label, declaration) => {
    const bytes = new TextEncoder().encode([
      declaration,
      '手数----指手---------消費時間--',
      '1 ７六歩(77)',
    ].join('\n') + '\n');
    expect(importKifBytes(bytes)).toMatchObject({ ok: true, metadata: { encoding: 'utf-8', moveCount: 1 } });
  });

  it.each([
    ['半角空白', 0x20],
    ['タブ', 0x09],
  ])('Shift_JIS宣言末尾の%sをパーサーと同様に除去して読み込む', (_label, whitespace) => {
    const imported = importKifBytes(withDeclarationTrailingWhitespace(SHIFT_JIS_DECLARED_KIF, whitespace));
    expect(imported).toMatchObject({ ok: true, metadata: { encoding: 'shift_jis', moveCount: 4 } });
  });

  it('宣言末尾の非空白文字と完全な未対応宣言を引き続き拒否する', () => {
    const encoder = new TextEncoder();
    const extraCharacter = encoder.encode('#KIF version=2.0 encoding=UTF-8 x\n手数----指手---------消費時間--\n');
    const unsupportedWithWhitespace = encoder.encode('#KIF version=2.1 encoding=UTF-8  \n手数----指手---------消費時間--\n');
    expect(importKifBytes(extraCharacter)).toMatchObject({ ok: false, code: 'unsupported_encoding' });
    expect(importKifBytes(unsupportedWithWhitespace)).toMatchObject({ ok: false, code: 'unsupported_encoding' });
  });

  it('4,096バイト境界で途切れた宣言候補を未対応宣言と決めつけず、デコード後に読む', () => {
    const declaration = '#KIF version=2.0 encoding=UTF-8';
    const declarationStart = 4_090;
    const bytes = new TextEncoder().encode([
      ' '.repeat(declarationStart) + declaration,
      '手数----指手---------消費時間--',
      '1 ７六歩(77)',
    ].join('\n') + '\n');
    expect(bytes.indexOf(0x23)).toBe(declarationStart);
    expect(declarationStart + declaration.length).toBeGreaterThan(4_096);
    expect(bytes.byteLength).toBeGreaterThan(4_096);
    expect(importKifBytes(bytes)).toMatchObject({ ok: true, metadata: { encoding: 'utf-8', moveCount: 1 } });
  });

  it('4,096バイト以下で改行のない最後の完全な未対応宣言は引き続き拒否する', () => {
    const bytes = new TextEncoder().encode('#KIF version=2.1 encoding=UTF-8');
    expect(bytes.byteLength).toBeLessThan(4_096);
    expect(importKifBytes(bytes)).toMatchObject({ ok: false, code: 'unsupported_encoding' });
  });

  it('日本語メタデータとコメント内の疑似宣言を無視し、BOM後の本物のUTF-8宣言を採用する', () => {
    const bytes = new TextEncoder().encode([
      '\uFEFF先手：山田 #KIF version=2.0 encoding=Shift_JIS',
      '棋戦：テスト戦 #KIF version=9.0 encoding=UTF-16',
      '後手：佐藤 #KIF version=2.0 encoding=Shift_JIS',
      '* 日本語 #KIF version=2.0 encoding=Shift_JIS',
      ' \t#KIF version=2.0 encoding=UTF-8',
      '手数----指手---------消費時間--',
      '1 ７六歩(77)',
    ].join('\n') + '\n');

    expect(importKifBytes(bytes)).toMatchObject({ ok: true, metadata: { encoding: 'utf-8', moveCount: 1 } });
  });

  it('コメント内の疑似宣言を無視し、本物のUTF-8宣言を採用する', () => {
    const bytes = new TextEncoder().encode([
      '* #KIF version=2.0 encoding=Shift_JIS',
      '* #KIF version=9.0 encoding=UTF-16',
      '# comment #KIF version=9.0 encoding=UTF-16',
      '#KIF version=2.0 encoding=UTF-8',
      '手数----指手---------消費時間--',
      '1 ７六歩(77)',
    ].join('\n') + '\n');

    expect(importKifBytes(bytes)).toMatchObject({ ok: true, metadata: { encoding: 'utf-8', moveCount: 1 } });
  });

  it('行頭の未対応宣言はコメントと区別して引き続き拒否する', () => {
    const bytes = new TextEncoder().encode('#KIF version=2.1 encoding=UTF-8\n手数----指手---------消費時間--\n');
    expect(importKifBytes(bytes)).toMatchObject({ ok: false, code: 'unsupported_encoding' });
  });

  it('元バイト数が上限内のShift_JISをUTF-8換算サイズで拒否しない', () => {
    const bytes = createShiftJisKifThatExpandsBeyondUtf8Limit();
    expect(bytes.byteLength).toBeLessThanOrEqual(MAX_KIF_FILE_BYTES);
    const imported = importKifBytes(bytes);
    if (!imported.ok) throw new Error(imported.message);
    expect(imported.metadata).toMatchObject({ encoding: 'shift_jis', moveCount: 0 });
  });

  it('文字列APIにはUTF-8換算で引き続き32 MiB上限を適用する', () => {
    const text = 'あ'.repeat(Math.floor(MAX_KIF_FILE_BYTES / 3) + 1);
    expect(importKifText(text)).toMatchObject({ ok: false, code: 'file_too_large' });
  });

  it('UTF-8 BOM付きKIFを元バイト列から復元し、採用文字コードを記録する', () => {
    const bytes = new TextEncoder().encode('\uFEFF' + standardKif(['1 ７六歩(77)'], '\r\n'));
    const imported = importKifBytes(bytes.buffer);
    expect(imported).toMatchObject({ ok: true, metadata: { encoding: 'utf-8', moveCount: 1 } });
  });

  it('宣言付き・宣言なしの実際のShift_JISバイト列を安全に再生する', () => {
    const declared = importKifBytes(SHIFT_JIS_DECLARED_KIF);
    expect(declared).toMatchObject({ ok: true, metadata: { encoding: 'shift_jis', moveCount: 4, isEnded: true } });
    if (declared.ok) expect(declared.state.result?.endReason).toBe('resignation');

    const legacy = importKifBytes(SHIFT_JIS_LEGACY_KIF);
    expect(legacy).toMatchObject({ ok: true, metadata: { encoding: 'shift_jis', moveCount: 5 } });
    if (legacy.ok) expect(legacy.state.history.at(-1)).toMatchObject({ kind: 'drop', pieceType: 'bishop' });
  });

  it('宣言とバイト列の不一致、未対応BOM、不正バイト列を文字コードエラーとして拒否する', () => {
    const utf8AsShiftJis = new TextEncoder().encode(standardKif(['1 ７六歩(77)']).replace('UTF-8', 'Shift_JIS'));
    const shiftJisAsUtf8 = new Uint8Array(SHIFT_JIS_DECLARED_KIF);
    const utf8Header = new TextEncoder().encode('#KIF version=2.0 encoding=UTF-8\n');
    shiftJisAsUtf8.set(utf8Header, 0);

    expect(importKifBytes(utf8AsShiftJis)).toMatchObject({ ok: false, code: 'encoding_mismatch' });
    expect(importKifBytes(shiftJisAsUtf8)).toMatchObject({ ok: false, code: 'encoding_mismatch' });
    expect(importKifBytes(new Uint8Array([0xff, 0xfe, 0x23, 0x00]))).toMatchObject({ ok: false, code: 'unsupported_encoding' });
    expect(importKifBytes(new Uint8Array([0xfe, 0xff, 0x00, 0x23]))).toMatchObject({ ok: false, code: 'unsupported_encoding' });
    expect(importKifBytes(new Uint8Array([0x82]))).toMatchObject({ ok: false, code: 'invalid_byte_sequence' });
    expect(importKifBytes(new Uint8Array(MAX_KIF_FILE_BYTES + 1))).toMatchObject({ ok: false, code: 'file_too_large' });
  });

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
    ['未対応バージョン', '#KIF version=2.1 encoding=UTF-8\n手数----指手---------消費時間--\n', '対応していないKIFバージョン'],
    ['未対応バージョン9.0', '#KIF version=9.0 encoding=UTF-8\n手数----指手---------消費時間--\n', '対応していないKIFバージョン'],
    ['未対応文字コード', '#KIF version=2.0 encoding=UTF-16\n手数----指手---------消費時間--\n', '対応していないKIFバージョン'],
    ['壊れたKIF宣言', '#KIF version=2.0\n手数----指手---------消費時間--\n', '対応していないKIFバージョン'],
    ['指し手表なし', '#KIF version=2.0 encoding=UTF-8\n1 ７六歩(77)\n', '指し手表ヘッダー'],
    ['コメントだけ', '# KIF comment\n', '指し手表ヘッダー'],
    ['メタデータだけ', '先手：先手太郎\n後手：後手花子\n', '指し手表ヘッダー'],
    ['KIFではない内容', 'これは将棋棋譜ではありません。\n', '指し手表ヘッダー'],
  ])('%sをKIF 2.0の基本構造エラーとして拒否する', (_label, kif, message) => {
    const imported = importKifText(kif);
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.message).toContain(message);
  });

  it('文字コード宣言なしでも標準手数見出しと連番・合法手を必須にして受理する', () => {
    const imported = importKifText('先手：旧式棋譜\n手数----指手---------消費時間--\n1 ７六歩(77)\n');
    expect(imported).toMatchObject({ ok: true, metadata: { moveCount: 1, encoding: null } });
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
    ], 'バージョン宣言は指し手表より前'],
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
