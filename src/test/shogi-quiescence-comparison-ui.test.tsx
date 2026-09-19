import { comparisonCaptureTrap, comparisonExtendedPv } from './fixtures/quiescenceComparisonPositions';
import { analyzeEvaluationPresetComparison } from '../domain/shogi/evaluationPresetComparison';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import { analyzeQuiescenceComparison, type QuiescenceComparisonResult } from '../domain/shogi/quiescenceComparison';
import { executeMove, serializeShogiGameRecordV1 } from '../domain/shogi';
import { createInitialBoardState, type BoardState } from '../types/shogi';
import { QUIESCENCE_COMPARISON_SETTINGS } from '../domain/shogi/quiescenceComparison';
import { quiescenceComparisonName } from '../components/shogi/QuiescenceComparisonPanel';
import { formatSenteEvaluation } from '../components/shogi/searchEvaluationDisplay';
import recordedResults from './fixtures/quiescence-comparison-results.json';
import { validateQuiescenceComparison } from '../application/quiescenceComparisonValidation';

type Results = readonly QuiescenceComparisonResult[];
let results: Results;
const initial = createInitialBoardState();
// Recorded from the real comparison with clock=() => 0. UI tests exercise the
// Worker boundary; domain tests separately run the real three-pass search.
beforeAll(() => {
  validateQuiescenceComparison(initial, 3, recordedResults.initial);
  validateQuiescenceComparison(fourMoves(), 3, recordedResults.fourMoves);
  results = recordedResults.initial;
});
function deferred() {
  let resolve!: (result: Results) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Results>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}
const button = () => screen.getByRole('button', { name: '静止探索を固定深さ3で比較' });
const panel = () => screen.getByRole('region', { name: '静止探索設定の比較' });
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

describe('解析専用の静止探索比較UI', () => {
  it('4手の主変化と固定深さ3を区別して表示する', async () => {
    const user = userEvent.setup();
    const state = comparisonExtendedPv();
    render(<ShogiResearchScreen initialState={state} quiescenceComparisonRunner={async (s) => analyzeQuiescenceComparison(s, 3, () => 0)} />);
    await user.click(button());
    const cards = await within(panel()).findAllByRole('article');
    expect(within(cards[1]).getAllByRole('listitem')).toHaveLength(4);
    expect(cards[1]).toHaveTextContent('3 ply');
    expect(panel()).toHaveTextContent('3手を超える場合');
  });

  it('評価比較結果・保存データを開始/中止/完了で維持し、3種類のWorkerを排他制御する', async () => {
    const user = userEvent.setup(); const pending = deferred();
    const state = comparisonCaptureTrap();
    const presetRunner = vi.fn(async (s: BoardState) => analyzeEvaluationPresetComparison(s, 3, () => 0));
    const runner = vi.fn((_s: BoardState, _depth: number, _signal?: AbortSignal) => pending.promise);
    const workerRunner = vi.fn(() => new Promise<never>(() => {}));
    render(<ShogiResearchScreen initialState={state} comparisonRunner={presetRunner} quiescenceComparisonRunner={runner} workerSearchRunner={workerRunner} />);
    const stored = { ...localStorage };
    await user.click(screen.getByRole('button', { name: '3プリセットを比較' }));
    const presetPanel = screen.getByRole('region', { name: '評価プリセットの比較' });
    await within(presetPanel).findAllByRole('article');
    const prior = presetPanel.textContent;
    await user.click(button());
    expect(presetPanel.textContent).toBe(prior);
    expect(screen.getByRole('combobox', { name: '静止探索（駒取りの読み足し）' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '時間制限AIに指させる' }));
    await user.click(screen.getByRole('button', { name: '3プリセットを比較' }));
    expect(workerRunner).not.toHaveBeenCalled();
    expect(presetRunner).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '静止探索比較を中止' }));
    expect(presetPanel.textContent).toBe(prior);
    await user.click(button());
    await act(async () => pending.resolve(analyzeQuiescenceComparison(state, 3, () => 0)));
    expect(within(panel()).getAllByRole('article')).toHaveLength(3);
    expect(presetPanel.textContent).toBe(prior);
    expect({ ...localStorage }).toEqual(stored);
    await user.click(screen.getByRole('button', { name: '時間制限AIに指させる' }));
    expect(button()).toBeDisabled();
    await user.click(button());
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('評価プリセット比較中は静止探索比較を開始しない', async () => {
    const user = userEvent.setup();
    const runner = vi.fn(async () => results);
    render(<ShogiResearchScreen comparisonRunner={() => new Promise<never>(() => {})} quiescenceComparisonRunner={runner} />);
    await user.click(screen.getByRole('button', { name: '3プリセットを比較' }));
    expect(button()).toBeDisabled();
    await user.click(button());
    expect(runner).not.toHaveBeenCalled();
  });

  it('不変局面と深さ3で開始し、競合AIを止め、全結果を固定順で表示する', async () => {
    const user = userEvent.setup(); const pending = deferred();
    const runner = vi.fn((_state: BoardState, _depth: number, _signal?: AbortSignal) => pending.promise);
    const state = comparisonCaptureTrap(true); const original = structuredClone(state);
    render(<ShogiResearchScreen initialState={state} quiescenceComparisonRunner={runner} />);
    const select = screen.getByRole('combobox', { name: '評価プリセット' });
    await user.selectOptions(select, 'king-safety-focused');
    const before = boardEvidence();
    await user.click(button());
    expect(runner).toHaveBeenCalledWith(expect.anything(), 3, expect.any(AbortSignal));
    expect(Object.isFrozen(runner.mock.calls[0][0])).toBe(true);
    expect(screen.getByText('静止探索の3条件を解析中')).toBeVisible();
    expect(screen.getByRole('button', { name: '静止探索比較を中止' })).toBeVisible();
    for (const name of ['2手読みAIに指させる', '時間制限AIに指させる', '3プリセットを比較']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(select).toBeDisabled();
    const found = analyzeQuiescenceComparison(state, 3, () => 0);
    await act(async () => pending.resolve(found));
    const cards = within(panel()).getAllByRole('article');
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual(QUIESCENCE_COMPARISON_SETTINGS.map((id) => quiescenceComparisonName(id)));
    for (const [index, card] of cards.entries()) {
      for (const label of ['推奨手', '評価値', '固定深さ', '主変化', '通常探索の訪問局面数', '通常探索のカットオフ回数', '通常探索のスキップ手数', '静止探索を開始した葉の数', '静止探索の訪問局面数', '静止探索のカットオフ回数', '静止探索のスキップ手数', '参考処理時間']) {
        expect(within(card).getByText(label, { exact: true })).toBeVisible();
      }
      expect(card).toHaveTextContent(`先手 ${formatSenteEvaluation(found[index].selectedEvaluation, state.turn)}`);
      expect(card).toHaveTextContent(quiescenceComparisonName(found[index].quiescenceMaxTacticalDepth));
      expect(within(card).getAllByRole('listitem')).toHaveLength(found[index].principalVariation.length);
    }
    expect(boardEvidence()).toEqual(before);
    expect(state).toEqual(original);
    expect(select).toHaveValue('king-safety-focused');
    expect(select).toBeEnabled();
    expect(button()).toBeEnabled();
  });

  it('単独AIの判断・統計・選択プリセットを上書きせず後手基準を先手表示へ変換する', async () => {
    const user = userEvent.setup();
    const runner = vi.fn(async (state: BoardState) => analyzeQuiescenceComparison(state, 3, () => 0));
    render(<ShogiResearchScreen initialState={comparisonCaptureTrap()} quiescenceComparisonRunner={runner} />);
    await user.selectOptions(screen.getByRole('combobox', { name: '評価プリセット' }), 'material-focused');
    await user.click(screen.getByRole('button', { name: '2手読みAIに指させる' }));
    await user.click(screen.getByText('AIの判断'));
    const judgment = screen.getByText('AIの判断').closest('details')!;
    const text = judgment.textContent;
    const before = boardEvidence();
    await user.click(button());
    await within(panel()).findAllByRole('article');
    expect(judgment.textContent).toBe(text);
    expect(boardEvidence()).toEqual(before);
    expect(screen.getByRole('combobox', { name: '評価プリセット' })).toHaveValue('material-focused');
    const goteResults = await runner.mock.results[0].value;
    expect(runner.mock.calls[0][0].turn).toBe('gote');
    expect(within(panel()).getAllByRole('article')[0]).toHaveTextContent(`先手 ${formatSenteEvaluation(goteResults[0].selectedEvaluation, 'gote')}`);
  });

  it('再開始時に結果を消し、中止後の旧世代成功・失敗を無視する', async () => {
    const user = userEvent.setup(); const first = deferred(); const second = deferred();
    const runner = vi.fn().mockResolvedValueOnce(results).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<ShogiResearchScreen quiescenceComparisonRunner={runner} />);
    await user.click(button()); await within(panel()).findAllByRole('article');
    await user.click(button());
    expect(within(panel()).queryAllByRole('article')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '静止探索比較を中止' }));
    expect(runner.mock.calls[1][2].aborted).toBe(true);
    await user.click(button());
    await act(async () => first.resolve(results));
    expect(screen.getByText('静止探索の3条件を解析中')).toBeVisible();
    expect(within(panel()).queryAllByRole('article')).toHaveLength(0);
    await act(async () => second.reject(new Error('comparison failed')));
    expect(screen.getByRole('alert')).toHaveTextContent('comparison failed');
    expect(button()).toBeEnabled();
    expect(within(panel()).queryAllByRole('article')).toHaveLength(0);
  });

  it.each(['通常着手', '新規対局', '投了', '棋譜再生', 'JSON', 'KIF', 'unmount'] as const)('%sで中止し、遅延した結果を表示しない', async (operation) => {
    const user = userEvent.setup(); const pending = deferred();
    const runner = vi.fn((_state: BoardState, _depth: number, _signal?: AbortSignal) => pending.promise);
    const view = render(<ShogiResearchScreen initialState={fourMoves()} quiescenceComparisonRunner={runner} />);
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
    expect(runner.mock.calls[0][2]?.aborted).toBe(true);
    await act(async () => pending.resolve(results));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.queryByText('静止探索の3条件を解析中')).not.toBeInTheDocument();
  });

  it.each(['駒打ち', '成り選択'] as const)('%sでも比較を中止する', async (operation) => {
    const user = userEvent.setup(); const pending = deferred();
    const state = createInitialBoardState();
    state.squares = state.squares.map((row) => row.map((square) => ({ ...square, piece: null })));
    state.squares[8][4].piece = { id: 's-king', type: 'king', player: 'sente' };
    state.squares[0][4].piece = { id: 'g-king', type: 'king', player: 'gote' };
    if (operation === '駒打ち') state.senteHand = [{ id: 'held-gold', type: 'gold', player: 'sente' }];
    else state.squares[3][2].piece = { id: 'promote-pawn', type: 'pawn', player: 'sente' };
    const runner = vi.fn((_state: BoardState, _depth: number, _signal?: AbortSignal) => pending.promise);
    render(<ShogiResearchScreen initialState={state} quiescenceComparisonRunner={runner} />);
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
      expect(runner.mock.calls[0][2]?.aborted).toBe(true);
      await user.click(screen.getByRole('button', { name: '成る' }));
      expect(root()).toHaveAttribute('data-history-count', '1');
    }
    expect(runner.mock.calls[0][2]?.aborted).toBe(true);
    await act(async () => pending.resolve(results));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it.each(['新規対局', '着手', '再生', 'JSON', 'KIF'] as const)('完成済みの比較結果も%sで破棄する', async (operation) => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={fourMoves()} quiescenceComparisonRunner={async () => {
      const found: unknown = recordedResults.fourMoves;
      validateQuiescenceComparison(fourMoves(), 3, found);
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
    const runner = vi.fn((_state: BoardState, _depth: number, _signal?: AbortSignal) => pending.promise);
    render(<ShogiResearchScreen initialState={fourMoves()} quiescenceComparisonRunner={runner} />);
    await user.click(button());
    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    expect(runner.mock.calls[0][2]?.aborted).toBe(true);
    await user.click(button());
    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    expect(runner.mock.calls[1][2]?.aborted).toBe(true);
    await user.click(button());
    await user.click(screen.getByRole('button', { name: '第2手後からの分岐 1' }));
    expect(runner.mock.calls[2][2]?.aborted).toBe(true);
    await act(async () => pending.resolve(results));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(root()).toHaveAttribute('data-history-count', '2');
  });

  it.each(['内訳', 'PV', '不足', '深さ'] as const)('不正な%sは部分表示せず盤面・棋譜を維持する', async (kind) => {
    const user = userEvent.setup(); const bad = structuredClone(results);
    if (kind === '内訳') Object.assign(bad[0].evaluationBreakdown, { total: 99999 });
    if (kind === 'PV') bad[0].principalVariation[1] = bad[0].principalVariation[0];
    if (kind === '深さ') bad[0].depth = 2;
    render(<ShogiResearchScreen quiescenceComparisonRunner={async () => kind === '不足' ? bad.slice(0, 2) : bad} />);
    const before = boardEvidence();
    await user.click(button());
    expect(await screen.findByRole('alert')).toHaveTextContent('比較に失敗');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(boardEvidence()).toEqual(before);
    expect(button()).toBeEnabled();
  });

  it('同じ推奨手3件を正常表示し、単独AI開始時に結果を破棄する', async () => {
    const user = userEvent.setup();
    const same = QUIESCENCE_COMPARISON_SETTINGS.map((quiescenceMaxTacticalDepth) => ({ ...results[0], quiescenceMaxTacticalDepth }));
    render(<ShogiResearchScreen quiescenceComparisonRunner={async () => same} />);
    await user.click(button());
    expect(await within(panel()).findAllByRole('article')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: '2手読みAIに指させる' }));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('終局済み局面では開始できず、合法手なしの局面は安全に表示する', async () => {
    const user = userEvent.setup(); const runner = vi.fn(async (state: BoardState) => analyzeQuiescenceComparison(state, 3, () => 0));
    const ended: BoardState = { ...initial, status: 'ended', result: { winner: 'sente', loser: 'gote', endReason: 'resignation' } };
    const view = render(<ShogiResearchScreen initialState={ended} quiescenceComparisonRunner={runner} />);
    expect(button()).toBeDisabled(); expect(runner).not.toHaveBeenCalled(); view.unmount();
    const noMoves: BoardState = { ...initial, squares: initial.squares.map((row) => row.map((square) => ({ ...square, piece: null }))) };
    render(<ShogiResearchScreen initialState={noMoves} quiescenceComparisonRunner={runner} />);
    await user.click(button());
    expect(await screen.findAllByText('指せる手はありません')).toHaveLength(3);
  });
});
