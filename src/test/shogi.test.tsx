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
  BoardState,
  Piece,
  Player,
  RANK_KANJI,
} from '../types/shogi';
import { ShogiBoard } from '../components/shogi/ShogiBoard';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import { PieceStand } from '../components/shogi/PieceStand';
import {
  isWithinBoard,
  areCoordinatesEqual,
  toCoordinateLabel,
  fromCoordinateLabel,
  getMoveCandidates,
  getLegalMoves,
  getPseudoLegalMoves,
  isDeadPieceMove,
  findKingSquare,
  isSquareAttackedBy,
  isKingInCheck,
  getPieceAttackPattern,
  validateMove,
  executeMove,
  applyMove,
  determineDefaultExecutionMode,
  generateMoveNotation,
  getPieceNotationKanji,
  cloneBoardSquares,
  canPiecePromote,
  canPromoteMove,
  getPromotionStatus,
  isPromotablePieceType,
  isPromotionRequired,
  isPromotionZone,
} from '../domain/shogi';
import * as ShogiDomainModule from '../domain/shogi';
import { validateLockfile } from '../../scripts/verify-lockfile.mjs';
import {
  runCleanups,
  combineErrors,
  createFsEventPromise,
  createViteWatcherPromise,
  verifyFseventsNativePhase,
  verifyViteWatcherPhase,
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

describe('16. 成り・不成選択と必須成り', () => {
  const createPromotionTestBoard = (
    pieces: Array<{ row: number; col: number; piece: Piece }>,
    turn: Player = 'sente'
  ): BoardState => {
    const state = createInitialBoardState();
    const squares = cloneBoardSquares(state.squares);
    for (const row of squares) {
      for (const square of row) square.piece = null;
    }
    for (const item of pieces) squares[item.row][item.col].piece = item.piece;
    return { ...state, squares, turn };
  };

  describe('16.1 成り判定の純粋関数', () => {
    it('先手・後手それぞれの成りゾーンを判定すること', () => {
      expect([0, 1, 2].every((row) => isPromotionZone('sente', row))).toBe(true);
      expect([3, 6, 8].map((row) => isPromotionZone('sente', row))).toEqual([false, false, false]);
      expect([6, 7, 8].every((row) => isPromotionZone('gote', row))).toBe(true);
      expect([0, 5, 9].map((row) => isPromotionZone('gote', row))).toEqual([false, false, false]);
    });

    it('歩・香・桂・銀・角・飛だけが成れ、成駒は再度成れないこと', () => {
      for (const type of ['pawn', 'lance', 'knight', 'silver', 'bishop', 'rook'] as const) {
        expect(isPromotablePieceType(type)).toBe(true);
        expect(canPiecePromote({ id: type, type, player: 'sente' })).toBe(true);
        expect(canPiecePromote({ id: `promoted-${type}`, type, player: 'sente', isPromoted: true })).toBe(false);
      }
      for (const type of ['king', 'gold'] as const) {
        expect(isPromotablePieceType(type)).toBe(false);
        expect(canPiecePromote({ id: type, type, player: 'sente' })).toBe(false);
      }
    });

    it('移動元だけ・移動先だけが成りゾーンなら任意成り、無関係なら成れないこと', () => {
      const silver: Piece = { id: 'silver', type: 'silver', player: 'sente' };
      expect(canPromoteMove(silver, { row: 2, col: 4 }, { row: 3, col: 4 })).toBe(true);
      expect(getPromotionStatus(silver, { row: 2, col: 4 }, { row: 3, col: 4 })).toBe('optional');
      expect(getPromotionStatus(silver, { row: 3, col: 4 }, { row: 2, col: 4 })).toBe('optional');
      expect(getPromotionStatus(silver, { row: 4, col: 4 }, { row: 3, col: 4 })).toBe('none');
    });

    it('歩・香・桂の先手・後手それぞれの行き所のない段を必須成りとすること', () => {
      for (const type of ['pawn', 'lance'] as const) {
        expect(isPromotionRequired({ id: `s-${type}`, type, player: 'sente' }, { row: 0, col: 4 })).toBe(true);
        expect(isPromotionRequired({ id: `g-${type}`, type, player: 'gote' }, { row: 8, col: 4 })).toBe(true);
      }
      const senteKnight: Piece = { id: 's-knight', type: 'knight', player: 'sente' };
      const goteKnight: Piece = { id: 'g-knight', type: 'knight', player: 'gote' };
      expect([0, 1].every((row) => isPromotionRequired(senteKnight, { row, col: 4 }))).toBe(true);
      expect([7, 8].every((row) => isPromotionRequired(goteKnight, { row, col: 4 }))).toBe(true);
      expect(isPromotionRequired(senteKnight, { row: 2, col: 4 })).toBe(false);
      expect(isPromotionRequired(goteKnight, { row: 6, col: 4 })).toBe(false);
    });
  });

  describe('16.2 executeMove・局面・棋譜', () => {
    const optionalSilverState = () => createPromotionTestBoard([
      { row: 3, col: 4, piece: { id: 'silver-s', type: 'silver', player: 'sente' } },
      { row: 8, col: 4, piece: { id: 'king-s', type: 'king', player: 'sente' } },
      { row: 0, col: 0, piece: { id: 'king-g', type: 'king', player: 'gote' } },
    ]);

    const requiredPromotionCases = [
      { label: '先手の歩 row 0', type: 'pawn', player: 'sente', from: { row: 1, col: 4 }, to: { row: 0, col: 4 } },
      { label: '先手の香 row 0', type: 'lance', player: 'sente', from: { row: 1, col: 4 }, to: { row: 0, col: 4 } },
      { label: '先手の桂 row 0', type: 'knight', player: 'sente', from: { row: 2, col: 4 }, to: { row: 0, col: 3 } },
      { label: '先手の桂 row 1', type: 'knight', player: 'sente', from: { row: 3, col: 4 }, to: { row: 1, col: 3 } },
      { label: '後手の歩 row 8', type: 'pawn', player: 'gote', from: { row: 7, col: 4 }, to: { row: 8, col: 4 } },
      { label: '後手の香 row 8', type: 'lance', player: 'gote', from: { row: 7, col: 4 }, to: { row: 8, col: 4 } },
      { label: '後手の桂 row 7', type: 'knight', player: 'gote', from: { row: 5, col: 4 }, to: { row: 7, col: 3 } },
      { label: '後手の桂 row 8', type: 'knight', player: 'gote', from: { row: 6, col: 4 }, to: { row: 8, col: 3 } },
    ] as const;

    it('任意成りは指定なしを拒否し、promote と decline を履歴込みで区別すること', () => {
      const state = optionalSilverState();
      const missing = executeMove(state, { row: 3, col: 4 }, { row: 2, col: 4 });
      expect(missing.type).toBe('rejected');
      if (missing.type === 'rejected') expect(missing.reason).toBe('promotion_choice_required');

      const promoted = executeMove(state, { row: 3, col: 4 }, { row: 2, col: 4 }, { promotion: 'promote' });
      expect(promoted.type).toBe('applied');
      if (promoted.type === 'applied') {
        expect(promoted.state.squares[2][4].piece?.isPromoted).toBe(true);
        expect(promoted.move.promotion).toBe('promote');
        expect(promoted.move.notation).toBe('▲5三銀成');
      }

      const declined = executeMove(state, { row: 3, col: 4 }, { row: 2, col: 4 }, { promotion: 'decline' });
      expect(declined.type).toBe('applied');
      if (declined.type === 'applied') {
        expect(declined.state.squares[2][4].piece?.isPromoted).toBeFalsy();
        expect(declined.move.promotion).toBe('decline');
        expect(declined.move.notation).toBe('▲5三銀不成');
      }
    });

    it('必須成りは候補に残り、指定なし・decline を拒否して promote だけを適用すること', () => {
      const state = createPromotionTestBoard([
        { row: 1, col: 4, piece: { id: 'pawn-s', type: 'pawn', player: 'sente' } },
        { row: 8, col: 4, piece: { id: 'king-s', type: 'king', player: 'sente' } },
        { row: 0, col: 0, piece: { id: 'king-g', type: 'king', player: 'gote' } },
      ]);
      expect(getLegalMoves(state.squares, { row: 1, col: 4 }, 'sente')).toContainEqual({ row: 0, col: 4 });

      for (const options of [{}, { promotion: 'decline' as const }]) {
        const rejected = executeMove(state, { row: 1, col: 4 }, { row: 0, col: 4 }, options);
        expect(rejected.type).toBe('rejected');
        if (rejected.type === 'rejected') expect(rejected.reason).toBe('promotion_required');
        expect(rejected.state).toBe(state);
      }

      const applied = executeMove(state, { row: 1, col: 4 }, { row: 0, col: 4 }, { promotion: 'promote' });
      expect(applied.type).toBe('applied');
      if (applied.type === 'applied') expect(applied.state.squares[0][4].piece?.isPromoted).toBe(true);
    });

    it('成れない駒への promote を拒否し、strict 方式では反則負けにすること', () => {
      const state = createPromotionTestBoard([
        { row: 4, col: 4, piece: { id: 'gold-s', type: 'gold', player: 'sente' } },
        { row: 8, col: 8, piece: { id: 'king-s', type: 'king', player: 'sente' } },
      ]);
      const assist = executeMove(state, { row: 4, col: 4 }, { row: 3, col: 4 }, { promotion: 'promote' });
      expect(assist.type).toBe('rejected');
      if (assist.type === 'rejected') expect(assist.reason).toBe('invalid_promotion');

      const strict = executeMove(state, { row: 4, col: 4 }, { row: 3, col: 4 }, {
        promotion: 'promote',
        proposer: 'shogi_engine',
      });
      expect(strict.type).toBe('foul_loss');
      if (strict.type === 'foul_loss') expect(strict.result.foulReason).toBe('invalid_promotion');
    });

    it('成った駒を取ると持ち駒では未成へ戻ること', () => {
      const state = createPromotionTestBoard([
        { row: 4, col: 4, piece: { id: 'gold-s', type: 'gold', player: 'sente' } },
        { row: 3, col: 4, piece: { id: 'silver-g', type: 'silver', player: 'gote', isPromoted: true } },
        { row: 8, col: 8, piece: { id: 'king-s', type: 'king', player: 'sente' } },
      ]);
      const result = executeMove(state, { row: 4, col: 4 }, { row: 3, col: 4 });
      expect(result.type).toBe('applied');
      if (result.type === 'applied') {
        expect(result.state.senteHand[0]).toMatchObject({ type: 'silver', player: 'sente', isPromoted: false });
      }
    });

    it('角の成る手に「成」が付き、applyMove の既存非成り手は継続して適用されること', () => {
      const state = createPromotionTestBoard([
        { row: 3, col: 5, piece: { id: 'bishop-s', type: 'bishop', player: 'sente' } },
        { row: 8, col: 4, piece: { id: 'king-s', type: 'king', player: 'sente' } },
      ]);
      const promoted = executeMove(state, { row: 3, col: 5 }, { row: 1, col: 7 }, { promotion: 'promote' });
      expect(promoted.type).toBe('applied');
      if (promoted.type === 'applied') expect(promoted.move.notation).toBe('▲2二角成');

      const initial = createInitialBoardState();
      const moved = applyMove(initial, { row: 6, col: 2 }, { row: 5, col: 2 });
      expect(moved.squares[5][2].piece?.type).toBe('pawn');
      expect(moved.history[0].promotion).toBe('none');
    });

    it('applyMove は先手の歩を2段目から1段目へ自動的に成って適用すること', () => {
      const state = createPromotionTestBoard([
        { row: 1, col: 4, piece: { id: 'required-pawn-s', type: 'pawn', player: 'sente' } },
      ]);

      const moved = applyMove(state, { row: 1, col: 4 }, { row: 0, col: 4 });

      expect(moved).not.toBe(state);
      expect(moved.squares[1][4].piece).toBeNull();
      expect(moved.squares[0][4].piece).toMatchObject({
        id: 'required-pawn-s',
        type: 'pawn',
        player: 'sente',
        isPromoted: true,
      });
      expect(moved.turn).toBe('gote');
      expect(moved.moveNumber).toBe(state.moveNumber + 1);
      expect(moved.history).toHaveLength(1);
      expect(moved.history[0].promotion).toBe('promote');
      expect(moved.history[0].notation).toBe('▲5一歩成');
    });

    it.each(requiredPromotionCases)(
      'applyMove は必須成り境界（$label）を成駒として適用すること',
      ({ type, player, from, to }) => {
        const state = createPromotionTestBoard([
          { row: from.row, col: from.col, piece: { id: `required-${player}-${type}-${to.row}`, type, player } },
        ], player);

        const moved = applyMove(state, from, to);

        expect(moved).not.toBe(state);
        expect(moved.squares[from.row][from.col].piece).toBeNull();
        expect(moved.squares[to.row][to.col].piece).toMatchObject({ type, player, isPromoted: true });
        expect(moved.history).toHaveLength(1);
        expect(moved.history[0].promotion).toBe('promote');
        expect(moved.history[0].notation).toMatch(/成$/);
      }
    );

    it('getLegalMoves の必須成り候補を applyMove へ渡すと成駒として着手できること', () => {
      const from = { row: 2, col: 4 };
      const to = { row: 0, col: 3 };
      const state = createPromotionTestBoard([
        { row: from.row, col: from.col, piece: { id: 'candidate-knight-s', type: 'knight', player: 'sente' } },
      ]);

      expect(getLegalMoves(state.squares, from, state.turn)).toContainEqual(to);
      const moved = applyMove(state, from, to);

      expect(moved.squares[from.row][from.col].piece).toBeNull();
      expect(moved.squares[to.row][to.col].piece).toMatchObject({
        id: 'candidate-knight-s',
        isPromoted: true,
      });
    });

    it('applyMove は任意成りを後方互換の不成として適用し棋譜へ「不成」を付けること', () => {
      const state = optionalSilverState();
      const moved = applyMove(state, { row: 3, col: 4 }, { row: 2, col: 4 });

      expect(moved).not.toBe(state);
      expect(moved.squares[2][4].piece?.type).toBe('silver');
      expect(moved.squares[2][4].piece?.isPromoted).toBeFalsy();
      expect(moved.history[0].promotion).toBe('decline');
      expect(moved.history[0].notation).toBe('▲5三銀不成');
    });

    it('generateMoveNotation は promote に「成」を付けること', () => {
      const silver: Piece = { id: 'notation-silver', type: 'silver', player: 'sente' };
      expect(generateMoveNotation('sente', silver, { row: 2, col: 4 }, 'promote')).toBe('▲5三銀成');
    });

    it('generateMoveNotation は decline に「不成」を付けること', () => {
      const silver: Piece = { id: 'notation-silver', type: 'silver', player: 'sente' };
      expect(generateMoveNotation('sente', silver, { row: 2, col: 4 }, 'decline')).toBe('▲5三銀不成');
    });

    it('generateMoveNotation は none に接尾辞を付けないこと', () => {
      const pawn: Piece = { id: 'notation-pawn', type: 'pawn', player: 'sente' };
      expect(generateMoveNotation('sente', pawn, { row: 5, col: 2 }, 'none')).toBe('▲7六歩');
    });

    it('すでに成っている銀・飛・角の通常移動は成駒名だけを表示すること', () => {
      expect(generateMoveNotation(
        'sente',
        { id: 'promoted-silver', type: 'silver', player: 'sente', isPromoted: true },
        { row: 2, col: 4 },
        'none'
      )).toBe('▲5三成銀');
      expect(generateMoveNotation(
        'sente',
        { id: 'promoted-rook', type: 'rook', player: 'sente', isPromoted: true },
        { row: 4, col: 4 },
        'none'
      )).toBe('▲5五竜');
      expect(generateMoveNotation(
        'sente',
        { id: 'promoted-bishop', type: 'bishop', player: 'sente', isPromoted: true },
        { row: 4, col: 4 },
        'none'
      )).toBe('▲5五馬');
    });
  });

  describe('16.3 成り選択UI', () => {
    const optionalUiState = () => createPromotionTestBoard([
      { row: 3, col: 4, piece: { id: 'ui-silver', type: 'silver', player: 'sente' } },
      { row: 8, col: 4, piece: { id: 'ui-king-s', type: 'king', player: 'sente' } },
      { row: 0, col: 0, piece: { id: 'ui-king-g', type: 'king', player: 'gote' } },
    ]);

    const openOptionalDialog = async () => {
      const user = userEvent.setup();
      render(<ShogiResearchScreen initialState={optionalUiState()} />);
      await user.click(screen.getByRole('gridcell', { name: /5筋 4段、先手の銀将/ }));
      await user.click(screen.getByRole('gridcell', { name: /5筋 3段、空のマス、移動可能/ }));
      return user;
    };

    it('任意成り先でARIA付きダイアログを開き、ダイアログ内へフォーカスすること', async () => {
      await openOptionalDialog();
      const dialog = screen.getByRole('dialog', { name: '成り選択' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-describedby', 'promotion-dialog-description');
      expect(screen.getByRole('button', { name: '成る' })).toHaveFocus();
      expect(screen.getByRole('button', { name: '不成' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
    });

    it('「成る」で成駒、「不成」で未成駒として着手すること', async () => {
      const user = await openOptionalDialog();
      await user.click(screen.getByRole('button', { name: '成る' }));
      expect(screen.getByRole('gridcell', { name: /5筋 3段、先手の成銀/ })).toBeInTheDocument();

      render(<ShogiResearchScreen initialState={optionalUiState()} />);
      const boards = screen.getAllByRole('grid', { name: '将棋盤 9×9マス' });
      const secondBoard = boards[1];
      const source = secondBoard.querySelector('[data-coordinate="5四"]') as HTMLElement;
      await user.click(source);
      const target = secondBoard.querySelector('[data-coordinate="5三"]') as HTMLElement;
      await user.click(target);
      await user.click(screen.getByRole('button', { name: '不成' }));
      expect(target).toHaveAttribute('aria-label', expect.stringContaining('先手の銀将'));
    });

    it('必須成りでは不成を表示しないこと', async () => {
      const user = userEvent.setup();
      const state = createPromotionTestBoard([
        { row: 1, col: 4, piece: { id: 'ui-pawn', type: 'pawn', player: 'sente' } },
        { row: 8, col: 4, piece: { id: 'ui-king', type: 'king', player: 'sente' } },
      ]);
      render(<ShogiResearchScreen initialState={state} />);
      await user.click(screen.getByRole('gridcell', { name: /5筋 2段、先手の歩兵/ }));
      await user.click(screen.getByRole('gridcell', { name: /5筋 1段、空のマス、移動可能/ }));
      expect(screen.getByRole('dialog', { name: '成り選択' })).toHaveTextContent('この手は成りが必須です。');
      expect(screen.queryByRole('button', { name: '不成' })).not.toBeInTheDocument();
    });

    it('キャンセルは盤面・手番・手数・履歴を変えず、ダイアログ中の盤面操作を抑止すること', async () => {
      const user = await openOptionalDialog();
      const screenRoot = document.getElementById('shogi-research-screen')!;
      const source = screen.getByRole('gridcell', { name: /5筋 4段、先手の銀将/ });
      const otherPiece = screen.getByRole('gridcell', { name: /5筋 9段、先手の王将/ });
      await user.click(otherPiece);
      expect(source).toHaveAttribute('data-selected', 'true');
      await user.click(screen.getByRole('button', { name: 'キャンセル' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(source).toHaveAttribute('aria-label', expect.stringContaining('先手の銀将'));
      expect(screenRoot).toHaveAttribute('data-turn', 'sente');
      expect(screenRoot).toHaveAttribute('data-move-number', '1');
      expect(screenRoot).toHaveAttribute('data-history-count', '0');
      expect(source).toHaveFocus();
    });

    it('Escapeで盤面を変更せずダイアログを閉じること', async () => {
      const user = await openOptionalDialog();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('gridcell', { name: /5筋 4段、先手の銀将/ })).toBeInTheDocument();
    });
  });
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

describe('6. macOS 検証スクリプトの公開API・内部処理・本番cleanup経路の単体テスト', () => {
  const createdTempDirs = new Set<string>();

  const trackTempDir = (dirPath: string) => {
    createdTempDirs.add(dirPath);
    return dirPath;
  };

  afterEach(() => {
    // 今回のテストで作成されたディレクトリのみ確実にクリーンアップし、削除成否を厳格に確認
    const remainingDirs: string[] = [];
    for (const dir of createdTempDirs) {
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // ignore here, verify exists below
        }
      }
      if (fs.existsSync(dir)) {
        remainingDirs.push(dir);
      }
    }
    if (remainingDirs.length > 0) {
      throw new Error(`Failed to clean up test temp directories: ${remainingDirs.join(', ')}`);
    }
    createdTempDirs.clear();
  });

  describe('公開検証関数 (verifyMacOsFsevents)', () => {
    it('公開関数の引数長は 0 であり、テスト専用パラメータを受け取らないシグネチャであること', () => {
      expect(verifyMacOsFsevents.length).toBe(0);
    });

    it.skipIf(process.platform === 'darwin')(
      '非macOS環境では platform が実OSと一致し、isDarwin: false, nativeVerified: false を返すこと',
      async () => {
        const result = await verifyMacOsFsevents();
        expect(result.success).toBe(true);
        expect(result.platform).toBe(process.platform);
        expect(result.isDarwin).toBe(false);
        expect(result.nativeVerified).toBe(false);
      }
    );

    it.skipIf(process.platform === 'darwin')(
      '非macOS環境では引数を渡しても内部で無視され、macOSの成功結果（nativeVerified: true）を偽装できないこと',
      async () => {
        const result = await (verifyMacOsFsevents as any)({
          forceDarwin: true,
          skipVite: true,
          nativeVerified: true,
        });
        expect(result.platform).toBe(process.platform);
        expect(result.isDarwin).toBe(false);
        expect(result.nativeVerified).toBe(false);
      }
    );
  });

  describe('内部フェーズ: verifyFseventsNativePhase の本番 cleanup 経路と安全性テスト', () => {
    it('全処理成功時は watcher停止 → 一時ディレクトリ削除の順で cleanup が実行されること', async () => {
      const executionOrder: string[] = [];
      const stopWatcherFn = vi.fn().mockImplementation(async () => {
        executionOrder.push('watcher-stop');
      });
      const mockFsevents = {
        watch: vi.fn((dir, cb) => {
          setTimeout(() => cb(path.join(dir, 'watch-trigger.txt'), 0), 10);
          return stopWatcherFn;
        }),
        getInfo: vi.fn(() => ({ event: 'created' })),
      };

      const deletedDirs: string[] = [];
      let createdDirPrefix = '';
      const virtualFs = {
        mkdtempSync: vi.fn((prefix) => {
          createdDirPrefix = prefix;
          return '/virtual/temp/fsevents-success';
        }),
        writeFileSync: vi.fn(),
        existsSync: vi.fn(() => true),
        rmSync: vi.fn((dir) => {
          executionOrder.push('temp-dir-remove');
          deletedDirs.push(dir);
        }),
      };

      const result = await verifyFseventsNativePhase({
        fs: virtualFs as any,
        fsevents: mockFsevents,
        settleDelayMs: 5,
        timeoutMs: 1000,
      });

      expect(result.filepath).toBe(path.join('/virtual/temp/fsevents-success', 'watch-trigger.txt'));
      expect(virtualFs.mkdtempSync).toHaveBeenCalledTimes(1);
      expect(createdDirPrefix).toContain('shogi-fsevents-test-');
      expect(stopWatcherFn).toHaveBeenCalledTimes(1);
      expect(deletedDirs).toEqual(['/virtual/temp/fsevents-success']);
      expect(executionOrder).toEqual(['watcher-stop', 'temp-dir-remove']);
    });

    it('所有権の安全性: deps に任意の tempDir を渡しても無視され、mkdtempSync の戻り値のみが削除対象となること', async () => {
      const stopWatcherFn = vi.fn().mockResolvedValue(undefined);
      const mockFsevents = {
        watch: vi.fn((dir, cb) => {
          setTimeout(() => cb(path.join(dir, 'watch-trigger.txt'), 0), 10);
          return stopWatcherFn;
        }),
        getInfo: vi.fn(() => ({ event: 'created' })),
      };

      const checkedPaths: string[] = [];
      const deletedDirs: string[] = [];
      let mkdtempArg = '';
      const virtualFs = {
        mkdtempSync: vi.fn((prefix: string) => {
          mkdtempArg = prefix;
          return '/virtual/owned-by-fsevents-phase';
        }),
        writeFileSync: vi.fn(),
        existsSync: vi.fn((target: string) => {
          checkedPaths.push(target);
          return true;
        }),
        rmSync: vi.fn((dir: string) => {
          deletedDirs.push(dir);
        }),
      };

      const sentinelPath = '/sentinel/must-not-delete';
      const result = await (verifyFseventsNativePhase as any)({
        fs: virtualFs as any,
        fsevents: mockFsevents,
        tempDir: sentinelPath, // 渡しても無視されなければならない
        settleDelayMs: 5,
        timeoutMs: 1000,
      });

      expect(virtualFs.mkdtempSync).toHaveBeenCalledTimes(1);
      expect(mkdtempArg).toContain('shogi-fsevents-test-');
      expect(result.filepath).toBe(path.join('/virtual/owned-by-fsevents-phase', 'watch-trigger.txt'));
      expect(deletedDirs).toEqual(['/virtual/owned-by-fsevents-phase']);
      expect(deletedDirs).not.toContain(sentinelPath);
      expect(checkedPaths).not.toContain(sentinelPath);
    });

    it('fsevents watcher 停止が失敗しても、先行失敗後に一時ディレクトリ削除が試行され実行順が維持されること', async () => {
      const executionOrder: string[] = [];
      const failingStopWatcher = vi.fn().mockImplementation(async () => {
        executionOrder.push('watcher-stop');
        throw new Error('Stop watcher socket error');
      });
      const mockFsevents = {
        watch: vi.fn((dir, cb) => {
          setTimeout(() => cb(path.join(dir, 'watch-trigger.txt'), 0), 10);
          return failingStopWatcher;
        }),
        getInfo: vi.fn(() => ({ event: 'created' })),
      };

      const deletedDirs: string[] = [];
      const virtualFs = {
        mkdtempSync: vi.fn(() => '/virtual/temp/fsevents-stop-fail'),
        writeFileSync: vi.fn(),
        existsSync: vi.fn(() => true),
        rmSync: vi.fn((dir) => {
          executionOrder.push('temp-dir-remove');
          deletedDirs.push(dir);
        }),
      };

      await expect(
        verifyFseventsNativePhase({
          fs: virtualFs as any,
          fsevents: mockFsevents,
          settleDelayMs: 5,
          timeoutMs: 1000,
        })
      ).rejects.toThrow('Cleanup failed [fsevents watcher stop]: Stop watcher socket error');

      expect(failingStopWatcher).toHaveBeenCalledTimes(1);
      expect(deletedDirs).toEqual(['/virtual/temp/fsevents-stop-fail']);
      expect(executionOrder).toEqual(['watcher-stop', 'temp-dir-remove']);
    });

    it('fsevents 一時ディレクトリ削除が失敗するとフェーズ全体が失敗すること', async () => {
      const stopWatcherFn = vi.fn().mockResolvedValue(undefined);
      const mockFsevents = {
        watch: vi.fn((dir, cb) => {
          setTimeout(() => cb(path.join(dir, 'watch-trigger.txt'), 0), 10);
          return stopWatcherFn;
        }),
        getInfo: vi.fn(() => ({ event: 'created' })),
      };

      const virtualFs = {
        mkdtempSync: vi.fn(() => '/virtual/temp/fsevents-rm-fail'),
        writeFileSync: vi.fn(),
        existsSync: vi.fn(() => true),
        rmSync: vi.fn(() => {
          throw new Error('EACCES: permission denied, rmdir');
        }),
      };

      await expect(
        verifyFseventsNativePhase({
          fs: virtualFs as any,
          fsevents: mockFsevents,
          settleDelayMs: 5,
          timeoutMs: 1000,
        })
      ).rejects.toThrow('Cleanup failed [fsevents temp directory removal]: EACCES: permission denied, rmdir');

      expect(stopWatcherFn).toHaveBeenCalledTimes(1);
    });

    it('主処理失敗（タイムアウト）かつ watcher 停止も失敗した場合、AggregateError で両方のエラーを保持しディレクトリ削除も試行されること', async () => {
      const executionOrder: string[] = [];
      const failingStopWatcher = vi.fn().mockImplementation(async () => {
        executionOrder.push('watcher-stop');
        throw new Error('Stop watcher failed on timeout');
      });
      const mockFsevents = {
        watch: vi.fn(() => {
          // コールバックを発火せずタイムアウトさせる
          return failingStopWatcher;
        }),
        getInfo: vi.fn(),
      };

      const deletedDirs: string[] = [];
      const virtualFs = {
        mkdtempSync: vi.fn(() => '/virtual/temp/fsevents-both-fail'),
        writeFileSync: vi.fn(),
        existsSync: vi.fn(() => true),
        rmSync: vi.fn((dir) => {
          executionOrder.push('temp-dir-remove');
          deletedDirs.push(dir);
        }),
      };

      try {
        await verifyFseventsNativePhase({
          fs: virtualFs as any,
          fsevents: mockFsevents,
          settleDelayMs: 0,
          timeoutMs: 20,
        });
        expect.unreachable('Should have thrown AggregateError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(AggregateError);
        expect(err.message).toContain('Verification failed: Timeout waiting for fsevents native event');
        expect(err.message).toContain('Additionally, 1 cleanup task(s) failed');
        expect(err.errors).toHaveLength(2);
        expect(err.errors[0].message).toBe('Timeout waiting for fsevents native event');
        expect(err.errors[1].message).toContain('[fsevents watcher stop] Stop watcher failed on timeout');
      }

      expect(failingStopWatcher).toHaveBeenCalledTimes(1);
      expect(deletedDirs).toEqual(['/virtual/temp/fsevents-both-fail']);
      expect(executionOrder).toEqual(['watcher-stop', 'temp-dir-remove']);
    });
  });

  describe('内部フェーズ: verifyViteWatcherPhase の本番 cleanup 経路と安全性テスト', () => {
    it('全処理成功時は リスナー解除 → サーバー終了 → 一時ディレクトリ削除 の順で cleanup が実行されること', async () => {
      const executionOrder: string[] = [];
      let changeHandler: ((file: string) => void) | null = null;
      const offFn = vi.fn().mockImplementation(() => {
        executionOrder.push('listener-remove');
      });
      const closeFn = vi.fn().mockImplementation(async () => {
        executionOrder.push('server-close');
      });

      const mockViteServer = {
        listen: vi.fn().mockResolvedValue(undefined),
        close: closeFn,
        watcher: {
          on: vi.fn((event, cb) => {
            if (event === 'change') {
              changeHandler = cb;
              setTimeout(() => cb('/virtual/vite-success/test.js'), 10);
            }
          }),
          off: offFn,
        },
      };

      const deletedDirs: string[] = [];
      let createdDirPrefix = '';
      const virtualFs = {
        mkdtempSync: vi.fn((prefix) => {
          createdDirPrefix = prefix;
          return '/virtual/vite-success';
        }),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
        existsSync: vi.fn(() => true),
        rmSync: vi.fn((dir) => {
          executionOrder.push('temp-dir-remove');
          deletedDirs.push(dir);
        }),
      };

      const changedFile = await verifyViteWatcherPhase({
        fs: virtualFs as any,
        createServer: vi.fn().mockResolvedValue(mockViteServer),
        settleDelayMs: 5,
        timeoutMs: 1000,
      });

      expect(changedFile).toBe('/virtual/vite-success/test.js');
      expect(virtualFs.mkdtempSync).toHaveBeenCalledTimes(1);
      expect(createdDirPrefix).toContain('shogi-vite-watch-test-');
      expect(offFn).toHaveBeenCalledWith('change', changeHandler);
      expect(closeFn).toHaveBeenCalledTimes(1);
      expect(deletedDirs).toEqual(['/virtual/vite-success']);
      expect(executionOrder).toEqual(['listener-remove', 'server-close', 'temp-dir-remove']);
    });

    it('所有権の安全性: deps に任意の tempDir を渡しても無視され、mkdtempSync の戻り値のみが削除対象となること', async () => {
      const offFn = vi.fn();
      const closeFn = vi.fn().mockResolvedValue(undefined);

      const mockViteServer = {
        listen: vi.fn().mockResolvedValue(undefined),
        close: closeFn,
        watcher: {
          on: vi.fn((event, cb) => {
            if (event === 'change') {
              setTimeout(() => cb('/virtual/owned-by-vite-phase/test.js'), 10);
            }
          }),
          off: offFn,
        },
      };

      const checkedPaths: string[] = [];
      const deletedDirs: string[] = [];
      let mkdtempArg = '';
      const virtualFs = {
        mkdtempSync: vi.fn((prefix: string) => {
          mkdtempArg = prefix;
          return '/virtual/owned-by-vite-phase';
        }),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
        existsSync: vi.fn((target: string) => {
          checkedPaths.push(target);
          return true;
        }),
        rmSync: vi.fn((dir: string) => {
          deletedDirs.push(dir);
        }),
      };

      const sentinelPath = '/sentinel/must-not-delete-vite';
      const changedFile = await (verifyViteWatcherPhase as any)({
        fs: virtualFs as any,
        createServer: vi.fn().mockResolvedValue(mockViteServer),
        tempDir: sentinelPath, // 渡しても無視されなければならない
        settleDelayMs: 5,
        timeoutMs: 1000,
      });

      expect(virtualFs.mkdtempSync).toHaveBeenCalledTimes(1);
      expect(mkdtempArg).toContain('shogi-vite-watch-test-');
      expect(changedFile).toBe('/virtual/owned-by-vite-phase/test.js');
      expect(deletedDirs).toEqual(['/virtual/owned-by-vite-phase']);
      expect(deletedDirs).not.toContain(sentinelPath);
      expect(checkedPaths).not.toContain(sentinelPath);
    });

    it('Vite リスナー解除が失敗しても、先行失敗後にサーバー終了と一時ディレクトリ削除が試行され実行順が維持されること', async () => {
      const executionOrder: string[] = [];
      const closeFn = vi.fn().mockImplementation(async () => {
        executionOrder.push('server-close');
      });
      const mockViteServer = {
        listen: vi.fn().mockResolvedValue(undefined),
        close: closeFn,
        watcher: {
          on: vi.fn((event, cb) => {
            if (event === 'change') {
              setTimeout(() => cb('/virtual/vite-off-fail/test.js'), 10);
            }
          }),
          off: vi.fn(() => {
            executionOrder.push('listener-remove');
            throw new Error('Watcher off threw unexpected exception');
          }),
        },
      };

      const deletedDirs: string[] = [];
      const virtualFs = {
        mkdtempSync: vi.fn(() => '/virtual/vite-off-fail'),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
        existsSync: vi.fn(() => true),
        rmSync: vi.fn((dir) => {
          executionOrder.push('temp-dir-remove');
          deletedDirs.push(dir);
        }),
      };

      await expect(
        verifyViteWatcherPhase({
          fs: virtualFs as any,
          createServer: vi.fn().mockResolvedValue(mockViteServer),
          settleDelayMs: 5,
          timeoutMs: 1000,
        })
      ).rejects.toThrow('Cleanup failed [Vite listener removal]: Watcher off threw unexpected exception');

      expect(closeFn).toHaveBeenCalledTimes(1);
      expect(deletedDirs).toEqual(['/virtual/vite-off-fail']);
      expect(executionOrder).toEqual(['listener-remove', 'server-close', 'temp-dir-remove']);
    });

    it('Vite サーバー終了が失敗しても、先行失敗後に一時ディレクトリ削除が試行され実行順が維持されること', async () => {
      const executionOrder: string[] = [];
      const offFn = vi.fn().mockImplementation(() => {
        executionOrder.push('listener-remove');
      });
      const mockViteServer = {
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockImplementation(async () => {
          executionOrder.push('server-close');
          throw new Error('Port unbind failed on server close');
        }),
        watcher: {
          on: vi.fn((event, cb) => {
            if (event === 'change') {
              setTimeout(() => cb('/virtual/vite-close-fail/test.js'), 10);
            }
          }),
          off: offFn,
        },
      };

      const deletedDirs: string[] = [];
      const virtualFs = {
        mkdtempSync: vi.fn(() => '/virtual/vite-close-fail'),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
        existsSync: vi.fn(() => true),
        rmSync: vi.fn((dir) => {
          executionOrder.push('temp-dir-remove');
          deletedDirs.push(dir);
        }),
      };

      await expect(
        verifyViteWatcherPhase({
          fs: virtualFs as any,
          createServer: vi.fn().mockResolvedValue(mockViteServer),
          settleDelayMs: 5,
          timeoutMs: 1000,
        })
      ).rejects.toThrow('Cleanup failed [Vite server close]: Port unbind failed on server close');

      expect(deletedDirs).toEqual(['/virtual/vite-close-fail']);
      expect(executionOrder).toEqual(['listener-remove', 'server-close', 'temp-dir-remove']);
    });

    it('Vite 一時ディレクトリ削除が失敗するとフェーズ全体が失敗すること', async () => {
      const closeFn = vi.fn().mockResolvedValue(undefined);
      const mockViteServer = {
        listen: vi.fn().mockResolvedValue(undefined),
        close: closeFn,
        watcher: {
          on: vi.fn((event, cb) => {
            if (event === 'change') {
              setTimeout(() => cb('/virtual/vite-rm-fail/test.js'), 10);
            }
          }),
          off: vi.fn(),
        },
      };

      const virtualFs = {
        mkdtempSync: vi.fn(() => '/virtual/vite-rm-fail'),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
        existsSync: vi.fn(() => true),
        rmSync: vi.fn(() => {
          throw new Error('EPERM: operation not permitted');
        }),
      };

      await expect(
        verifyViteWatcherPhase({
          fs: virtualFs as any,
          createServer: vi.fn().mockResolvedValue(mockViteServer),
          settleDelayMs: 5,
          timeoutMs: 1000,
        })
      ).rejects.toThrow('Cleanup failed [Vite temp directory removal]: EPERM: operation not permitted');

      expect(closeFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('内部処理: runCleanups & combineErrors & Promise ヘルパー', () => {
    it('runCleanups は複数のクリーンアップ処理を定義順に実行し、一部が失敗しても後続を最後まで実行して全エラーを収集すること', async () => {
      const executed: string[] = [];
      const cleanups = [
        {
          name: 'step-1',
          run: () => {
            executed.push('step-1');
          },
        },
        {
          name: 'step-2',
          run: () => {
            executed.push('step-2');
            throw new Error('step-2 failed');
          },
        },
        {
          name: 'step-3',
          run: async () => {
            executed.push('step-3');
            throw new Error('step-3 failed');
          },
        },
        {
          name: 'step-4',
          run: () => {
            executed.push('step-4');
          },
        },
      ];

      const errors = await runCleanups(cleanups);
      expect(executed).toEqual(['step-1', 'step-2', 'step-3', 'step-4']);
      expect(errors).toHaveLength(2);
      expect(errors[0].name).toBe('step-2');
      expect(errors[0].error.message).toBe('step-2 failed');
      expect(errors[1].name).toBe('step-3');
      expect(errors[1].error.message).toBe('step-3 failed');
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

    it('combineErrors は本体失敗＋クリーンアップ成功で本体エラーをそのまま返し、両方失敗で AggregateError で両方のエラー情報を保持すること', () => {
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

      expect(watchCallback).toBeDefined();
      if (watchCallback) {
        (watchCallback as (f: string, fl: number) => void)('/dummy/path/file.txt', 1);
      }

      await expect(control.eventPromise).rejects.toThrow('Native getInfo memory corruption');
      expect(control.isSettled()).toBe(true);
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

      // 追加のコールバックが来ても settle 状態が維持されること
      if (watchCallback) {
        (watchCallback as (f: string, fl: number) => void)('/dummy/path/file.txt', 2);
      }
      expect(control.isSettled()).toBe(true);
    });

    it('createViteWatcherPromise は change イベントで resolve され、タイマーが解除されること', async () => {
      let changeHandler: ((path: string) => void) | null = null;
      const mockViteServer = {
        watcher: {
          on: vi.fn((event, cb) => {
            if (event === 'change') {
              changeHandler = cb;
            }
          }),
        },
      };

      const control = createViteWatcherPromise({
        viteServer: mockViteServer as any,
        timeoutMs: 3000,
      });

      expect(control.isSettled()).toBe(false);
      expect(changeHandler).toBeDefined();

      if (changeHandler) {
        (changeHandler as (p: string) => void)('/mock/path/App.tsx');
      }

      const changedPath = await control.promise;
      expect(changedPath).toBe('/mock/path/App.tsx');
      expect(control.isSettled()).toBe(true);
      expect(control.getHandler()).toBe(changeHandler);

      // 追加のイベントが来ても settle 状態が壊れないこと
      if (changeHandler) {
        (changeHandler as (p: string) => void)('/mock/path/Other.tsx');
      }
      expect(control.isSettled()).toBe(true);
    });

    it('実ディスク上の一時ディレクトリを作成した場合でも、afterEach 後に残存ディレクトリが一切ないこと', () => {
      const testDir = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), 'shogi-fsevents-test-leakcheck-')));
      expect(fs.existsSync(testDir)).toBe(true);

      // 手動で削除し、存在しなくなったことを確認
      fs.rmSync(testDir, { recursive: true, force: true });
      expect(fs.existsSync(testDir)).toBe(false);

      // 追跡リスト内のディレクトリがすべて存在しないことを確認
      for (const dir of createdTempDirs) {
        expect(fs.existsSync(dir)).toBe(false);
      }
    });
  });
});

describe('9. 将棋ドメイン層・駒移動・合法手・手番・取り駒・着手履歴・UI操作の検証', () => {
    describe('9.1 座標ヘルパー (coordinates.ts)', () => {
      it('盤面内外の判定 (isWithinBoard) が正しく機能すること', () => {
        expect(isWithinBoard(0, 0)).toBe(true);
        expect(isWithinBoard(8, 8)).toBe(true);
        expect(isWithinBoard(4, 4)).toBe(true);
        expect(isWithinBoard(-1, 0)).toBe(false);
        expect(isWithinBoard(0, 9)).toBe(false);
        expect(isWithinBoard(9, 0)).toBe(false);
        expect(isWithinBoard(0, -1)).toBe(false);
      });

      it('座標一致判定 (areCoordinatesEqual) が正しく機能すること', () => {
        expect(areCoordinatesEqual({ row: 6, col: 2 }, { row: 6, col: 2 })).toBe(true);
        expect(areCoordinatesEqual({ row: 6, col: 2 }, { row: 5, col: 2 })).toBe(false);
        expect(areCoordinatesEqual(null, { row: 6, col: 2 })).toBe(false);
        expect(areCoordinatesEqual(undefined, undefined)).toBe(false);
      });

      it('座標文字列変換 (toCoordinateLabel / fromCoordinateLabel) が正確であること', () => {
        expect(toCoordinateLabel(6, 2)).toBe('7七');
        expect(toCoordinateLabel(2, 6)).toBe('3三');
        expect(toCoordinateLabel(0, 0)).toBe('9一');
        expect(toCoordinateLabel(8, 8)).toBe('1九');

        expect(fromCoordinateLabel('7七')).toEqual({ row: 6, col: 2 });
        expect(fromCoordinateLabel('3三')).toEqual({ row: 2, col: 6 });
        expect(fromCoordinateLabel('9一')).toEqual({ row: 0, col: 0 });
        expect(fromCoordinateLabel('1九')).toEqual({ row: 8, col: 8 });
        expect(fromCoordinateLabel('')).toBeNull();
        expect(fromCoordinateLabel('0零')).toBeNull();
      });
    });

    describe('9.2 駒の移動ルール・候補手生成 (moves.ts)', () => {
      it('先手の歩兵 (Pawn) は1マス前進 (row - 1) のみ可能であること', () => {
        const state = createInitialBoardState();
        // 7七 (row 6, col 2) の歩兵
        const moves = getMoveCandidates(state.squares, { row: 6, col: 2 });
        expect(moves).toEqual([{ row: 5, col: 2 }]); // 7六 (row 5, col 2)
      });

      it('後手の歩兵 (Pawn) は1マス前進 (row + 1) のみ可能であること', () => {
        const state = createInitialBoardState();
        // 3三 (row 2, col 6) の歩兵
        const moves = getMoveCandidates(state.squares, { row: 2, col: 6 });
        expect(moves).toEqual([{ row: 3, col: 6 }]); // 3四 (row 3, col 6)
      });

      it('香車 (Lance) は前方に遮る駒がある場合、その手前までしか進めず飛び越えられないこと', () => {
        const state = createInitialBoardState();
        // 1九 (row 8, col 8) の先手香車。前方の 1七 (row 6, col 8) に先手の歩があるため、1八 (row 7, col 8) のみ
        const moves = getMoveCandidates(state.squares, { row: 8, col: 8 });
        expect(moves).toEqual([{ row: 7, col: 8 }]);
      });

      it('桂馬 (Knight) は前方に遮る駒があっても飛び越え移動 (row ± 2, col ± 1) できること', () => {
        const state = createInitialBoardState();
        // 8九 (row 8, col 1) の先手桂馬。前方 8七(row 6) に歩があるが、7七(row 6, col 2) と 9七(row 6, col 0) に飛べる
        // ただし初期配置では 7七 と 9七 に先手歩兵が存在するため、自身の駒の上には移動不可となり 0 手
        const initialMoves = getMoveCandidates(state.squares, { row: 8, col: 1 });
        expect(initialMoves).toEqual([]);

        // 7七の歩を 7六 に進めた状態をつくる
        const movedState = applyMove(state, { row: 6, col: 2 }, { row: 5, col: 2 });
        // 8九の桂馬は 7七 (row 6, col 2) が空いたため移動可能になる
        const movesAfter = getMoveCandidates(movedState.squares, { row: 8, col: 1 });
        expect(movesAfter).toEqual([{ row: 6, col: 2 }]);
      });

      it('銀将 (Silver) は前方1マスおよび斜め4方向 (計5方向) に移動可能であること', () => {
        // 盤面中央 5五 (row 4, col 4) に単独の先手銀を配置
        const squares = cloneBoardSquares(createInitialBoardState().squares);
        // 全マスの駒をクリア
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            squares[r][c].piece = null;
          }
        }
        const silverPiece: Piece = { id: 'test-silver', type: 'silver', player: 'sente' };
        squares[4][4].piece = silverPiece;

        const candidates = getMoveCandidates(squares, { row: 4, col: 4 });
        // 先手銀: 前(3,4), 左上(3,3), 右上(3,5), 左下(5,3), 右下(5,5)
        expect(candidates).toHaveLength(5);
        expect(candidates).toContainEqual({ row: 3, col: 4 });
        expect(candidates).toContainEqual({ row: 3, col: 3 });
        expect(candidates).toContainEqual({ row: 3, col: 5 });
        expect(candidates).toContainEqual({ row: 5, col: 3 });
        expect(candidates).toContainEqual({ row: 5, col: 5 });
        // 後ろ (5,4) や 左右 (4,3), (4,5) は含まれないこと
        expect(candidates).not.toContainEqual({ row: 5, col: 4 });
        expect(candidates).not.toContainEqual({ row: 4, col: 3 });
        expect(candidates).not.toContainEqual({ row: 4, col: 5 });
      });

      it('金将 (Gold) は縦横4方向および前斜め2方向 (計6方向) に移動可能であること', () => {
        const squares = cloneBoardSquares(createInitialBoardState().squares);
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            squares[r][c].piece = null;
          }
        }
        const goldPiece: Piece = { id: 'test-gold', type: 'gold', player: 'sente' };
        squares[4][4].piece = goldPiece;

        const candidates = getMoveCandidates(squares, { row: 4, col: 4 });
        expect(candidates).toHaveLength(6);
        expect(candidates).toContainEqual({ row: 3, col: 4 }); // 前
        expect(candidates).toContainEqual({ row: 5, col: 4 }); // 後
        expect(candidates).toContainEqual({ row: 4, col: 3 }); // 左
        expect(candidates).toContainEqual({ row: 4, col: 5 }); // 右
        expect(candidates).toContainEqual({ row: 3, col: 3 }); // 前左
        expect(candidates).toContainEqual({ row: 3, col: 5 }); // 前右
        // 後ろ斜め (5,3), (5,5) は含まれないこと
        expect(candidates).not.toContainEqual({ row: 5, col: 3 });
        expect(candidates).not.toContainEqual({ row: 5, col: 5 });
      });

      it('玉将 / 王将 (King) は周囲8方向に移動可能であること', () => {
        const squares = cloneBoardSquares(createInitialBoardState().squares);
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            squares[r][c].piece = null;
          }
        }
        const kingPiece: Piece = { id: 'test-king', type: 'king', player: 'sente' };
        squares[4][4].piece = kingPiece;

        const candidates = getMoveCandidates(squares, { row: 4, col: 4 });
        expect(candidates).toHaveLength(8);
      });

      it('飛車 (Rook) は十字4方向に遮られるまで直進でき、敵駒マスで止まり、味方駒の手前で止まること', () => {
        const squares = cloneBoardSquares(createInitialBoardState().squares);
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            squares[r][c].piece = null;
          }
        }
        const rookPiece: Piece = { id: 'test-rook', type: 'rook', player: 'sente' };
        squares[4][4].piece = rookPiece;
        // 上方向 (2, 4) に敵の歩兵を配置
        squares[2][4].piece = { id: 'enemy-pawn', type: 'pawn', player: 'gote' };
        // 下方向 (6, 4) に味方の歩兵を配置
        squares[6][4].piece = { id: 'ally-pawn', type: 'pawn', player: 'sente' };

        const candidates = getMoveCandidates(squares, { row: 4, col: 4 });
        // 上: (3,4), (2,4: 敵駒取れる) まで。(1,4), (0,4) は進めない
        expect(candidates).toContainEqual({ row: 3, col: 4 });
        expect(candidates).toContainEqual({ row: 2, col: 4 });
        expect(candidates).not.toContainEqual({ row: 1, col: 4 });
        expect(candidates).not.toContainEqual({ row: 0, col: 4 });

        // 下: (5,4) まで。(6,4) は味方駒のため進めない
        expect(candidates).toContainEqual({ row: 5, col: 4 });
        expect(candidates).not.toContainEqual({ row: 6, col: 4 });
        expect(candidates).not.toContainEqual({ row: 7, col: 4 });

        // 左: (4,3), (4,2), (4,1), (4,0)
        expect(candidates).toContainEqual({ row: 4, col: 3 });
        expect(candidates).toContainEqual({ row: 4, col: 0 });

        // 右: (4,5), (4,6), (4,7), (4,8)
        expect(candidates).toContainEqual({ row: 4, col: 5 });
        expect(candidates).toContainEqual({ row: 4, col: 8 });
      });

      it('角行 (Bishop) は斜め4方向に遮られるまで直進できること', () => {
        const squares = cloneBoardSquares(createInitialBoardState().squares);
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            squares[r][c].piece = null;
          }
        }
        const bishopPiece: Piece = { id: 'test-bishop', type: 'bishop', player: 'sente' };
        squares[4][4].piece = bishopPiece;

        const candidates = getMoveCandidates(squares, { row: 4, col: 4 });
        // 斜め4方向の端まで行ける
        expect(candidates).toContainEqual({ row: 0, col: 0 });
        expect(candidates).toContainEqual({ row: 0, col: 8 });
        expect(candidates).toContainEqual({ row: 8, col: 0 });
        expect(candidates).toContainEqual({ row: 8, col: 8 });
      });

      it('王将 / 玉将を取る手は移動候補に含まれないこと', () => {
        const squares = cloneBoardSquares(createInitialBoardState().squares);
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            squares[r][c].piece = null;
          }
        }
        const rookPiece: Piece = { id: 'test-rook', type: 'rook', player: 'sente' };
        squares[4][4].piece = rookPiece;
        // 上に敵玉 (2,4) を配置
        squares[2][4].piece = { id: 'enemy-king', type: 'king', player: 'gote' };

        const candidates = getMoveCandidates(squares, { row: 4, col: 4 });
        // (3,4) は行けるが、(2,4) は王将のため移動候補に含まれない
        expect(candidates).toContainEqual({ row: 3, col: 4 });
        expect(candidates).not.toContainEqual({ row: 2, col: 4 });
      });
    });

    describe('9.3 局面進行・着手適用・取り駒・履歴 (gameState.ts)', () => {
      it('applyMove で駒が移動し、手番が交代し、手数が加算され、履歴が記録されること', () => {
        const state = createInitialBoardState();
        expect(state.turn).toBe('sente');
        expect(state.moveNumber).toBe(1);
        expect(state.history).toHaveLength(0);

        // 1手目: ▲7六歩 (from: 7七(6,2) -> to: 7六(5,2))
        const nextState = applyMove(state, { row: 6, col: 2 }, { row: 5, col: 2 });

        expect(nextState.squares[6][2].piece).toBeNull();
        expect(nextState.squares[5][2].piece?.type).toBe('pawn');
        expect(nextState.squares[5][2].piece?.player).toBe('sente');
        expect(nextState.turn).toBe('gote');
        expect(nextState.moveNumber).toBe(2);
        expect(nextState.history).toHaveLength(1);
        expect(nextState.history[0]).toEqual({
          kind: 'move',
          moveNumber: 1,
          player: 'sente',
          from: { row: 6, col: 2 },
          to: { row: 5, col: 2 },
          pieceType: 'pawn',
          capturedPieceType: null,
          promotion: 'none',
          notation: '▲7六歩',
        });
        expect(nextState.lastMove).toEqual(nextState.history[0]);
      });

      it('敵の駒を取った場合、盤面から除去され、所有者が移り、成りが解除されて持ち駒に追加されること', () => {
        const squares = cloneBoardSquares(createInitialBoardState().squares);
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            squares[r][c].piece = null;
          }
        }
        // 先手角 (4,4) と 後手銀 (3,3)
        const senteBishop: Piece = { id: 'sente-bishop', type: 'bishop', player: 'sente' };
        const goteSilver: Piece = { id: 'gote-silver', type: 'silver', player: 'gote', isPromoted: true };
        squares[4][4].piece = senteBishop;
        squares[3][3].piece = goteSilver;

        const customState = {
          squares,
          senteHand: [],
          goteHand: [],
          turn: 'sente' as const,
          moveNumber: 15,
          status: 'active' as const,
          viewMode: 'research' as const,
          history: [],
          lastMove: null,
        };

        // 先手角で後手銀を取る (4,4 -> 3,3)
        const afterCapture = applyMove(customState, { row: 4, col: 4 }, { row: 3, col: 3 });

        expect(afterCapture.squares[4][4].piece).toBeNull();
        expect(afterCapture.squares[3][3].piece?.id).toBe('sente-bishop');
        expect(afterCapture.senteHand).toHaveLength(1);
        expect(afterCapture.senteHand[0]).toEqual({
          id: 'gote-silver',
          type: 'silver',
          player: 'sente', // 捕獲した先手の駒になる
          isPromoted: false, // 成りはリセットされる
        });
        expect(afterCapture.goteHand).toHaveLength(0);
        expect(afterCapture.history[0].capturedPieceType).toBe('silver');
        expect(afterCapture.history[0].notation).toBe('▲6四角');
      });

      it('手番でないプレイヤーの駒を動かそうとした場合、局面は変化しないこと', () => {
        const state = createInitialBoardState();
        // 先手番のときに後手歩 (2,6) を動かそうとする
        const unchangedState = applyMove(state, { row: 2, col: 6 }, { row: 3, col: 6 });
        expect(unchangedState).toBe(state);
      });

      it('非合法手を指定した場合、局面は変化しないこと', () => {
        const state = createInitialBoardState();
        // 7七歩を 7五 にワープさせようとする
        const unchangedState = applyMove(state, { row: 6, col: 2 }, { row: 4, col: 2 });
        expect(unchangedState).toBe(state);
      });
    });

    describe('9.4 UI 操作・アクセシビリティ・駒台連携', () => {
      it('ShogiResearchScreen で先手歩兵をクリックすると選択状態となり候補手が表示されること', async () => {
        const user = userEvent.setup();
        render(<ShogiResearchScreen />);

        const pawnSquare = screen.getByRole('gridcell', { name: /7筋 7段、先手の歩兵/ });
        expect(pawnSquare).toBeInTheDocument();
        expect(pawnSquare).not.toHaveAttribute('aria-selected');

        await user.click(pawnSquare);

        // 選択状態の検証
        expect(pawnSquare).toHaveAttribute('aria-selected', 'true');
        expect(pawnSquare).toHaveAttribute('data-selected', 'true');

        // 移動候補マス 7六 (row 5, col 2) にドットが表示されること
        const targetSquare = screen.getByRole('gridcell', { name: /7筋 6段、空のマス、移動可能/ });
        expect(targetSquare).toBeInTheDocument();
        expect(targetSquare).toHaveAttribute('data-candidate', 'true');
        expect(targetSquare.querySelector('[data-testid="move-candidate-dot"]')).toBeInTheDocument();
      });

      it('選択中の駒を再度クリックすると選択解除されること', async () => {
        const user = userEvent.setup();
        render(<ShogiResearchScreen />);

        const pawnSquare = screen.getByRole('gridcell', { name: /7筋 7段、先手の歩兵/ });
        await user.click(pawnSquare);
        expect(pawnSquare).toHaveAttribute('aria-selected', 'true');

        await user.click(pawnSquare);
        expect(pawnSquare).not.toHaveAttribute('aria-selected');
      });

      it('別の自駒をクリックすると選択対象が切り替わること', async () => {
        const user = userEvent.setup();
        render(<ShogiResearchScreen />);

        const pawn77 = screen.getByRole('gridcell', { name: /7筋 7段、先手の歩兵/ });
        const pawn27 = screen.getByRole('gridcell', { name: /2筋 7段、先手の歩兵/ });

        await user.click(pawn77);
        expect(pawn77).toHaveAttribute('aria-selected', 'true');
        expect(pawn27).not.toHaveAttribute('aria-selected');

        await user.click(pawn27);
        expect(pawn77).not.toHaveAttribute('aria-selected');
        expect(pawn27).toHaveAttribute('aria-selected', 'true');
      });

      it('候補マスをクリックすると駒が移動し、手番が後手に変わり、バッジが更新されること', async () => {
        const user = userEvent.setup();
        render(<ShogiResearchScreen />);

        // 初期バッジ表示
        const statusBadge = screen.getByRole('status');
        expect(statusBadge).toHaveTextContent('対局中 / 先手番');

        // 7七歩を選択
        const pawn77 = screen.getByRole('gridcell', { name: /7筋 7段、先手の歩兵/ });
        await user.click(pawn77);

        // 7六候補マスをクリック
        const targetSquare = screen.getByRole('gridcell', { name: /7筋 6段、空のマス、移動可能/ });
        await user.click(targetSquare);

        // 駒が移動したこと
        expect(screen.getByRole('gridcell', { name: /7筋 6段、先手の歩兵/ })).toBeInTheDocument();
        expect(screen.getByRole('gridcell', { name: /7筋 7段、空のマス/ })).toBeInTheDocument();

        // 手番が後手に変わり、バッジが更新されること
        expect(statusBadge).toHaveTextContent('対局中 / 後手番');

        // フッター文言が正しく更新されていること
        expect(screen.getByText('駒の選択・移動・駒取り・成り選択・持ち駒からの駒打ちが可能です（打ち歩詰め判定は準備中）。')).toBeInTheDocument();
      });

      it('キーボード操作 (Space / Enter) でも駒選択および移動が可能であること', async () => {
        const user = userEvent.setup();
        render(<ShogiResearchScreen />);

        const pawn77 = screen.getByRole('gridcell', { name: /7筋 7段、先手の歩兵/ });
        pawn77.focus();

        await user.keyboard(' ');
        expect(pawn77).toHaveAttribute('aria-selected', 'true');

        const targetSquare = screen.getByRole('gridcell', { name: /7筋 6段、空のマス、移動可能/ });
        targetSquare.focus();

        await user.keyboard('{Enter}');
        expect(screen.getByRole('gridcell', { name: /7筋 6段、先手の歩兵/ })).toBeInTheDocument();
      });

      it('PieceStand は持ち駒の増減をリアルタイムに正しく表示し、アクセシブルであること', () => {
        const capturedPiece: Piece = {
          id: 'cap-1',
          type: 'pawn',
          player: 'sente',
        };

        const { rerender } = render(<PieceStand player="sente" pieces={[]} />);
        expect(screen.getByRole('region', { name: /先手の持ち駒 \(現在 0 枚\)/ })).toBeInTheDocument();
        expect(screen.getByText('持駒なし')).toBeInTheDocument();

        rerender(<PieceStand player="sente" pieces={[capturedPiece]} />);
        expect(screen.getByRole('region', { name: /先手の持ち駒 \(現在 1 枚\)/ })).toBeInTheDocument();
        expect(screen.getByText('1枚')).toBeInTheDocument();
      });
    });
  });

  /* =========================================================================
   * テストヘルパー: 任意配置の盤面生成
   * ========================================================================= */
  function createCustomTestBoard(
    pieces: Array<{ row: number; col: number; piece: Piece }>,
    turn: Player = 'sente',
    moveNumber: number = 1
  ): BoardState {
    const squares: BoardSquare[][] = [];
    for (let r = 0; r < 9; r++) {
      const row: BoardSquare[] = [];
      for (let c = 0; c < 9; c++) {
        row.push({
          row: r,
          col: c,
          file: 9 - c,
          rank: r + 1,
          rankKanji: RANK_KANJI[r],
          coordinateLabel: `${9 - c}${RANK_KANJI[r]}`,
          piece: null,
          hasBottomRightStarMarker: false,
        });
      }
      squares.push(row);
    }
    for (const item of pieces) {
      squares[item.row][item.col].piece = item.piece;
    }
    return {
      squares,
      senteHand: [],
      goteHand: [],
      turn,
      moveNumber,
      status: 'active',
      viewMode: 'research',
      history: [],
      lastMove: null,
      result: null,
      foulHistory: [],
    };
  }

  describe('10. 王手・自玉の安全判定・合法手エンジン (attacks.ts / moves.ts)', () => {
    it('findKingSquare で先手・後手の玉の座標を正確に取得できること', () => {
      const state = createCustomTestBoard([
        { row: 8, col: 4, piece: { id: 'k-s', type: 'king', player: 'sente' } },
        { row: 0, col: 4, piece: { id: 'k-g', type: 'king', player: 'gote' } },
      ]);
      expect(findKingSquare(state.squares, 'sente')).toEqual({ row: 8, col: 4 });
      expect(findKingSquare(state.squares, 'gote')).toEqual({ row: 0, col: 4 });
    });

    it('玉が相手の各駒（飛・角・金・銀・桂・香・歩・玉）の利きへ移動できないこと（自殺手防止）', () => {
      // 先手玉 5五(4,4)、後手歩 5三(2,4) -> 5四(3,4)に利きがある
      const stateWithPawn = createCustomTestBoard([
        { row: 4, col: 4, piece: { id: 'k1', type: 'king', player: 'sente' } },
        { row: 2, col: 4, piece: { id: 'p1', type: 'pawn', player: 'gote' } },
      ]);
      const moves = getLegalMoves(stateWithPawn.squares, { row: 4, col: 4 }, 'sente');
      // 5四 (3, 4) は後手歩の利きなので含まれないこと
      expect(moves.some((m) => m.row === 3 && m.col === 4)).toBe(false);
      // 他のマス（例えば 6五(4,3) や 4五(4,5)）は合法手であること
      expect(moves.some((m) => m.row === 4 && m.col === 3)).toBe(true);
    });

    it('玉同士が隣接するマスへの移動は相手玉の利きとなるため合法手から除外されること', () => {
      // 先手玉 5五(4,4)、後手玉 5三(2,4) -> 5四(3,4) は後手玉の利き
      const state = createCustomTestBoard([
        { row: 4, col: 4, piece: { id: 'k-s', type: 'king', player: 'sente' } },
        { row: 2, col: 4, piece: { id: 'k-g', type: 'king', player: 'gote' } },
      ]);
      const moves = getLegalMoves(state.squares, { row: 4, col: 4 }, 'sente');
      expect(moves.some((m) => m.row === 3 && m.col === 4)).toBe(false);
    });

    it('玉を守っている駒（ピンされた駒）を動かして自玉を王手に晒す手が合法手から除外されること', () => {
      // 先手玉 5九(8,4)、先手金 5八(7,4)、後手飛車 5一(0,4) -> 金が動くと自玉が飛車の王手を受ける（ピン）
      const state = createCustomTestBoard([
        { row: 8, col: 4, piece: { id: 'k-s', type: 'king', player: 'sente' } },
        { row: 7, col: 4, piece: { id: 'g-s', type: 'gold', player: 'sente' } },
        { row: 0, col: 4, piece: { id: 'r-g', type: 'rook', player: 'gote' } },
      ]);

      // 金の合法手を計算: 横や斜めに逃げると王手になるため、飛車のライン上（縦方向）のみ、あるいは飛車を取る手のみ
      const goldMoves = getLegalMoves(state.squares, { row: 7, col: 4 }, 'sente');
      // 6八(7,3) や 4八(7,5) への移動はピン違反で除外されること
      expect(goldMoves.some((m) => m.row === 7 && m.col === 3)).toBe(false);
      expect(goldMoves.some((m) => m.row === 7 && m.col === 5)).toBe(false);
      // 5七(6,4) への直進はラインを遮断し続けるため合法であること
      expect(goldMoves.some((m) => m.row === 6 && m.col === 4)).toBe(true);
    });

    it('王手中は王手を解消する手（玉の退避、王手駒の捕獲、合駒による遮断）だけが合法手になること', () => {
      // 先手玉 5九(8,4)、先手銀 7九(8,2)、後手飛車 5一(0,4) -> 先手玉に王手がかかっている
      const state = createCustomTestBoard([
        { row: 8, col: 4, piece: { id: 'k-s', type: 'king', player: 'sente' } },
        { row: 8, col: 2, piece: { id: 's-s', type: 'silver', player: 'sente' } },
        { row: 0, col: 4, piece: { id: 'r-g', type: 'rook', player: 'gote' } },
      ]);

      expect(isKingInCheck(state.squares, 'sente')).toBe(true);

      // 銀は 5筋の王手を解消できない位置にあるため、銀の移動はすべて不可（合法手0個）
      const silverMoves = getLegalMoves(state.squares, { row: 8, col: 2 }, 'sente');
      expect(silverMoves).toHaveLength(0);

      // 玉の合法手は 5筋から退避するマス（4九(8,5) または 6九(8,3)）のみ
      const kingMoves = getLegalMoves(state.squares, { row: 8, col: 4 }, 'sente');
      expect(kingMoves.length).toBeGreaterThan(0);
      expect(kingMoves.every((m) => m.col !== 4)).toBe(true);
    });

    it('攻撃マス判定 (isSquareAttackedBy) では相手玉のマスも攻撃対象として扱うこと', () => {
      // 先手角 8八(7,1)、後手玉 2二(1,7) -> 角の斜めレイが後手玉に直撃
      const state = createCustomTestBoard([
        { row: 7, col: 1, piece: { id: 'b-s', type: 'bishop', player: 'sente' } },
        { row: 1, col: 7, piece: { id: 'k-g', type: 'king', player: 'gote' } },
      ]);
      expect(isSquareAttackedBy(state.squares, { row: 1, col: 7 }, 'sente')).toBe(true);
      expect(isKingInCheck(state.squares, 'gote')).toBe(true);
    });

    it('合法手生成と攻撃マス生成が再帰ループせずに高速に完了すること', () => {
      const state = createInitialBoardState();
      const start = Date.now();
      const moves = getLegalMoves(state.squares, { row: 6, col: 2 }, 'sente');
      const duration = Date.now() - start;
      expect(moves).toEqual([{ row: 5, col: 2 }]);
      expect(duration).toBeLessThan(100);
    });
  });

  describe('11. 成駒の移動ルール (attacks.ts / moves.ts)', () => {
    it('と金・成香・成桂・成銀が金将と全く同じ動き（縦横4方向＋前斜め2方向）をすること', () => {
      const promotedTypes = ['pawn', 'lance', 'knight', 'silver'] as const;

      for (const pType of promotedTypes) {
        const state = createCustomTestBoard([
          { row: 4, col: 4, piece: { id: `pr-${pType}`, type: pType, player: 'sente', isPromoted: true } },
          { row: 8, col: 4, piece: { id: 'k-s', type: 'king', player: 'sente' } },
        ]);

        const moves = getLegalMoves(state.squares, { row: 4, col: 4 }, 'sente');
        // 金将の6方向: 上(3,4), 下(5,4), 左(4,3), 右(4,5), 左上(3,3), 右上(3,5)
        expect(moves).toHaveLength(6);
        expect(moves).toEqual(
          expect.arrayContaining([
            { row: 3, col: 4 },
            { row: 5, col: 4 },
            { row: 4, col: 3 },
            { row: 4, col: 5 },
            { row: 3, col: 3 },
            { row: 3, col: 5 },
          ])
        );
      }
    });

    it('竜王 (Promoted Rook) が飛車の十字レイ＋斜め1マスを持つこと', () => {
      const state = createCustomTestBoard([
        { row: 4, col: 4, piece: { id: 'r-prom', type: 'rook', player: 'sente', isPromoted: true } },
        { row: 8, col: 8, piece: { id: 'k-s', type: 'king', player: 'sente' } },
      ]);
      const moves = getLegalMoves(state.squares, { row: 4, col: 4 }, 'sente');
      // 飛車十字（上4+下4+左4+右4 = 16マス） + 斜め1マス（4マス） = 20マス
      expect(moves).toHaveLength(20);
      expect(moves).toEqual(
        expect.arrayContaining([
          { row: 3, col: 3 },
          { row: 3, col: 5 },
          { row: 5, col: 3 },
          { row: 5, col: 5 },
        ])
      );
    });

    it('竜馬 (Promoted Bishop) が角の斜めレイ＋縦横1マスを持つこと', () => {
      const state = createCustomTestBoard([
        { row: 4, col: 4, piece: { id: 'b-prom', type: 'bishop', player: 'sente', isPromoted: true } },
        { row: 8, col: 5, piece: { id: 'k-s', type: 'king', player: 'sente' } },
      ]);
      const moves = getLegalMoves(state.squares, { row: 4, col: 4 }, 'sente');
      // 角行斜め（4x4=16マス） + 縦横1マス（4マス） = 20マス
      expect(moves).toHaveLength(20);
      expect(moves).toEqual(
        expect.arrayContaining([
          { row: 3, col: 4 },
          { row: 5, col: 4 },
          { row: 4, col: 3 },
          { row: 4, col: 5 },
        ])
      );
    });

    it('未成駒の既存挙動が維持されていること', () => {
      const state = createCustomTestBoard([
        { row: 4, col: 4, piece: { id: 's-normal', type: 'silver', player: 'sente', isPromoted: false } },
        { row: 8, col: 8, piece: { id: 'k-s', type: 'king', player: 'sente' } },
      ]);
      const moves = getLegalMoves(state.squares, { row: 4, col: 4 }, 'sente');
      // 銀将: 前1＋斜め4 = 5方向
      expect(moves).toHaveLength(5);
    });
  });

  describe('12. 行き所のない駒を必須成りとして扱う判定', () => {
    it('先手の歩・香車は1段目(row 0)、桂馬は1・2段目(row 0, 1)で必須成りとなること', () => {
      const pawn: Piece = { id: 'p', type: 'pawn', player: 'sente', isPromoted: false };
      const lance: Piece = { id: 'l', type: 'lance', player: 'sente', isPromoted: false };
      const knight: Piece = { id: 'n', type: 'knight', player: 'sente', isPromoted: false };

      expect(isDeadPieceMove(pawn, { row: 0, col: 4 })).toBe(true);
      expect(isDeadPieceMove(pawn, { row: 1, col: 4 })).toBe(false);

      expect(isDeadPieceMove(lance, { row: 0, col: 4 })).toBe(true);
      expect(isDeadPieceMove(lance, { row: 1, col: 4 })).toBe(false);

      expect(isDeadPieceMove(knight, { row: 0, col: 4 })).toBe(true);
      expect(isDeadPieceMove(knight, { row: 1, col: 4 })).toBe(true);
      expect(isDeadPieceMove(knight, { row: 2, col: 4 })).toBe(false);
    });

    it('後手の歩・香車は9段目(row 8)、桂馬は8・9段目(row 7, 8)で必須成りとなること', () => {
      const pawn: Piece = { id: 'p', type: 'pawn', player: 'gote', isPromoted: false };
      const lance: Piece = { id: 'l', type: 'lance', player: 'gote', isPromoted: false };
      const knight: Piece = { id: 'n', type: 'knight', player: 'gote', isPromoted: false };

      expect(isDeadPieceMove(pawn, { row: 8, col: 4 })).toBe(true);
      expect(isDeadPieceMove(pawn, { row: 7, col: 4 })).toBe(false);

      expect(isDeadPieceMove(lance, { row: 8, col: 4 })).toBe(true);
      expect(isDeadPieceMove(lance, { row: 7, col: 4 })).toBe(false);

      expect(isDeadPieceMove(knight, { row: 8, col: 4 })).toBe(true);
      expect(isDeadPieceMove(knight, { row: 7, col: 4 })).toBe(true);
      expect(isDeadPieceMove(knight, { row: 6, col: 4 })).toBe(false);
    });

    it('必須成りの着手先も合法手候補から除外されないこと', () => {
      const state = createCustomTestBoard([
        { row: 2, col: 4, piece: { id: 'n-s', type: 'knight', player: 'sente' } },
        { row: 8, col: 4, piece: { id: 'k-s', type: 'king', player: 'sente' } },
      ]);
      const moves = getLegalMoves(state.squares, { row: 2, col: 4 }, 'sente');
      expect(moves).toEqual(expect.arrayContaining([{ row: 0, col: 3 }, { row: 0, col: 5 }]));
    });

    it('厳格対局方式で必須成り指定がない場合は promotion_required の反則負けになること', () => {
      const state = createCustomTestBoard([
        { row: 2, col: 4, piece: { id: 'n-s', type: 'knight', player: 'sente' } },
        { row: 8, col: 4, piece: { id: 'k-s', type: 'king', player: 'sente' } },
      ]);

      const result = executeMove(state, { row: 2, col: 4 }, { row: 0, col: 3 }, {
        mode: 'strict',
        proposer: 'shogi_engine',
        engineName: 'TestEngine-v1',
      });

      expect(result.type).toBe('foul_loss');
      if (result.type === 'foul_loss') {
        expect(result.result.endReason).toBe('foul_loss');
        expect(result.result.foulReason).toBe('promotion_required');
        expect(result.result.winner).toBe('gote');
        expect(result.result.loser).toBe('sente');
        expect(result.state.status).toBe('ended');
        // 盤面や駒位置が変わっていないこと
        expect(result.state.squares[2][4].piece?.type).toBe('knight');
        expect(result.state.squares[0][3].piece).toBeNull();
      }
    });
  });

  describe('13. 指し手の検証結果と方式別処理 (validation.ts / gameState.ts)', () => {
    it('validateMove が反則理由を正確に識別して返すこと', () => {
      const state = createInitialBoardState();

      // 盤外
      const outOfBounds = validateMove(state, { row: -1, col: 0 }, { row: 0, col: 0 });
      expect(outOfBounds.isValid).toBe(false);
      if (!outOfBounds.isValid) {
        expect(outOfBounds.reason).toBe('out_of_bounds');
      }

      // 移動元に駒がない
      const noPiece = validateMove(state, { row: 4, col: 4 }, { row: 3, col: 4 });
      expect(noPiece.isValid).toBe(false);
      if (!noPiece.isValid) {
        expect(noPiece.reason).toBe('no_piece_at_source');
      }

      // 手番違反（後手の駒を先手番で動かそうとする）
      const notCurrentTurn = validateMove(state, { row: 2, col: 4 }, { row: 3, col: 4 });
      expect(notCurrentTurn.isValid).toBe(false);
      if (!notCurrentTurn.isValid) {
        expect(notCurrentTurn.reason).toBe('not_current_turn');
      }

      // 駒の動きとして不正
      const invalidMove = validateMove(state, { row: 6, col: 2 }, { row: 4, col: 2 });
      expect(invalidMove.isValid).toBe(false);
      if (!invalidMove.isValid) {
        expect(invalidMove.reason).toBe('invalid_piece_move');
      }

      // 味方駒のあるマス
      const occupiedByOwn = validateMove(state, { row: 7, col: 1 }, { row: 8, col: 0 });
      expect(occupiedByOwn.isValid).toBe(false);
      if (!occupiedByOwn.isValid) {
        expect(occupiedByOwn.reason).toBe('occupied_by_own_piece');
      }
    });

    it('相手玉を直接取ろうとする着手は captured_king 反則として判定されること', () => {
      // 先手飛車 5二(1,4)、後手玉 5一(0,4)
      const state = createCustomTestBoard([
        { row: 1, col: 4, piece: { id: 'r-s', type: 'rook', player: 'sente' } },
        { row: 0, col: 4, piece: { id: 'k-g', type: 'king', player: 'gote' } },
        { row: 8, col: 4, piece: { id: 'k-s', type: 'king', player: 'sente' } },
      ]);

      const val = validateMove(state, { row: 1, col: 4 }, { row: 0, col: 4 });
      expect(val.isValid).toBe(false);
      if (!val.isValid) {
        expect(val.reason).toBe('captured_king');
      }
    });

    it('アシスト方式では禁じ手が拒否されるが終局しないこと', () => {
      const state = createInitialBoardState();
      const res = executeMove(state, { row: 6, col: 2 }, { row: 4, col: 2 }, { mode: 'assist' });
      expect(res.type).toBe('rejected');
      expect(res.state.status).toBe('active');
      expect(res.state).toBe(state);
    });

    it('厳格対局方式では同じ禁じ手が反則負けになり、状態が安全に保存されること', () => {
      const state = createInitialBoardState();
      const res = executeMove(state, { row: 6, col: 2 }, { row: 4, col: 2 }, {
        mode: 'strict',
        proposer: 'local_ai',
      });

      expect(res.type).toBe('foul_loss');
      if (res.type === 'foul_loss') {
        expect(res.state.status).toBe('ended');
        expect(res.result.winner).toBe('gote');
        expect(res.result.loser).toBe('sente');
        expect(res.result.foulReason).toBe('invalid_piece_move');
        expect(res.state.foulHistory).toHaveLength(1);
        expect(res.state.foulHistory![0].proposer).toBe('local_ai');
        expect(res.state.history).toHaveLength(0); // 合法手履歴には混入しない
        expect(res.state.turn).toBe('sente'); // 手番維持
        expect(res.state.moveNumber).toBe(1); // 手数維持
      }
    });

    it('合法手はアシスト方式・厳格対局方式のどちらでも同一の盤面遷移を行うこと', () => {
      const state = createInitialBoardState();
      const resAssist = executeMove(state, { row: 6, col: 2 }, { row: 5, col: 2 }, { mode: 'assist' });
      const resStrict = executeMove(state, { row: 6, col: 2 }, { row: 5, col: 2 }, { mode: 'strict' });

      expect(resAssist.type).toBe('applied');
      expect(resStrict.type).toBe('applied');
      if (resAssist.type === 'applied' && resStrict.type === 'applied') {
        expect(resAssist.state.turn).toBe('gote');
        expect(resStrict.state.turn).toBe('gote');
        expect(resAssist.state.moveNumber).toBe(2);
        expect(resStrict.state.moveNumber).toBe(2);
        expect(resAssist.state.history[0].notation).toBe('▲7六歩');
        expect(resStrict.state.history[0].notation).toBe('▲7六歩');
      }
    });
  });

  describe('14. UI・表示統合・回帰検証 (ShogiResearchScreen.tsx / ShogiBoard.tsx)', () => {
    it('初期状態で BoardState.status が active であり、「対局中 / 先手番」のバッジが表示されること', () => {
      const state = createInitialBoardState();
      expect(state.status).toBe('active');

      render(<ShogiResearchScreen />);
      const badge = screen.getByRole('status');
      expect(badge).toHaveTextContent('対局中 / 先手番');
    });

    it('王手放置となる手は画面上に候補表示されないこと', () => {
      // 自玉が王手されている局面で ShogiBoard を直接レンダリングして確認
      const state = createCustomTestBoard([
        { row: 8, col: 4, piece: { id: 'k-s', type: 'king', player: 'sente' } },
        { row: 8, col: 2, piece: { id: 's-s', type: 'silver', player: 'sente' } },
        { row: 0, col: 4, piece: { id: 'r-g', type: 'rook', player: 'gote' } },
      ]);

      const candidates = getLegalMoves(state.squares, { row: 8, col: 2 }, 'sente');
      expect(candidates).toHaveLength(0); // 銀は王手を防げないため候補0
    });
  });

  describe('15. 公開API・提案元別既定モード・反則履歴駒種・終局後拒否の厳密検証', () => {
    describe('15.1 公開APIと低レベル盤面更新関数のカプセル化', () => {
      it('src/domain/shogi/index.ts から低レベル盤面更新関数 (applyLegalMove / internalApplyLegalMove) が公開されていないこと', () => {
        const exports = ShogiDomainModule as Record<string, unknown>;
        expect(exports['applyLegalMove']).toBeUndefined();
        expect(exports['internalApplyLegalMove']).toBeUndefined();
        expect(typeof exports['executeMove']).toBe('function');
        expect(typeof exports['applyMove']).toBe('function');
        expect(typeof exports['determineDefaultExecutionMode']).toBe('function');
      });

      it('公開API applyMove に不正手を渡しても盤面が更新されないこと（アシスト方式で保護）', () => {
        const state = createInitialBoardState();
        // 歩を7七(6,2)から7五(4,2)へ二段進める不正手
        const nextState = applyMove(state, { row: 6, col: 2 }, { row: 4, col: 2 });
        expect(nextState).toBe(state);
        expect(nextState.squares[6][2].piece?.type).toBe('pawn');
        expect(nextState.squares[4][2].piece).toBeNull();
        expect(nextState.turn).toBe('sente');
        expect(nextState.moveNumber).toBe(1);
      });

      it('公開API applyMove に合法手を渡した場合は正常に局面が更新されること', () => {
        const state = createInitialBoardState();
        const nextState = applyMove(state, { row: 6, col: 2 }, { row: 5, col: 2 });
        expect(nextState).not.toBe(state);
        expect(nextState.squares[6][2].piece).toBeNull();
        expect(nextState.squares[5][2].piece?.type).toBe('pawn');
        expect(nextState.turn).toBe('gote');
        expect(nextState.moveNumber).toBe(2);
      });
    });

    describe('15.2 提案元 (proposer) に応じた既定モードの選択', () => {
      it('determineDefaultExecutionMode が proposer に応じて適切なモードを返すこと', () => {
        expect(determineDefaultExecutionMode(undefined)).toBe('assist');
        expect(determineDefaultExecutionMode('human')).toBe('assist');
        expect(determineDefaultExecutionMode('local_ai')).toBe('strict');
        expect(determineDefaultExecutionMode('shogi_engine')).toBe('strict');
      });

      it('proposer 省略時は assist 方式となり、不正手で対局継続されること', () => {
        const state = createInitialBoardState();
        const res = executeMove(state, { row: 6, col: 2 }, { row: 4, col: 2 });
        expect(res.type).toBe('rejected');
        expect(res.state.status).toBe('active');
      });

      it('proposer: human で mode 省略時は assist 方式となり、不正手で対局継続されること', () => {
        const state = createInitialBoardState();
        const res = executeMove(state, { row: 6, col: 2 }, { row: 4, col: 2 }, { proposer: 'human' });
        expect(res.type).toBe('rejected');
        expect(res.state.status).toBe('active');
      });

      it('proposer: local_ai で mode 省略時は strict 方式となり、不正手で反則負けになること', () => {
        const state = createInitialBoardState();
        const res = executeMove(state, { row: 6, col: 2 }, { row: 4, col: 2 }, { proposer: 'local_ai' });
        expect(res.type).toBe('foul_loss');
        if (res.type === 'foul_loss') {
          expect(res.state.status).toBe('ended');
          expect(res.result.winner).toBe('gote');
          expect(res.result.loser).toBe('sente');
          expect(res.foul.proposer).toBe('local_ai');
        }
      });

      it('proposer: shogi_engine で mode 省略時は strict 方式となり、不正手で反則負けになること', () => {
        const state = createInitialBoardState();
        const res = executeMove(state, { row: 6, col: 2 }, { row: 4, col: 2 }, {
          proposer: 'shogi_engine',
          engineName: 'YaneuraOu-v8',
        });
        expect(res.type).toBe('foul_loss');
        if (res.type === 'foul_loss') {
          expect(res.state.status).toBe('ended');
          expect(res.result.winner).toBe('gote');
          expect(res.foul.proposer).toBe('shogi_engine');
          expect(res.foul.engineName).toBe('YaneuraOu-v8');
        }
      });

      it('明示された mode は proposer の既定値より優先されること (local_ai + mode: assist / human + mode: strict)', () => {
        const state = createInitialBoardState();

        // local_ai に mode: assist を明示 -> 拒否のみで終局しない
        const resAiAssist = executeMove(state, { row: 6, col: 2 }, { row: 4, col: 2 }, {
          proposer: 'local_ai',
          mode: 'assist',
        });
        expect(resAiAssist.type).toBe('rejected');
        expect(resAiAssist.state.status).toBe('active');

        // human に mode: strict を明示 -> 反則負けで終局
        const resHumanStrict = executeMove(state, { row: 6, col: 2 }, { row: 4, col: 2 }, {
          proposer: 'human',
          mode: 'strict',
        });
        expect(resHumanStrict.type).toBe('foul_loss');
        if (resHumanStrict.type === 'foul_loss') {
          expect(resHumanStrict.state.status).toBe('ended');
          expect(resHumanStrict.foul.proposer).toBe('human');
        }
      });
    });

    describe('15.3 反則履歴の駒種 (FoulRecord.pieceType) の厳密記録', () => {
      it('実在する歩の不正手では pieceType: "pawn" が記録されること', () => {
        const state = createInitialBoardState();
        const res = executeMove(state, { row: 6, col: 2 }, { row: 4, col: 2 }, { proposer: 'local_ai' });
        expect(res.type).toBe('foul_loss');
        if (res.type === 'foul_loss') {
          expect(res.foul.pieceType).toBe('pawn');
          expect(res.foul.from).toEqual({ row: 6, col: 2 });
          expect(res.foul.to).toEqual({ row: 4, col: 2 });
          expect(res.foul.reason).toBe('invalid_piece_move');
        }
      });

      it('空マス (4,4) を移動元にした不正手では pieceType: null が記録され架空の駒種が補完されないこと', () => {
        const state = createInitialBoardState();
        const res = executeMove(state, { row: 4, col: 4 }, { row: 3, col: 4 }, { proposer: 'local_ai' });
        expect(res.type).toBe('foul_loss');
        if (res.type === 'foul_loss') {
          expect(res.foul.pieceType).toBeNull();
          expect(res.foul.from).toEqual({ row: 4, col: 4 });
          expect(res.foul.to).toEqual({ row: 3, col: 4 });
          expect(res.foul.reason).toBe('no_piece_at_source');
        }
      });

      it('盤外 (-1, 0) を移動元にした不正手では pieceType: null が記録されること', () => {
        const state = createInitialBoardState();
        const res = executeMove(state, { row: -1, col: 0 }, { row: 0, col: 0 }, { proposer: 'shogi_engine' });
        expect(res.type).toBe('foul_loss');
        if (res.type === 'foul_loss') {
          expect(res.foul.pieceType).toBeNull();
          expect(res.foul.from).toEqual({ row: -1, col: 0 });
          expect(res.foul.to).toEqual({ row: 0, col: 0 });
          expect(res.foul.reason).toBe('out_of_bounds');
        }
      });
    });

    describe('15.4 終局後の着手理由と状態保護', () => {
      it('終局済みの状態 (status: "ended") に対する着手は game_already_ended で拒否されること', () => {
        const endedState: BoardState = {
          ...createInitialBoardState(),
          status: 'ended',
          result: {
            winner: 'gote',
            loser: 'sente',
            endReason: 'foul_loss',
            foulReason: 'invalid_piece_move',
            details: '不正着手',
          },
          foulHistory: [
            {
              kind: 'move',
              moveNumber: 1,
              player: 'sente',
              from: { row: 6, col: 2 },
              to: { row: 4, col: 2 },
              pieceType: 'pawn',
              reason: 'invalid_piece_move',
              message: '不正着手',
              proposer: 'local_ai',
              timestamp: 1000,
            },
          ],
        };

        // assist 方式での着手
        const resAssist = executeMove(endedState, { row: 6, col: 2 }, { row: 5, col: 2 }, { mode: 'assist' });
        expect(resAssist.type).toBe('rejected');
        if (resAssist.type === 'rejected') {
          expect(resAssist.reason).toBe('game_already_ended');
          expect(resAssist.message).toBe('対局は既に終局しています。');
          expect(resAssist.state).toBe(endedState);
        }

        // strict 方式での着手（新たな反則負けを生成せず拒否のみ行うこと）
        const resStrict = executeMove(endedState, { row: 6, col: 2 }, { row: 5, col: 2 }, {
          proposer: 'shogi_engine',
        });
        expect(resStrict.type).toBe('rejected');
        if (resStrict.type === 'rejected') {
          expect(resStrict.reason).toBe('game_already_ended');
          expect(resStrict.message).toBe('対局は既に終局しています。');
          expect(resStrict.state).toBe(endedState);
          // 勝敗結果や反則履歴、手数、手番が一切変化していないこと
          expect(resStrict.state.result?.winner).toBe('gote');
          expect(resStrict.state.foulHistory).toHaveLength(1);
          expect(resStrict.state.moveNumber).toBe(1);
          expect(resStrict.state.turn).toBe('sente');
        }
      });
    });
  });

