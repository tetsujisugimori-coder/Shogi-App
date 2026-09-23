import fixedRecorded from './fixtures/quiescence-comparison-results.json';
import presetRecorded from './fixtures/time-limited-comparison-presets.json';
import { validateEvaluationPresetComparison } from '../application/evaluationPresetComparisonValidation';
import { validateQuiescenceComparison } from '../application/quiescenceComparisonValidation';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import { type TimeLimitedQuiescenceComparisonResult } from '../domain/shogi/timeLimitedQuiescenceComparison';
import { executeMove, serializeShogiGameRecordV1 } from '../domain/shogi';
import { createInitialBoardState, type BoardState } from '../types/shogi';
import { formatSenteEvaluation } from '../components/shogi/searchEvaluationDisplay';
import recordedResults from './fixtures/time-limited-quiescence-comparison-results.json';
import { validateTimeLimitedQuiescenceComparison } from '../application/timeLimitedQuiescenceComparisonValidation';

type Results = readonly TimeLimitedQuiescenceComparisonResult[];
let results: Results;
const initial = createInitialBoardState();
// Recorded from the real comparison with clock=() => 0. UI tests exercise the
// Worker boundary; domain tests separately run the real three-pass search.
beforeAll(() => {
  validateTimeLimitedQuiescenceComparison(initial, 4, 1000, recordedResults.initial);
  validateTimeLimitedQuiescenceComparison(fourMoves(), 4, 1000, recordedResults.fourMoves);
  results = recordedResults.initial;
});
function deferred() {
  let resolve!: (result: Results) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Results>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}
const button = () => screen.getByRole('button', { name: '静止探索を同じ1秒で比較' });
const panel = () => screen.getByRole('region', { name: '同一時間の静止探索比較' });
const root = () => document.getElementById('shogi-research-screen')!;
function boardEvidence() {
  return { data: { ...root().dataset }, cells: screen.getAllByRole('gridcell').map((cell) => cell.getAttribute('aria-label')) };
}
function fourMoves() {
  let state = createInitialBoardState();
  for (const [from, to] of [
    [{ row: 6, col: 2 }, { row: 5, col: 2 }], [{ row: 2, col: 6 }, { row: 3, col: 6 }],
    [{ row: 6, col: 3 }, { row: 5, col: 3 }], [{ row: 2, col: 5 }, { row: 3, col: 5 }],
  ]) {
    const execution = executeMove(state, from, to);
    if (execution.type !== 'applied') throw new Error('Invalid fixture');
    state = execution.state;
  }
  return state;
}

describe('同一時間の静止探索比較UI', () => {
  it('異なる完了深さ・時間切れと4群の統計を表示し、局面・保存・既存比較を保持する', async () => {
    const user = userEvent.setup(); const pending = deferred();
    validateQuiescenceComparison(initial, 3, fixedRecorded.initial);
    validateEvaluationPresetComparison(initial, 3, presetRecorded);
    const fixed = fixedRecorded.initial;
    const presets = presetRecorded;
    const runner = vi.fn((_state: BoardState, _depth: number, _ms: number, _signal?: AbortSignal) => pending.promise);
    render(<ShogiResearchScreen timeLimitedQuiescenceComparisonRunner={runner} quiescenceComparisonRunner={async () => fixed} comparisonRunner={async () => presets} />);
    await user.click(screen.getByRole('button', { name: '3プリセットを比較' }));
    const presetPanel = screen.getByRole('region', { name: '評価プリセットの比較' });
    await within(presetPanel).findAllByRole('article');
    const priorPreset = presetPanel.textContent;
    await user.click(screen.getByRole('button', { name: '静止探索を固定深さ3で比較' }));
    const fixedPanel = screen.getByRole('region', { name: '静止探索設定の比較' });
    await within(fixedPanel).findAllByRole('article');
    const prior = fixedPanel.textContent; const before = boardEvidence(); const saved = { ...localStorage };
    await user.selectOptions(screen.getByRole('combobox', { name: '評価プリセット' }), 'king-safety-focused');
    await user.click(button());
    expect(runner).toHaveBeenCalledWith(expect.anything(), 4, 1000, expect.any(AbortSignal));
    expect(Object.isFrozen(runner.mock.calls[0][0])).toBe(true);
    expect(fixedPanel.textContent).toBe(prior);
    expect(presetPanel.textContent).toBe(priorPreset);
    for (const name of ['2手読みAIに指させる', '時間制限AIに指させる', '3プリセットを比較', '静止探索を固定深さ3で比較']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByRole('combobox', { name: '評価プリセット' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '静止探索（駒取りの読み足し）' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '同一時間の静止探索比較を中止' }));
    expect(fixedPanel.textContent).toBe(prior);
    expect(presetPanel.textContent).toBe(priorPreset);
    await user.click(button());
    await act(async () => pending.resolve(results));
    const cards = within(panel()).getAllByRole('article');
    expect(cards.map(c => c.getAttribute('aria-label'))).toEqual(['静止探索なし', '追加1手', '追加2手']);
    for (const [i, card] of cards.entries()) {
      expect(card).toHaveTextContent(`${results[i].completedDepth} / 4 ply`);
      expect(card).toHaveTextContent(results[i].timedOut ? 'あり' : 'なし（最大深さ完了）');
      expect(card).toHaveTextContent(`先手 ${formatSenteEvaluation(results[i].selectedEvaluation, 'sente')}`);
      for (const title of ['最深完了反復の通常探索', '全完了反復合計の通常探索', '最深完了反復の静止探索', '全完了反復合計の静止探索', 'API全体の参考処理時間']) {
        expect(within(card).getByText(title)).toBeVisible();
      }
      expect(within(card).getAllByRole('listitem')).toHaveLength(results[i].principalVariation.length);
      const values = Array.from(card.querySelectorAll('dd')).map(dd => dd.textContent);
      expect(values.slice(5)).toEqual([
        results[i].visitedPositionCount, results[i].cutoffCount, results[i].skippedActionCount,
        results[i].quiescenceLeafCount, results[i].quiescenceVisitedPositionCount, results[i].quiescenceCutoffCount, results[i].quiescenceSkippedActionCount,
        results[i].totalVisitedPositionCount, results[i].totalCutoffCount, results[i].totalSkippedActionCount,
        results[i].totalQuiescenceLeafCount, results[i].totalQuiescenceVisitedPositionCount, results[i].totalQuiescenceCutoffCount, results[i].totalQuiescenceSkippedActionCount,
      ].map(String));
    }
    expect(boardEvidence()).toEqual(before); expect({ ...localStorage }).toEqual(saved);
    expect(fixedPanel.textContent).toBe(prior);
    expect(presetPanel.textContent).toBe(priorPreset);
    expect(screen.getByRole('combobox', { name: '評価プリセット' })).toHaveValue('king-safety-focused');
  });

  it.each(['single', 'presets', 'fixed'] as const)('%sの処理中は時間比較を開始できない', async (kind) => {
    const user = userEvent.setup(); const runner = vi.fn(async () => results);
    const wait = () => new Promise<never>(() => {});
    render(<ShogiResearchScreen timeLimitedQuiescenceComparisonRunner={runner} workerSearchRunner={wait} comparisonRunner={wait} quiescenceComparisonRunner={wait} />);
    await user.click(screen.getByRole('button', { name: kind === 'single' ? '時間制限AIに指させる' : kind === 'presets' ? '3プリセットを比較' : '静止探索を固定深さ3で比較' }));
    expect(button()).toBeDisabled(); await user.click(button()); expect(runner).not.toHaveBeenCalled();
  });

  it('中止前の遅延失敗は再開始した比較へ影響しない', async () => {
    const user = userEvent.setup(); const old = deferred(); const next = deferred();
    render(<ShogiResearchScreen timeLimitedQuiescenceComparisonRunner={vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)} />);
    await user.click(button()); await user.click(screen.getByRole('button', { name: '同一時間の静止探索比較を中止' }));
    await user.click(button()); await act(async () => old.reject(new Error('old failure')));
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => next.resolve(results)); expect(within(panel()).getAllByRole('article')).toHaveLength(3);
  });
  it('再開始時に結果を消し、中止後の旧世代成功・失敗を無視する', async () => {
    const user = userEvent.setup(); const first = deferred(); const second = deferred();
    const runner = vi.fn().mockResolvedValueOnce(results).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<ShogiResearchScreen timeLimitedQuiescenceComparisonRunner={runner} />);
    await user.click(button()); await within(panel()).findAllByRole('article');
    await user.click(button());
    expect(within(panel()).queryAllByRole('article')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '同一時間の静止探索比較を中止' }));
    expect(runner.mock.calls[1][3].aborted).toBe(true);
    await user.click(button());
    await act(async () => first.resolve(results));
    expect(screen.getByText('静止探索の3条件を順番に解析中（各1秒）')).toBeVisible();
    expect(within(panel()).queryAllByRole('article')).toHaveLength(0);
    await act(async () => second.reject(new Error('comparison failed')));
    expect(screen.getByRole('alert')).toHaveTextContent('comparison failed');
    expect(button()).toBeEnabled();
    expect(within(panel()).queryAllByRole('article')).toHaveLength(0);
  });

  it.each(['通常着手', '新規対局', '投了', '棋譜再生', 'JSON', 'KIF', 'unmount'] as const)('%sで中止し、遅延した結果を表示しない', async (operation) => {
    const user = userEvent.setup(); const pending = deferred();
    const runner = vi.fn((_state: BoardState, _depth: number, _milliseconds: number, _signal?: AbortSignal) => pending.promise);
    const view = render(<ShogiResearchScreen initialState={fourMoves()} timeLimitedQuiescenceComparisonRunner={runner} />);
    await user.click(button());
    if (operation === '通常着手') {
      await user.click(screen.getByRole('gridcell', { name: '9筋 7段、先手の歩兵' }));
      await user.click(screen.getByRole('gridcell', { name: '9筋 6段、空のマス、移動可能' }));
    } else if (operation === '新規対局') {
      await user.click(screen.getByRole('button', { name: '新しい対局' }));
    } else if (operation === '投了') {
      await user.click(screen.getByRole('button', { name: '投了' }));
    } else if (operation === '棋譜再生') {
      await user.click(screen.getByRole('button', { name: '初期局面' }));
    } else if (operation === 'unmount') {
      view.unmount();
    } else {
      const id = operation === 'JSON' ? 'shogi-game-record-file-input' : 'shogi-kif-file-input';
      const input = document.getElementById(id);
      if (!(input instanceof HTMLInputElement)) throw new Error('Missing input');
      const content = operation === 'JSON' ? serializeShogiGameRecordV1(initial, new Date('2026-09-18T00:00:00Z'))
        : '#KIF version=2.0 encoding=UTF-8\n手数----指手---------消費時間--\n1 ７六歩(77)\n';
      await user.upload(input, new File([content], operation === 'JSON' ? 'position.json' : 'position.kif', { type: operation === 'JSON' ? 'application/json' : 'text/plain' }));
      await user.click(await screen.findByRole('button', { name: '読み込む' }));
    }
    expect(runner.mock.calls[0][3]?.aborted).toBe(true);
    await act(async () => pending.resolve(results));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.queryByText('静止探索の3条件を順番に解析中（各1秒）')).not.toBeInTheDocument();
  });

  it.each(['駒打ち', '成り選択'] as const)('%sでも比較を中止する', async (operation) => {
    const user = userEvent.setup(); const pending = deferred();
    const state = createInitialBoardState();
    state.squares = state.squares.map((row) => row.map((square) => ({ ...square, piece: null })));
    state.squares[8][4].piece = { id: 's-king', type: 'king', player: 'sente' };
    state.squares[0][4].piece = { id: 'g-king', type: 'king', player: 'gote' };
    if (operation === '駒打ち') state.senteHand = [{ id: 'held-gold', type: 'gold', player: 'sente' }];
    else state.squares[3][2].piece = { id: 'promote-pawn', type: 'pawn', player: 'sente' };
    const runner = vi.fn((_state: BoardState, _depth: number, _milliseconds: number, _signal?: AbortSignal) => pending.promise);
    render(<ShogiResearchScreen initialState={state} timeLimitedQuiescenceComparisonRunner={runner} />);
    await user.click(button());
    if (operation === '駒打ち') {
      const hand = document.querySelector('[data-hand-piece-id="held-gold"]');
      const target = document.querySelector('[data-coordinate="5五"]');
      if (!(hand instanceof HTMLElement) || !(target instanceof HTMLElement)) throw new Error('Missing drop target');
      await user.click(hand); await user.click(target);
      expect(root()).toHaveAttribute('data-history-count', '1');
    } else {
      await user.click(screen.getByRole('gridcell', { name: '7筋 4段、先手の歩兵' }));
      await user.click(screen.getByRole('gridcell', { name: '7筋 3段、空のマス、移動可能' }));
      expect(screen.getByRole('dialog', { name: '成り選択' })).toBeVisible();
      expect(runner.mock.calls[0][3]?.aborted).toBe(true);
      await user.click(screen.getByRole('button', { name: '成る' }));
      expect(root()).toHaveAttribute('data-history-count', '1');
    }
    expect(runner.mock.calls[0][3]?.aborted).toBe(true);
    await act(async () => pending.resolve(results));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it.each(['新規対局', '着手', '再生', 'JSON', 'KIF'] as const)('完成済みの比較結果も%sで破棄する', async (operation) => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={fourMoves()} timeLimitedQuiescenceComparisonRunner={async () => {
      const found: unknown = recordedResults.fourMoves;
      validateTimeLimitedQuiescenceComparison(fourMoves(), 4, 1000, found);
      return found;
    }} />);
    await user.click(button()); await within(panel()).findAllByRole('article');
    if (operation === '新規対局') await user.click(screen.getByRole('button', { name: '新しい対局' }));
    else if (operation === '再生') await user.click(screen.getByRole('button', { name: '初期局面' }));
    else if (operation === '着手') {
      await user.click(screen.getByRole('gridcell', { name: '9筋 7段、先手の歩兵' }));
      await user.click(screen.getByRole('gridcell', { name: '9筋 6段、空のマス、移動可能' }));
    } else {
      const input = document.getElementById(operation === 'JSON' ? 'shogi-game-record-file-input' : 'shogi-kif-file-input');
      if (!(input instanceof HTMLInputElement)) throw new Error('Missing input');
      await user.upload(input, operation === 'JSON'
        ? new File([serializeShogiGameRecordV1(initial, new Date('2026-09-18T00:00:00Z'))], 'initial.json', { type: 'application/json' })
        : new File(['#KIF version=2.0 encoding=UTF-8\n手数----指手---------消費時間--\n1 ７六歩(77)\n'], 'initial.kif', { type: 'text/plain' }));
      await user.click(await screen.findByRole('button', { name: '読み込む' }));
    }
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('分岐作成・本譜復帰・分岐切替で結果と進行中ジョブを破棄する', async () => {
    const user = userEvent.setup(); const pending = deferred();
    const runner = vi.fn((_state: BoardState, _depth: number, _milliseconds: number, _signal?: AbortSignal) => pending.promise);
    render(<ShogiResearchScreen initialState={fourMoves()} timeLimitedQuiescenceComparisonRunner={runner} />);
    await user.click(button());
    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    expect(runner.mock.calls[0][3]?.aborted).toBe(true);
    await user.click(button());
    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    expect(runner.mock.calls[1][3]?.aborted).toBe(true);
    await user.click(button());
    await user.click(screen.getByRole('button', { name: '第2手後からの分岐 1' }));
    expect(runner.mock.calls[2][3]?.aborted).toBe(true);
    await act(async () => pending.resolve(results));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(root()).toHaveAttribute('data-history-count', '2');
  });

  it.each(['内訳', 'PV', '不足', '深さ'] as const)('不正な%sは部分表示せず盤面・棋譜を維持する', async (kind) => {
    const user = userEvent.setup(); const bad = structuredClone(results);
    if (kind === '内訳') Object.assign(bad[0].evaluationBreakdown!, { total: 99999 });
    if (kind === 'PV') bad[0].principalVariation[1] = bad[0].principalVariation[0];
    if (kind === '深さ') bad[0].depth = 2;
    render(<ShogiResearchScreen timeLimitedQuiescenceComparisonRunner={async () => kind === '不足' ? bad.slice(0, 2) : bad} />);
    const before = boardEvidence();
    await user.click(button());
    expect(await screen.findByRole('alert')).toHaveTextContent('比較に失敗');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(boardEvidence()).toEqual(before);
    expect(button()).toBeEnabled();
  });


});
