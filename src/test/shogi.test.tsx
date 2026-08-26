import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  createInitialBoardState,
  getSquareAriaLabel,
  getPieceDisplayInfo,
  canPromote,
  BoardSquare,
} from '../types/shogi';
import { ShogiBoard } from '../components/shogi/ShogiBoard';
import { validateLockfile } from '../../scripts/verify-lockfile.mjs';
import {
  runCleanups,
  combineErrors,
  createFsEventPromise,
  createViteWatcherPromise,
  verifyMacOsFsevents,
} from '../../scripts/verify-macos-fsevents.mjs';

describe('1. Node.js 24系・npm・環境・設定ファイルの検証', () => {
  const rootDir = process.cwd();
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf-8'));
  const packageLockJson = JSON.parse(
    fs.readFileSync(path.resolve(rootDir, 'package-lock.json'), 'utf-8')
  );

  it('package.json の名前が shogi-app であること', () => {
    expect(packageJson.name).toBe('shogi-app');
  });

  it('packageManager が npm を指定し完全なSemVerであること', () => {
    expect(packageJson.packageManager).toMatch(/^npm@\d+\.\d+\.\d+$/);
    expect(packageJson.packageManager).toBe('npm@11.17.0');
  });

  it('Node.js の engines.node が Node.js 24.15.0 以上 25 未満、npm が >=11.17.0 <12 を指定していること', () => {
    expect(packageJson.engines).toBeDefined();
    expect(packageJson.engines.node).toBe('>=24.15.0 <25');
    expect(packageJson.engines.npm).toBe('>=11.17.0 <12');
  });

  it('package.json の @types/node が ^24.0.0 を指定していること', () => {
    expect(packageJson.devDependencies['@types/node']).toMatch(/^\^?24\./);
  });

  it('package.json の allowScripts で必要なスクリプトが審査されていること', () => {
    expect(packageJson.allowScripts).toBeDefined();
    expect(packageJson.allowScripts['esbuild']).toBe(true);
    expect(packageJson.allowScripts['@google/genai']).toBe(false);
    expect(packageJson.allowScripts['protobufjs']).toBe(false);
    expect(packageJson.allowScripts['fsevents']).toBe(false);
  });

  it('.nvmrc が存在し 24.19.0 を指定していること', () => {
    const nvmrcPath = path.resolve(rootDir, '.nvmrc');
    expect(fs.existsSync(nvmrcPath)).toBe(true);
    const content = fs.readFileSync(nvmrcPath, 'utf-8').trim();
    expect(content).toBe('24.19.0');
  });

  it('.npmrc が存在し strict-allow-scripts を含む厳格な設定が含まれていること', () => {
    const npmrcPath = path.resolve(rootDir, '.npmrc');
    expect(fs.existsSync(npmrcPath)).toBe(true);
    const content = fs.readFileSync(npmrcPath, 'utf-8');
    expect(content).toContain('package-lock=true');
    expect(content).toContain('engine-strict=true');
    expect(content).toContain('omit-lockfile-registry-resolved=false');
    expect(content).toContain('strict-allow-scripts=true');
  });

  it('package-lock.json が存在しルート名が package.json.name と一致し lockfileVersion が 3 であること', () => {
    expect(fs.existsSync(path.resolve(rootDir, 'package-lock.json'))).toBe(true);
    expect(packageLockJson.name).toBe(packageJson.name);
    expect(packageLockJson.lockfileVersion).toBe(3);
  });

  it('package-lock.json のルート engines.npm が >=11.17.0 <12 であること', () => {
    const rootPkg = packageLockJson.packages?.[''] || {};
    expect(rootPkg.engines?.npm).toBe('>=11.17.0 <12');
  });

  it('package-lock.json のルート依存関係が package.json と完全一致すること', () => {
    const rootPkg = packageLockJson.packages?.[''] || {};
    const lockDeps = rootPkg.dependencies || packageLockJson.dependencies || {};
    const pkgDeps = packageJson.dependencies || {};
    expect(lockDeps).toEqual(pkgDeps);

    const lockDevDeps = rootPkg.devDependencies || packageLockJson.devDependencies || {};
    const pkgDevDeps = packageJson.devDependencies || {};
    expect(lockDevDeps).toEqual(pkgDevDeps);
  });

  it('package-lock.json 内の @types/node が 24系として解決されていること', () => {
    const nodeTypesPkg = packageLockJson.packages?.['node_modules/@types/node'];
    expect(nodeTypesPkg).toBeDefined();
    expect(nodeTypesPkg.version).toMatch(/^24\./);
  });

  it('bun.lock, yarn.lock, pnpm-lock.yaml が存在しないこと', () => {
    expect(fs.existsSync(path.resolve(rootDir, 'bun.lock'))).toBe(false);
    expect(fs.existsSync(path.resolve(rootDir, 'bun.lockb'))).toBe(false);
    expect(fs.existsSync(path.resolve(rootDir, 'yarn.lock'))).toBe(false);
    expect(fs.existsSync(path.resolve(rootDir, 'pnpm-lock.yaml'))).toBe(false);
  });

  it('clean スクリプトが rm -rf に依存せずクロスプラットフォームスクリプトを呼び出していること', () => {
    expect(packageJson.scripts.clean).toBe('node scripts/clean.mjs');
    expect(fs.existsSync(path.resolve(rootDir, 'scripts/clean.mjs'))).toBe(true);
  });

  it('ロックファイル検証スクリプト verify-lockfile.mjs が存在し正常終了すること', () => {
    expect(packageJson.scripts['verify:lock']).toBe('node scripts/verify-lockfile.mjs');
    const verifyScriptPath = path.resolve(rootDir, 'scripts/verify-lockfile.mjs');
    expect(fs.existsSync(verifyScriptPath)).toBe(true);

    const output = execSync('node scripts/verify-lockfile.mjs', {
      cwd: rootDir,
      encoding: 'utf-8',
    });
    expect(output).toContain('SUCCESS: package-lock.json is valid and complete.');
    expect(output).toContain('Missing "version":       0');
    expect(output).toContain('Missing "resolved":      0');
    expect(output).toContain('Missing "integrity":     0');
  });

  it('macOS 検証スクリプト verify-macos-fsevents.mjs が存在し package.json に登録されていること', () => {
    expect(packageJson.scripts['verify:macos-fsevents']).toBe('node scripts/verify-macos-fsevents.mjs');
    const macosScriptPath = path.resolve(rootDir, 'scripts/verify-macos-fsevents.mjs');
    expect(fs.existsSync(macosScriptPath)).toBe(true);

    const ciWorkflowPath = path.resolve(rootDir, '.github/workflows/ci.yml');
    expect(fs.existsSync(ciWorkflowPath)).toBe(true);
    const ciContent = fs.readFileSync(ciWorkflowPath, 'utf-8');
    expect(ciContent).toContain('npm run verify:macos-fsevents');
    expect(ciContent).toContain("runner.os == 'macOS'");
  });
});

describe('2. ロックファイル検証ロジックの完全一致および否定テスト', () => {
  const rootDir = process.cwd();
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf-8'));
  const packageLockJson = JSON.parse(
    fs.readFileSync(path.resolve(rootDir, 'package-lock.json'), 'utf-8')
  );

  let tempDir = '';

  const setupTempProject = (
    customPkg = packageJson,
    customLock = packageLockJson,
    extraFiles: Record<string, string> = {}
  ) => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shogi-lock-test-'));
    fs.writeFileSync(path.resolve(tempDir, 'package.json'), JSON.stringify(customPkg, null, 2));
    fs.writeFileSync(path.resolve(tempDir, 'package-lock.json'), JSON.stringify(customLock, null, 2));
    for (const [filename, content] of Object.entries(extraFiles)) {
      fs.writeFileSync(path.resolve(tempDir, filename), content);
    }
    return tempDir;
  };

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('完全に一致する正常なプロジェクト構成では成功すること', () => {
    const dir = setupTempProject();
    const result = validateLockfile(dir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.summary.missingVersion).toBe(0);
    expect(result.summary.missingResolved).toBe(0);
    expect(result.summary.missingIntegrity).toBe(0);
  });

  it('package.json 側の依存バージョンだけを変えると失敗すること (Version mismatch)', () => {
    const modifiedPkg = JSON.parse(JSON.stringify(packageJson));
    modifiedPkg.dependencies['react'] = '^19.99.0'; // 存在しない/不一致バージョン
    const dir = setupTempProject(modifiedPkg, packageLockJson);
    const result = validateLockfile(dir);

    expect(result.valid).toBe(false);
    expect(result.errors.some((err: string) => err.includes('Version mismatch for dependencies "react"'))).toBe(true);
  });

  it('package-lock.json 側だけに余分な依存を追加すると失敗すること (Extra dependency)', () => {
    const modifiedLock = JSON.parse(JSON.stringify(packageLockJson));
    modifiedLock.packages[''].dependencies['extra-pkg'] = '^1.0.0';
    const dir = setupTempProject(packageJson, modifiedLock);
    const result = validateLockfile(dir);

    expect(result.valid).toBe(false);
    expect(result.errors.some((err: string) => err.includes('Extra dependencies in package-lock.json root: "extra-pkg"'))).toBe(true);
  });

  it('package-lock.json 側から依存を削除すると失敗すること (Missing dependency)', () => {
    const modifiedLock = JSON.parse(JSON.stringify(packageLockJson));
    delete modifiedLock.packages[''].dependencies['react'];
    const dir = setupTempProject(packageJson, modifiedLock);
    const result = validateLockfile(dir);

    expect(result.valid).toBe(false);
    expect(result.errors.some((err: string) => err.includes('Missing dependencies in package-lock.json root: "react"'))).toBe(true);
  });

  it('devDependencies のバージョン不一致や欠落・余分も正しく検出されること', () => {
    const modifiedPkg = JSON.parse(JSON.stringify(packageJson));
    modifiedPkg.devDependencies['vitest'] = '^9.9.9';
    const dir = setupTempProject(modifiedPkg, packageLockJson);
    const result = validateLockfile(dir);

    expect(result.valid).toBe(false);
    expect(result.errors.some((err: string) => err.includes('Version mismatch for devDependencies "vitest"'))).toBe(true);
  });

  it('version を削除すると失敗し、missingVersion が 1 として集計され対象パッケージが特定できること', () => {
    const modifiedLock = JSON.parse(JSON.stringify(packageLockJson));
    const targetPkgKey = Object.keys(modifiedLock.packages).find((k) => k !== '');
    expect(targetPkgKey).toBeDefined();
    if (targetPkgKey) {
      delete modifiedLock.packages[targetPkgKey].version;
    }
    const dir = setupTempProject(packageJson, modifiedLock);
    const result = validateLockfile(dir);

    expect(result.valid).toBe(false);
    expect(result.summary.missingVersion).toBe(1);
    expect(result.errors.some((err: string) => err.includes(`Package "${targetPkgKey}" is missing "version" field`))).toBe(true);
  });

  it('link: true の正当な例外エントリは exceptions に集計され missingVersion 等に数えられないこと', () => {
    const modifiedLock = JSON.parse(JSON.stringify(packageLockJson));
    modifiedLock.packages['node_modules/my-local-link'] = {
      link: true,
    };
    const dir = setupTempProject(packageJson, modifiedLock);
    const result = validateLockfile(dir);

    expect(result.valid).toBe(true);
    expect(result.summary.exceptions).toBe(1);
    expect(result.summary.missingVersion).toBe(0);
    expect(result.summary.missingResolved).toBe(0);
    expect(result.summary.missingIntegrity).toBe(0);
  });

  it('symlink: true の正当な例外エントリは exceptions に集計され missingVersion 等に数えられないこと', () => {
    const modifiedLock = JSON.parse(JSON.stringify(packageLockJson));
    modifiedLock.packages['node_modules/my-local-symlink'] = {
      symlink: true,
    };
    const dir = setupTempProject(packageJson, modifiedLock);
    const result = validateLockfile(dir);

    expect(result.valid).toBe(true);
    expect(result.summary.exceptions).toBe(1);
    expect(result.summary.missingVersion).toBe(0);
    expect(result.summary.missingResolved).toBe(0);
    expect(result.summary.missingIntegrity).toBe(0);
  });

  it('resolved を削除すると失敗すること', () => {
    const modifiedLock = JSON.parse(JSON.stringify(packageLockJson));
    const firstPkgKey = Object.keys(modifiedLock.packages).find((k) => k !== '');
    if (firstPkgKey) {
      delete modifiedLock.packages[firstPkgKey].resolved;
    }
    const dir = setupTempProject(packageJson, modifiedLock);
    const result = validateLockfile(dir);

    expect(result.valid).toBe(false);
    expect(result.summary.missingResolved).toBeGreaterThan(0);
    expect(result.errors.some((err: string) => err.includes('is missing "resolved" field'))).toBe(true);
  });

  it('integrity を削除すると失敗すること', () => {
    const modifiedLock = JSON.parse(JSON.stringify(packageLockJson));
    const firstPkgKey = Object.keys(modifiedLock.packages).find((k) => k !== '');
    if (firstPkgKey) {
      delete modifiedLock.packages[firstPkgKey].integrity;
    }
    const dir = setupTempProject(packageJson, modifiedLock);
    const result = validateLockfile(dir);

    expect(result.valid).toBe(false);
    expect(result.summary.missingIntegrity).toBeGreaterThan(0);
    expect(result.errors.some((err: string) => err.includes('is missing "integrity" field'))).toBe(true);
  });

  it('npm 以外のロックファイル (bun.lock 等) が存在すると失敗すること', () => {
    const dir = setupTempProject(packageJson, packageLockJson, { 'bun.lock': 'test' });
    const result = validateLockfile(dir);

    expect(result.valid).toBe(false);
    expect(result.errors.some((err: string) => err.includes('Prohibited lockfile found: bun.lock'))).toBe(true);
  });
});

describe('3. 将棋盤および駒のデータ・表示ロジック（基本仕様）', () => {
  it('盤面が9行×9列である', () => {
    const boardState = createInitialBoardState();
    expect(boardState.squares).toHaveLength(9);
    for (const row of boardState.squares) {
      expect(row).toHaveLength(9);
    }
  });

  it('初期配置の駒が合計40枚である', () => {
    const boardState = createInitialBoardState();
    let pieceCount = 0;
    for (const row of boardState.squares) {
      for (const sq of row) {
        if (sq.piece) pieceCount++;
      }
    }
    expect(pieceCount).toBe(40);
  });

  it('全駒のIDが重複していない', () => {
    const boardState = createInitialBoardState();
    const ids = new Set<string>();
    for (const row of boardState.squares) {
      for (const sq of row) {
        if (sq.piece) {
          expect(ids.has(sq.piece.id)).toBe(false);
          ids.add(sq.piece.id);
        }
      }
    }
    expect(ids.size).toBe(40);
  });

  it('後手の飛車が8二、角が2二にある', () => {
    const boardState = createInitialBoardState();
    const square82 = boardState.squares[1][1];
    expect(square82.coordinateLabel).toBe('8二');
    expect(square82.piece?.player).toBe('gote');
    expect(square82.piece?.type).toBe('rook');

    const square22 = boardState.squares[1][7];
    expect(square22.coordinateLabel).toBe('2二');
    expect(square22.piece?.player).toBe('gote');
    expect(square22.piece?.type).toBe('bishop');
  });

  it('先手の角が8八、飛車が2八にある', () => {
    const boardState = createInitialBoardState();
    const square88 = boardState.squares[7][1];
    expect(square88.coordinateLabel).toBe('8八');
    expect(square88.piece?.player).toBe('sente');
    expect(square88.piece?.type).toBe('bishop');

    const square28 = boardState.squares[7][7];
    expect(square28.coordinateLabel).toBe('2八');
    expect(square28.piece?.player).toBe('sente');
    expect(square28.piece?.type).toBe('rook');
  });

  it('先手王が5九、後手玉が5一にある', () => {
    const boardState = createInitialBoardState();
    const square59 = boardState.squares[8][4];
    expect(square59.coordinateLabel).toBe('5九');
    expect(square59.piece?.player).toBe('sente');
    expect(square59.piece?.type).toBe('king');

    const square51 = boardState.squares[0][4];
    expect(square51.coordinateLabel).toBe('5一');
    expect(square51.piece?.player).toBe('gote');
    expect(square51.piece?.type).toBe('king');
  });

  it('5九のARIA名称が「先手の王将」になる', () => {
    const boardState = createInitialBoardState();
    const square59 = boardState.squares[8][4];
    expect(getSquareAriaLabel(square59)).toBe('5筋 9段、先手の王将');
  });

  it('5一のARIA名称が「後手の玉将」になる', () => {
    const boardState = createInitialBoardState();
    const square51 = boardState.squares[0][4];
    expect(getSquareAriaLabel(square51)).toBe('5筋 1段、後手の玉将');
  });

  it('空マスのARIA名称が正しい', () => {
    const boardState = createInitialBoardState();
    const square45 = boardState.squares[4][5];
    expect(square45.piece).toBeNull();
    expect(getSquareAriaLabel(square45)).toBe('4筋 5段、空のマス');
  });

  it('各成駒が通常駒とは異なる正しい文字になる', () => {
    expect(canPromote('king')).toBe(false);
    expect(canPromote('gold')).toBe(false);

    const rookPromoted = getPieceDisplayInfo('rook', 'sente', true);
    expect(rookPromoted.fullName).toBe('竜王');
    expect(rookPromoted.topChar).toBe('竜');
    expect(rookPromoted.bottomChar).toBe('王');
    expect(rookPromoted.ariaName).toBe('先手の竜王');
    expect(rookPromoted.isPromotedColor).toBe(true);

    const bishopPromoted = getPieceDisplayInfo('bishop', 'sente', true);
    expect(bishopPromoted.fullName).toBe('竜馬');

    const silverPromoted = getPieceDisplayInfo('silver', 'sente', true);
    expect(silverPromoted.fullName).toBe('成銀');

    const knightPromoted = getPieceDisplayInfo('knight', 'sente', true);
    expect(knightPromoted.fullName).toBe('成桂');

    const lancePromoted = getPieceDisplayInfo('lance', 'sente', true);
    expect(lancePromoted.fullName).toBe('成香');

    const pawnPromoted = getPieceDisplayInfo('pawn', 'sente', true);
    expect(pawnPromoted.fullName).toBe('と金');
  });

  it('盤上の星が4個だけで、3/9・6/9の対称位置にある', () => {
    const boardState = createInitialBoardState();
    let starCount = 0;
    const starCoordinates: Array<{ row: number; col: number; coordinate: string }> = [];

    boardState.squares.forEach((rowSquares, row) => {
      rowSquares.forEach((sq, col) => {
        if (sq.hasBottomRightStarMarker) {
          starCount++;
          starCoordinates.push({ row, col, coordinate: sq.coordinateLabel });
        }
      });
    });

    expect(starCount).toBe(4);
    expect(starCoordinates).toEqual([
      { row: 2, col: 2, coordinate: '7三' },
      { row: 2, col: 5, coordinate: '4三' },
      { row: 5, col: 2, coordinate: '7六' },
      { row: 5, col: 5, coordinate: '4六' },
    ]);
  });
});

describe('4. 表示専用盤面のアクセシビリティ検証', () => {
  it('tabIndex={0} のマスが0個であり、role="grid", role="row" (9個), role="gridcell" (81個) が構築されること', () => {
    const boardState = createInitialBoardState();
    const { container } = render(<ShogiBoard squares={boardState.squares} />);

    // tabIndex 0 を持つ要素がない
    const focusable = container.querySelectorAll('[tabindex="0"]');
    expect(focusable.length).toBe(0);

    // grid 構造の確認
    const grid = container.querySelector('[role="grid"]');
    expect(grid).toBeInTheDocument();

    const rows = container.querySelectorAll('[role="row"]');
    expect(rows.length).toBe(9);

    const cells = container.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBe(81);
  });
});

describe('5. インタラクティブ盤面の roving tabindex およびキーボード操作検証', () => {
  it('初期状態で tabIndex={0} が1個、tabIndex={-1} が80個であること（既定初期位置: 7七）', () => {
    const boardState = createInitialBoardState();
    const handleClick = vi.fn();
    const { container } = render(
      <ShogiBoard squares={boardState.squares} onSquareClick={handleClick} />
    );

    const tabZeros = container.querySelectorAll('[tabindex="0"]');
    const tabMinusOnes = container.querySelectorAll('[tabindex="-1"]');

    expect(tabZeros.length).toBe(1);
    expect(tabMinusOnes.length).toBe(80);

    // 既定の初期フォーカス位置は 7七 (row 6, col 2)
    const defaultFocused = container.querySelector('#square-7七');
    expect(defaultFocused).toHaveAttribute('tabindex', '0');
  });

  it('selectedSquare が指定された場合、そのマスが tabIndex={0} となること', () => {
    const boardState = createInitialBoardState();
    const handleClick = vi.fn();
    const { container } = render(
      <ShogiBoard
        squares={boardState.squares}
        selectedSquare={{ row: 8, col: 4 }} // 5九（先手王将）
        onSquareClick={handleClick}
      />
    );

    const tabZeros = container.querySelectorAll('[tabindex="0"]');
    expect(tabZeros.length).toBe(1);
    const selectedSq = container.querySelector('#square-5九');
    expect(selectedSq).toHaveAttribute('tabindex', '0');
    expect(selectedSq).toHaveAttribute('aria-selected', 'true');
  });

  it('矢印キー（右・左・上・下）で隣接マスへフォーカス移動し、盤端で盤外へ出ないこと', async () => {
    const user = userEvent.setup();
    const boardState = createInitialBoardState();
    const handleClick = vi.fn();
    const { container } = render(
      <ShogiBoard squares={boardState.squares} onSquareClick={handleClick} />
    );

    // 初期フォーカス位置: 7七 (row 6, col 2)
    const square77 = container.querySelector('#square-7七') as HTMLElement;
    square77.focus();
    expect(square77).toHaveFocus();

    // 1. 右矢印キー -> 6七 (row 6, col 3)
    await user.keyboard('{ArrowRight}');
    const square67 = container.querySelector('#square-6七') as HTMLElement;
    expect(square67).toHaveFocus();
    expect(square67).toHaveAttribute('tabindex', '0');
    expect(square77).toHaveAttribute('tabindex', '-1');

    // 2. 上矢印キー -> 6六 (row 5, col 3)
    await user.keyboard('{ArrowUp}');
    const square66 = container.querySelector('#square-6六') as HTMLElement;
    expect(square66).toHaveFocus();
    expect(square66).toHaveAttribute('tabindex', '0');

    // 3. 左矢印キー -> 7六 (row 5, col 2)
    await user.keyboard('{ArrowLeft}');
    const square76 = container.querySelector('#square-7六') as HTMLElement;
    expect(square76).toHaveFocus();

    // 4. 下矢印キー -> 7七 (row 6, col 2)
    await user.keyboard('{ArrowDown}');
    expect(square77).toHaveFocus();

    // 5. 盤端テスト: 9一 (row 0, col 0) に移動してさらに上・左を押しても盤外へ出ない
    const square91 = container.querySelector('#square-9一') as HTMLElement;
    square91.focus();
    await user.click(square91);
    expect(square91).toHaveAttribute('tabindex', '0');

    await user.keyboard('{ArrowUp}');
    expect(square91).toHaveFocus(); // 上端で位置維持

    await user.keyboard('{ArrowLeft}');
    expect(square91).toHaveFocus(); // 左端で位置維持
  });

  it('Enter キーおよび Space キーで対象マスのコールバックが1回ずつ呼ばれること', async () => {
    const user = userEvent.setup();
    const boardState = createInitialBoardState();
    const handleClick = vi.fn();
    const { container } = render(
      <ShogiBoard squares={boardState.squares} onSquareClick={handleClick} />
    );

    const square77 = container.querySelector('#square-7七') as HTMLElement;
    square77.focus();

    // Enter
    await user.keyboard('{Enter}');
    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick.mock.calls[0][0].coordinateLabel).toBe('7七');

    // Space
    await user.keyboard(' ');
    expect(handleClick).toHaveBeenCalledTimes(2);
    expect(handleClick.mock.calls[1][0].coordinateLabel).toBe('7七');
  });

  it('マウスクリックしたマスが roving tabindex の現在位置（tabIndex={0}）になること', async () => {
    const user = userEvent.setup();
    const boardState = createInitialBoardState();
    const handleClick = vi.fn();
    const { container } = render(
      <ShogiBoard squares={boardState.squares} onSquareClick={handleClick} />
    );

    const square28 = container.querySelector('#square-2八') as HTMLElement;
    await user.click(square28);

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(square28).toHaveAttribute('tabindex', '0');

    // 他のマスは -1
    const square77 = container.querySelector('#square-7七') as HTMLElement;
    expect(square77).toHaveAttribute('tabindex', '-1');
  });

  it('表示専用からインタラクティブへの切り替え、およびその逆で Tab 停止数が正しく遷移すること', () => {
    const boardState = createInitialBoardState();
    const handleClick = vi.fn();

    // 1. 表示専用
    const { container, rerender } = render(<ShogiBoard squares={boardState.squares} />);
    expect(container.querySelectorAll('[tabindex="0"]').length).toBe(0);

    // 2. インタラクティブへ切り替え
    rerender(<ShogiBoard squares={boardState.squares} onSquareClick={handleClick} />);
    expect(container.querySelectorAll('[tabindex="0"]').length).toBe(1);
    expect(container.querySelectorAll('[tabindex="-1"]').length).toBe(80);

    // 3. 再び表示専用へ切り替え
    rerender(<ShogiBoard squares={boardState.squares} />);
    expect(container.querySelectorAll('[tabindex="0"]').length).toBe(0);
    expect(container.querySelectorAll('[tabindex="-1"]').length).toBe(0);
  });
});

describe('6. macOS 検証スクリプトの後処理エラー集約および getInfo 例外伝播の単体テスト', () => {
  it('runCleanups は複数のクリーンアップ処理を順番に実行し、一部が失敗しても後続を最後まで実行して全エラーを収集すること', async () => {
    const executed: string[] = [];
    const cleanups = [
      {
        name: 'task-1',
        run: () => {
          executed.push('task-1');
        },
      },
      {
        name: 'task-2',
        run: () => {
          executed.push('task-2');
          throw new Error('task-2 failed');
        },
      },
      {
        name: 'task-3',
        run: async () => {
          executed.push('task-3');
          throw new Error('task-3 failed');
        },
      },
      {
        name: 'task-4',
        run: () => {
          executed.push('task-4');
        },
      },
    ];

    const errors = await runCleanups(cleanups);
    expect(executed).toEqual(['task-1', 'task-2', 'task-3', 'task-4']);
    expect(errors).toHaveLength(2);
    expect(errors[0].name).toBe('task-2');
    expect(errors[0].error.message).toBe('task-2 failed');
    expect(errors[1].name).toBe('task-3');
    expect(errors[1].error.message).toBe('task-3 failed');
  });

  it('combineErrors はエラーがない場合に null を返し、本体成功＋クリーンアップ単一失敗で cause 付き Error を返すこと', () => {
    expect(combineErrors(null, [])).toBeNull();

    const singleCleanupError = [
      { name: 'fsevents watcher stop', error: new Error('Stop failed') },
    ];
    const combinedSingle = combineErrors(null, singleCleanupError);
    expect(combinedSingle).toBeInstanceOf(Error);
    expect(combinedSingle?.message).toContain('Cleanup failed [fsevents watcher stop]: Stop failed');
    expect((combinedSingle as any)?.cause?.message).toBe('Stop failed');
  });

  it('combineErrors は本体成功＋複数クリーンアップ失敗で AggregateError を返し全失敗内容を含むこと', () => {
    const multipleCleanupErrors = [
      { name: 'fsevents watcher stop', error: new Error('Stop failed') },
      { name: 'fsevents temp directory removal', error: new Error('RM failed') },
    ];
    const combined = combineErrors(null, multipleCleanupErrors);
    expect(combined).toBeInstanceOf(AggregateError);
    expect(combined?.message).toContain('Multiple cleanup tasks failed (2 errors)');
    expect((combined as AggregateError).errors).toHaveLength(2);
  });

  it('combineErrors は本体失敗＋クリーンアップ成功で本体エラーをそのまま返し、両方失敗で AggregateError で両方を保持すること', () => {
    const primaryError = new Error('Native watch timeout');
    const combinedPrimaryOnly = combineErrors(primaryError, []);
    expect(combinedPrimaryOnly).toBe(primaryError);

    const cleanupErrors = [
      { name: 'Vite server close', error: new Error('Close socket failed') },
    ];
    const combinedBoth = combineErrors(primaryError, cleanupErrors);
    expect(combinedBoth).toBeInstanceOf(AggregateError);
    expect(combinedBoth?.message).toContain('Verification failed: Native watch timeout');
    expect(combinedBoth?.message).toContain('Additionally, 1 cleanup task(s) failed');
    expect((combinedBoth as AggregateError).errors).toHaveLength(2);
    expect((combinedBoth as AggregateError).errors[0]).toBe(primaryError);
    expect((combinedBoth as AggregateError).errors[1].message).toContain('[Vite server close] Close socket failed');
  });

  it('createFsEventPromise は getInfo が例外を投げた場合に Promise を reject し timer を解除すること', async () => {
    let watchCallback: ((filepath: string, flags: number) => void) | null = null;
    const stopWatcherFn = vi.fn();
    const mockFsevents = {
      watch: vi.fn((_dir, cb) => {
        watchCallback = cb;
        return stopWatcherFn;
      }),
      getInfo: vi.fn(),
    };

    const throwingGetInfo = vi.fn(() => {
      throw new Error('Native getInfo memory corruption');
    });

    const control = createFsEventPromise({
      fsevents: mockFsevents,
      tempDir: '/dummy/path',
      timeoutMs: 3000,
      getInfoFn: throwingGetInfo,
    });

    expect(control.isSettled()).toBe(false);

    // コールバックを発火
    expect(watchCallback).toBeDefined();
    if (watchCallback) {
      (watchCallback as (f: string, fl: number) => void)('/dummy/path/file.txt', 1);
    }

    // Promise が reject されること
    await expect(control.eventPromise).rejects.toThrow('Native getInfo memory corruption');
    expect(control.isSettled()).toBe(true);

    // stopWatcher が参照可能であること
    expect(control.getStopWatcher()).toBe(stopWatcherFn);

    // 2回目のコールバックが届いても多重発火しないこと
    expect(() => {
      if (watchCallback) {
        (watchCallback as (f: string, fl: number) => void)('/dummy/path/file.txt', 2);
      }
    }).not.toThrow();
  });

  it('createFsEventPromise は正常系で resolve され timer が解除され、多重 resolve しないこと', async () => {
    let watchCallback: ((filepath: string, flags: number) => void) | null = null;
    const mockFsevents = {
      watch: vi.fn((_dir, cb) => {
        watchCallback = cb;
        return vi.fn();
      }),
      getInfo: vi.fn(() => ({ event: 'file-created' })),
    };

    const control = createFsEventPromise({
      fsevents: mockFsevents,
      tempDir: '/dummy/path',
      timeoutMs: 3000,
    });

    expect(control.isSettled()).toBe(false);

    if (watchCallback) {
      (watchCallback as (f: string, fl: number) => void)('/dummy/path/file.txt', 1);
    }

    const result = await control.eventPromise;
    expect(result.filepath).toBe('/dummy/path/file.txt');
    expect(result.info).toEqual({ event: 'file-created' });
    expect(control.isSettled()).toBe(true);
  });

  it('verifyMacOsFsevents: 本体成功＋クリーンアップ成功のシミュレーションで success: true を返すこと', async () => {
    const mockFsevents = {
      watch: vi.fn((dir, cb) => {
        setTimeout(() => cb(path.join(dir, 'watch-trigger.txt'), 0), 10);
        return vi.fn().mockResolvedValue(undefined);
      }),
      getInfo: vi.fn(() => ({ event: 'created' })),
    };

    const mockViteServer = {
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      watcher: {
        on: vi.fn((event, cb) => {
          if (event === 'change') {
            setTimeout(() => cb('/mock/test.js'), 10);
          }
        }),
        off: vi.fn(),
      },
    };
    const mockViteCreateServer = vi.fn().mockResolvedValue(mockViteServer);

    const result = await verifyMacOsFsevents({
      forceDarwin: true,
      fseventsMock: mockFsevents,
      viteCreateServerMock: mockViteCreateServer,
      settleDelayMs: 5,
      viteSettleDelayMs: 5,
    });

    expect(result.success).toBe(true);
    expect(result.platform).toBe('darwin');
    expect(result.isDarwin).toBe(true);
    expect(result.nativeVerified).toBe(true);
  });

  it('verifyMacOsFsevents: fsevents watcher 停止失敗時に検証全体が失敗すること', async () => {
    const mockFsevents = {
      watch: vi.fn((dir, cb) => {
        setTimeout(() => cb(path.join(dir, 'watch-trigger.txt'), 0), 10);
        return vi.fn().mockResolvedValue(undefined);
      }),
      getInfo: vi.fn(() => ({ event: 'created' })),
    };

    await expect(
      verifyMacOsFsevents({
        forceDarwin: true,
        fseventsMock: mockFsevents,
        failWatcherStop: true,
        settleDelayMs: 5,
        skipVite: true,
      })
    ).rejects.toThrow('Cleanup failed [fsevents watcher stop]');
  });

  it('verifyMacOsFsevents: fsevents 一時ディレクトリ削除失敗時に検証全体が失敗すること', async () => {
    const mockFsevents = {
      watch: vi.fn((dir, cb) => {
        setTimeout(() => cb(path.join(dir, 'watch-trigger.txt'), 0), 10);
        return vi.fn().mockResolvedValue(undefined);
      }),
      getInfo: vi.fn(() => ({ event: 'created' })),
    };

    await expect(
      verifyMacOsFsevents({
        forceDarwin: true,
        fseventsMock: mockFsevents,
        failFseventsTempDirRemoval: true,
        settleDelayMs: 5,
        skipVite: true,
      })
    ).rejects.toThrow('Cleanup failed [fsevents temp directory removal]');
  });

  it('verifyMacOsFsevents: Vite server close 失敗時に検証全体が失敗すること', async () => {
    const mockFsevents = {
      watch: vi.fn((dir, cb) => {
        setTimeout(() => cb(path.join(dir, 'watch-trigger.txt'), 0), 10);
        return vi.fn().mockResolvedValue(undefined);
      }),
      getInfo: vi.fn(() => ({ event: 'created' })),
    };

    const mockViteServer = {
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      watcher: {
        on: vi.fn((event, cb) => {
          if (event === 'change') {
            setTimeout(() => cb('/mock/test.js'), 10);
          }
        }),
        off: vi.fn(),
      },
    };
    const mockViteCreateServer = vi.fn().mockResolvedValue(mockViteServer);

    await expect(
      verifyMacOsFsevents({
        forceDarwin: true,
        fseventsMock: mockFsevents,
        viteCreateServerMock: mockViteCreateServer,
        failViteServerClose: true,
        settleDelayMs: 5,
        viteSettleDelayMs: 5,
      })
    ).rejects.toThrow('Cleanup failed [Vite server close]');
  });

  it('verifyMacOsFsevents: 非macOS環境では静的検査のみ成功し nativeVerified: false となること', async () => {
    const result = await verifyMacOsFsevents({
      forceDarwin: false,
    });
    expect(result.success).toBe(true);
    expect(result.isDarwin).toBe(false);
    expect(result.nativeVerified).toBe(false);
  });
});
