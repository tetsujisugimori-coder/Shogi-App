import type { PresetTimeLimitedSearchResult } from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerProtocol';
import { DEFAULT_SEARCH_EVALUATION_PRESET_ID } from '../domain/shogi/searchEvaluationPresets';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import {
  executeLegalAction,
  executeMove,
  getLegalActions,
  serializeShogiGameRecordV1,
  type LegalAction,
} from '../domain/shogi';
import { createInitialBoardState, type BoardState } from '../types/shogi';
import { TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerAbortError } from
  '../application/timeLimitedIterativeDeepeningAlphaBetaWorkerClient';

const KIF = '#KIF version=2.0 encoding=UTF-8\n手数----指手---------消費時間--\n1 ７六歩(77)\n';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function workerResult(selectedAction: LegalAction | null): PresetTimeLimitedSearchResult {
  const iteration = {
    selectedAction,
    selectedEvaluation: 42,
    principalVariation: selectedAction ? [selectedAction] : [],
    evaluationBreakdown: {
      total: 42,
      material: 42,
      pieceSquare: 0,
      kingSafety: 0,
      undefendedPieceSafety: 0,
      terminal: null,
    },
    rootLegalActionCount: 30,
    visitedPositionCount: 120,
    depth: 3,
    elapsedMilliseconds: 12.5,
    cutoffCount: 8,
    skippedActionCount: 16,
    quiescenceLeafCount: 0,
    quiescenceVisitedPositionCount: 0,
    quiescenceCutoffCount: 0,
    quiescenceSkippedActionCount: 0,
  };

  return {
    ...iteration,
    evaluationPresetId: DEFAULT_SEARCH_EVALUATION_PRESET_ID,
    quiescenceMaxTacticalDepth: null,
    iterations: [iteration],
    totalVisitedPositionCount: 220,
    totalCutoffCount: 14,
    totalSkippedActionCount: 31,
    totalQuiescenceLeafCount: 0,
    totalQuiescenceVisitedPositionCount: 0,
    totalQuiescenceCutoffCount: 0,
    totalQuiescenceSkippedActionCount: 0,
    requestedMaxDepth: 4,
    completedDepth: 3,
    timedOut: true,
  };
}

function initialAction(): LegalAction {
  const action = getLegalActions(createInitialBoardState())[0];
  if (!action) throw new Error('Initial position must have a legal action.');
  return action;
}

function workerButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '時間制限AIに指させる' });
}

function kifInput(): HTMLInputElement {
  const input = document.getElementById('shogi-kif-file-input');
  if (!(input instanceof HTMLInputElement)) throw new Error('KIF file input not found.');
  return input;
}

function gameRecordInput(): HTMLInputElement {
  const input = document.getElementById('shogi-game-record-file-input');
  if (!(input instanceof HTMLInputElement)) throw new Error('game record file input not found.');
  return input;
}

function stateAfterInitialAction() {
  const execution = executeLegalAction(createInitialBoardState(), initialAction(), { proposer: 'human' });
  if (execution.type !== 'applied') throw new Error('Initial legal action could not be applied.');
  return execution.state;
}

function createFourMoveState() {
  let state = createInitialBoardState();
  const moves = [
    [{ row: 6, col: 2 }, { row: 5, col: 2 }],
    [{ row: 2, col: 6 }, { row: 3, col: 6 }],
    [{ row: 6, col: 3 }, { row: 5, col: 3 }],
    [{ row: 2, col: 5 }, { row: 3, col: 5 }],
  ] as const;

  for (const [from, to] of moves) {
    const execution = executeMove(state, from, to);
    if (execution.type !== 'applied') throw new Error('Four-move fixture could not be applied.');
    state = execution.state;
  }
  return state;
}

describe('時間制限Worker AIの盤面UI接続', () => {
  it('静止探索は初期状態で無効、選択値を固定してWorkerへ渡し、変更時に古い結果を消去する', async () => {
    const user = userEvent.setup();
    const first = deferred<PresetTimeLimitedSearchResult>();
    const second = deferred<PresetTimeLimitedSearchResult>();
    const runner = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<ShogiResearchScreen workerSearchRunner={runner} />);
    const select = screen.getByRole('combobox', { name: '静止探索（駒取りの読み足し）' });

    expect(select).toHaveValue('disabled');
    await user.click(workerButton());
    expect(runner).toHaveBeenLastCalledWith(expect.anything(), 4, 1000, expect.any(AbortSignal), DEFAULT_SEARCH_EVALUATION_PRESET_ID);
    expect(select).toBeDisabled();
    await act(async () => first.resolve(workerResult(initialAction())));
    expect(screen.getByText('静止探索')).toBeVisible();
    expect(within(screen.getByRole('heading', { name: 'AI思考結果' }).closest('section')!).getByText('無効')).toBeVisible();

    await user.selectOptions(select, '2');
    expect(screen.queryByRole('heading', { name: 'AI思考結果' })).not.toBeInTheDocument();
    await user.click(workerButton());
    expect(runner).toHaveBeenLastCalledWith(expect.anything(), 4, 1000, expect.any(AbortSignal), DEFAULT_SEARCH_EVALUATION_PRESET_ID, 2);
    expect(select).toBeDisabled();
    const searchState = runner.mock.calls[1][0] as BoardState;
    const quiescentResult = {
      ...workerResult(getLegalActions(searchState)[0]),
      quiescenceMaxTacticalDepth: 2 as const,
      quiescenceLeafCount: 3,
      quiescenceVisitedPositionCount: 5,
      quiescenceCutoffCount: 2,
      quiescenceSkippedActionCount: 4,
      totalQuiescenceLeafCount: 7,
      totalQuiescenceVisitedPositionCount: 11,
      totalQuiescenceCutoffCount: 6,
      totalQuiescenceSkippedActionCount: 9,
    };
    await act(async () => second.resolve(quiescentResult));
    expect(within(screen.getByRole('heading', { name: 'AI思考結果' }).closest('section')!).getByText('追加2手')).toBeVisible();
    expect(screen.getByText('静止探索の量（通常探索とは別）')).toBeVisible();
    expect(screen.getByText('最深完了反復の静止探索葉数')).toBeVisible();
    expect(screen.getByText('最深完了反復の静止探索調査局面数').nextElementSibling).toHaveTextContent('5');
    expect(screen.getByText('全反復合計の静止探索葉数').nextElementSibling).toHaveTextContent('7');
    expect(select).toBeEnabled();
  });

  it('追加1手を選ぶと1だけをWorkerへ渡す', async () => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    const runner = vi.fn().mockReturnValue(pending.promise);
    render(<ShogiResearchScreen workerSearchRunner={runner} />);

    await user.selectOptions(screen.getByRole('combobox', { name: '静止探索（駒取りの読み足し）' }), '1');
    await user.click(workerButton());

    expect(runner).toHaveBeenCalledWith(expect.anything(), 4, 1000, expect.any(AbortSignal), DEFAULT_SEARCH_EVALUATION_PRESET_ID, 1);
  });

  it('要求と異なる静止探索設定を持つ結果は着手にも表示にも採用しない', async () => {
    const user = userEvent.setup();
    const runner = vi.fn().mockResolvedValue({ ...workerResult(initialAction()), quiescenceMaxTacticalDepth: 1 as const });
    render(<ShogiResearchScreen workerSearchRunner={runner} />);

    await user.click(workerButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('AIの静止探索設定が探索要求と一致しません。');
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
    expect(screen.queryByRole('heading', { name: 'AI思考結果' })).not.toBeInTheDocument();
  });

  it('設定を開始時に固定し、変更後の次回探索と結果表示へ反映する', async () => {
    const user = userEvent.setup();
    const first = deferred<PresetTimeLimitedSearchResult>();
    const second = deferred<PresetTimeLimitedSearchResult>();
    const runner = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<ShogiResearchScreen workerSearchRunner={runner} />);
    const select = screen.getByRole('combobox', { name: '評価プリセット' });
    expect(select).toHaveValue('standard');
    expect(screen.getByText('現在の基本評価を使用します。')).toBeVisible();
    await user.selectOptions(select, 'material-focused');
    await user.click(screen.getByText('AIの判断'));
    await user.click(workerButton());
    expect(select).toBeDisabled();
    expect(runner).toHaveBeenLastCalledWith(expect.anything(), 4, 1000, expect.any(AbortSignal), 'material-focused');
    await user.selectOptions(select, 'king-safety-focused');
    expect(select).toHaveValue('material-focused');
    await act(async () => first.resolve({ ...workerResult(initialAction()), evaluationPresetId: 'material-focused' }));
    expect(screen.getByText('評価設定: 駒得重視')).toBeVisible();
    expect(select).toBeEnabled();
    await user.selectOptions(select, 'king-safety-focused');
    expect(screen.getByText('評価設定: 駒得重視')).toBeVisible();
    await user.click(workerButton());
    expect(runner).toHaveBeenLastCalledWith(expect.anything(), 4, 1000, expect.any(AbortSignal), 'king-safety-focused');
    expect(screen.queryByText('評価設定: 駒得重視')).not.toBeInTheDocument();
    const state = runner.mock.calls[1][0] as BoardState;
    await act(async () => second.resolve({ ...workerResult(getLegalActions(state)[0]), evaluationPresetId: 'king-safety-focused' }));
    expect(screen.getByText('評価設定: 玉の安全重視')).toBeVisible();
    expect(screen.getAllByText('先手 -42')).toHaveLength(2);
  });

  it('中止後の古い設定付き応答は新しい結果のプリセットを巻き戻さない', async () => {
    const user = userEvent.setup();
    const old = deferred<PresetTimeLimitedSearchResult>();
    const fresh = deferred<PresetTimeLimitedSearchResult>();
    const runner = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    render(<ShogiResearchScreen workerSearchRunner={runner} />);
    const select = screen.getByRole('combobox', { name: '評価プリセット' });
    await user.click(screen.getByText('AIの判断'));
    await user.click(workerButton());
    await user.click(screen.getByRole('button', { name: '思考を中止' }));
    await user.selectOptions(select, 'king-safety-focused');
    await user.click(workerButton());
    await act(async () => fresh.resolve({ ...workerResult(initialAction()), evaluationPresetId: 'king-safety-focused' }));
    await act(async () => old.resolve(workerResult(initialAction())));
    expect(screen.getByText('評価設定: 玉の安全重視')).toBeVisible();
    expect(screen.queryByText('評価設定: 標準')).not.toBeInTheDocument();
  });

  it('要求と異なるプリセットを持つ結果は着手にも表示にも採用しない', async () => {
    const user = userEvent.setup();
    const runner = vi.fn().mockResolvedValue({ ...workerResult(initialAction()), evaluationPresetId: 'material-focused' });
    render(<ShogiResearchScreen workerSearchRunner={runner} />);
    await user.click(workerButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('AIの評価設定が探索要求と一致しません。');
    expect(screen.getByRole('gridcell', { name: '9筋 7段、先手の歩兵' })).toBeInTheDocument();
    expect(screen.queryByText('評価設定: 駒得重視')).not.toBeInTheDocument();
  });
  it('別局面の新探索が完了してから届く旧内訳で表示や符号が巻き戻らない', async () => {
    const user = userEvent.setup();
    const old = deferred<PresetTimeLimitedSearchResult>();
    const current = deferred<PresetTimeLimitedSearchResult>();
    const runner = vi.fn<(state: BoardState) => Promise<PresetTimeLimitedSearchResult>>().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    render(<ShogiResearchScreen workerSearchRunner={runner} />);
    await user.click(screen.getByText('AIの判断'));
    await user.click(workerButton());
    await user.click(screen.getByRole('button', { name: '思考を中止' }));
    await user.click(screen.getByRole('gridcell', { name: '7筋 7段、先手の歩兵' }));
    await user.click(screen.getByRole('gridcell', { name: '7筋 6段、空のマス、移動可能' }));
    await user.click(workerButton());
    expect(screen.getByText('解析中')).toBeVisible();
    const searchState = runner.mock.calls[1][0];
    expect(searchState.turn).toBe('gote');
    const fresh = workerResult(getLegalActions(searchState)[0]);
    fresh.selectedEvaluation = 85;
    fresh.evaluationBreakdown = { total: 85, material: 100, pieceSquare: 20, kingSafety: -5, undefendedPieceSafety: -30, terminal: null };
    await act(async () => current.resolve(fresh));
    expect(screen.getAllByText('先手 -85')).toHaveLength(2);
    expect(screen.getByText('+30')).toBeVisible();
    await act(async () => old.resolve(workerResult(initialAction())));
    expect(screen.getAllByText('先手 -85')).toHaveLength(2);
    expect(screen.queryByText('先手 +42')).not.toBeInTheDocument();
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '2');
  });

  it.each(['cancel', 'error'] as const)('新探索開始と%s後に前局面の内訳を残さない', async (outcome) => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    const runner = vi.fn().mockResolvedValueOnce(workerResult(initialAction())).mockReturnValueOnce(pending.promise);
    render(<ShogiResearchScreen workerSearchRunner={runner} />);
    await user.click(screen.getByText('AIの判断'));
    await user.click(workerButton());
    expect(screen.getAllByText('先手 +42')).toHaveLength(2);
    await user.click(workerButton());
    expect(screen.queryByText('先手 +42')).not.toBeInTheDocument();
    expect(screen.getByText('解析中')).toBeVisible();
    if (outcome === 'cancel') await user.click(screen.getByRole('button', { name: '思考を中止' }));
    else await act(async () => pending.reject(new Error('failure')));
    expect(screen.queryByText('内訳合計')).not.toBeInTheDocument();
    expect(screen.getByText('AIの探索結果はまだありません。')).toBeVisible();
  });

  it('通常着手と棋譜再生でも前局面の内訳を破棄する', async () => {
    const user = userEvent.setup();
    const runner = vi.fn(async (state: BoardState) => workerResult(getLegalActions(state)[0]));
    render(<ShogiResearchScreen workerSearchRunner={runner} />);
    await user.click(screen.getByText('AIの判断'));
    await user.click(workerButton());
    expect(screen.getByText('内訳合計')).toBeVisible();
    await user.click(screen.getByRole('gridcell', { name: '3筋 3段、後手の歩兵' }));
    await user.click(screen.getByRole('gridcell', { name: '3筋 4段、空のマス、移動可能' }));
    expect(screen.queryByText('内訳合計')).not.toBeInTheDocument();
    await user.click(workerButton());
    expect(screen.getByText('内訳合計')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '初期局面' }));
    expect(screen.queryByText('内訳合計')).not.toBeInTheDocument();
  });

  it('Worker探索を一度だけ開始し、思考中は重複開始と盤面操作を止める', async () => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    const runner = vi.fn(() => pending.promise);
    render(<ShogiResearchScreen workerSearchRunner={runner} />);

    await user.click(workerButton());
    await user.click(workerButton());
    await user.click(screen.getByRole('gridcell', { name: '7筋 7段、先手の歩兵' }));

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(expect.anything(), 4, 1_000, expect.any(AbortSignal), DEFAULT_SEARCH_EVALUATION_PRESET_ID);
    expect(screen.getByText('AI思考中')).toHaveAttribute('role', 'status');
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
  });

  it('成功した選択手を探索開始局面へ一度だけ適用し、Worker結果を表示する', async () => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    render(<ShogiResearchScreen workerSearchRunner={() => pending.promise} />);

    await user.click(workerButton());
    await act(async () => pending.resolve(workerResult(initialAction())));

    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '1');
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute(
      'data-ai-search-kind',
      'time-limited-worker'
    );
    const panel = screen.getByRole('heading', { name: 'AI思考結果' }).closest('section');
    if (!panel) throw new Error('Worker AI search result panel not found.');
    expect(within(panel).getByText('完了深さ')).toBeInTheDocument();
    expect(within(panel).getByText('指定最大深さ')).toBeInTheDocument();
    expect(within(panel).getByText('API全体の経過時間')).toBeInTheDocument();
    expect(within(panel).getByText('最深完了反復の調査局面数')).toBeInTheDocument();
    expect(within(panel).getByText('全反復合計の調査局面数')).toBeInTheDocument();
  });

  it('検証済みPVを局面ごとの棋譜表記でAIの読み筋として順番に表示し、盤面へは先頭手だけ適用する', async () => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    render(<ShogiResearchScreen workerSearchRunner={() => pending.promise} />);
    const first = initialAction();
    const afterFirst = stateAfterInitialAction();
    const second = getLegalActions(afterFirst)[0];
    if (!second) throw new Error('Expected a second legal action.');
    const result = workerResult(first);
    result.principalVariation = [first, second];
    result.iterations[0].principalVariation = [first, second];

    await user.click(workerButton());
    await act(async () => pending.resolve(result));

    const panel = screen.getByRole('heading', { name: 'AI思考結果' }).closest('section');
    if (!panel) throw new Error('Worker AI search result panel not found.');
    await user.click(screen.getByText('AIの判断'));
    const judgment = screen.getByText('AIの判断').closest('details')!;
    expect(within(judgment).getByRole('heading', { name: 'AIの読み筋' })).toBeInTheDocument();
    expect(within(judgment).getByText('完了深さ 3 ply 中 2 手順')).toBeInTheDocument();
    expect(within(judgment).getAllByRole('listitem')).toHaveLength(2);
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '1');
  });

  it('先頭不一致、途中不正手、完了深さ超過のWorker PVは盤面と成功表示を変えず拒否する', async () => {
    const cases = [
      (result: PresetTimeLimitedSearchResult) => {
        const differentAction = getLegalActions(createInitialBoardState())[1];
        if (!differentAction) throw new Error('Expected a distinct legal action.');
        result.principalVariation = [differentAction];
      },
      (result: PresetTimeLimitedSearchResult) => {
        result.principalVariation = [result.selectedAction!, result.selectedAction!];
      },
      (result: PresetTimeLimitedSearchResult) => {
        result.principalVariation = [result.selectedAction!, result.selectedAction!, result.selectedAction!, result.selectedAction!];
      },
    ];

    for (const modify of cases) {
      const user = userEvent.setup();
      const pending = deferred<PresetTimeLimitedSearchResult>();
      const rendered = render(<ShogiResearchScreen workerSearchRunner={() => pending.promise} />);
      const result = workerResult(initialAction());
      modify(result);
      result.iterations[0].principalVariation = result.principalVariation;

      await user.click(workerButton());
      await act(async () => pending.resolve(result));

      expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
      expect(screen.queryByRole('heading', { name: 'AI思考結果' })).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('AIの読み筋を検証できませんでした。');
      rendered.unmount();
    }
  });

  it('適用できないWorkerのselectedActionは盤面も成功表示も変更せず、利用者向けエラーにする', async () => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    render(<ShogiResearchScreen workerSearchRunner={() => pending.promise} />);

    await user.click(workerButton());
    // LegalAction型には適合するが、Worker契約に反して後手の駒を指す入力である。
    const invalidWorkerAction: LegalAction = {
      kind: 'move',
      player: 'sente',
      from: { row: 0, col: 0 },
      to: { row: 1, col: 0 },
      pieceType: 'lance',
      promotion: 'none',
    };
    await act(async () => pending.resolve(workerResult(invalidWorkerAction)));

    const root = document.getElementById('shogi-research-screen')!;
    expect(root).toHaveAttribute('data-history-count', '0');
    expect(root).toHaveAttribute('data-turn', 'sente');
    expect(root).toHaveAttribute('data-move-number', '1');
    expect(root).toHaveAttribute('data-last-move', '');
    expect(screen.queryByRole('heading', { name: 'AI思考結果' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('AIの指し手を適用できませんでした。');
  });

  it('通常の探索開始局面でselectedActionがないWorker結果は成功表示にしない', async () => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    render(<ShogiResearchScreen workerSearchRunner={() => pending.promise} />);

    await user.click(workerButton());
    await act(async () => pending.resolve(workerResult(null)));

    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
    expect(screen.queryByRole('heading', { name: 'AI思考結果' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('AIの指し手を受け取れませんでした。');
  });

  it('Worker失敗では盤面を変更せず、通常エラーをalertで表示する', async () => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    render(<ShogiResearchScreen workerSearchRunner={() => pending.promise} />);

    await user.click(workerButton());
    await act(async () => pending.reject(new Error('worker unavailable')));

    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
    expect(screen.getByRole('alert')).toHaveTextContent('worker unavailable');
  });

  it('明示的な中止はsignalをabortし、AbortErrorを通常エラーとして表示しない', async () => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    let signal: AbortSignal | undefined;
    render(
      <ShogiResearchScreen
        workerSearchRunner={(_, __, ___, receivedSignal) => {
          signal = receivedSignal;
          return pending.promise;
        }}
      />
    );

    await user.click(workerButton());
    await user.click(screen.getByRole('button', { name: '思考を中止' }));
    await act(async () => pending.reject(new TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerAbortError()));

    expect(signal?.aborted).toBe(true);
    expect(screen.getByText('時間制限AIの思考を中止しました。')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
  });

  it('中止後や局面置換後に遅れて届く成功結果を適用しない', async () => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    let signal: AbortSignal | undefined;
    render(
      <ShogiResearchScreen
        workerSearchRunner={(_, __, ___, receivedSignal) => {
          signal = receivedSignal;
          return pending.promise;
        }}
      />
    );

    await user.click(workerButton());
    await user.click(screen.getByRole('button', { name: '新しい対局' }));
    await user.click(screen.getByRole('button', { name: '新しい対局を始める' }));
    await act(async () => pending.resolve(workerResult(initialAction())));

    expect(signal?.aborted).toBe(true);
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
    expect(screen.queryByRole('heading', { name: 'AI思考結果' })).not.toBeInTheDocument();
  });

  it('KIF読込確定と棋譜再生位置への移動で探索を中止する', async () => {
    const user = userEvent.setup();
    const first = deferred<PresetTimeLimitedSearchResult>();
    const second = deferred<PresetTimeLimitedSearchResult>();
    const signals: AbortSignal[] = [];
    const runner = vi.fn()
      .mockImplementationOnce((_: unknown, __: unknown, ___: unknown, signal: AbortSignal) => {
        signals.push(signal);
        return first.promise;
      })
      .mockImplementationOnce((_: unknown, __: unknown, ___: unknown, signal: AbortSignal) => {
        signals.push(signal);
        return second.promise;
      });
    const rendered = render(<ShogiResearchScreen workerSearchRunner={runner} />);

    await user.click(workerButton());
    await user.upload(kifInput(), new File([KIF], 'replace.kif', { type: 'text/plain' }));
    await user.click(await screen.findByRole('button', { name: '読み込む' }));
    expect(signals[0]?.aborted).toBe(true);

    rendered.unmount();
    render(<ShogiResearchScreen initialState={stateAfterInitialAction()} workerSearchRunner={runner} />);
    await user.click(workerButton());
    await user.click(screen.getByRole('button', { name: '初期局面' }));

    expect(signals[1]?.aborted).toBe(true);
  });

  it('JSON読込確定は探索を中止し、遅延した成功結果で読込後の局面を上書きしない', async () => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    let signal: AbortSignal | undefined;
    render(
      <ShogiResearchScreen
        workerSearchRunner={(_, __, ___, receivedSignal) => {
          signal = receivedSignal;
          return pending.promise;
        }}
      />
    );

    await user.click(workerButton());
    await user.upload(
      gameRecordInput(),
      new File(
        [serializeShogiGameRecordV1(stateAfterInitialAction(), new Date('2026-09-12T00:00:00.000Z'))],
        'loaded.json',
        { type: 'application/json' }
      )
    );
    await user.click(await screen.findByRole('button', { name: '読み込む' }));

    const root = document.getElementById('shogi-research-screen')!;
    expect(signal?.aborted).toBe(true);
    expect(root).toHaveAttribute('data-history-count', '1');
    expect(root).toHaveAttribute('data-turn', 'gote');
    expect(root).toHaveAttribute('data-move-number', '2');
    expect(root).toHaveAttribute('data-last-move', '▲9六歩');

    await act(async () => pending.resolve(workerResult(initialAction())));

    expect(root).toHaveAttribute('data-history-count', '1');
    expect(root).toHaveAttribute('data-turn', 'gote');
    expect(root).toHaveAttribute('data-move-number', '2');
    expect(root).toHaveAttribute('data-last-move', '▲9六歩');
    expect(screen.queryByRole('heading', { name: 'AI思考結果' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('JSON読込後の遅延したWorker失敗はエラー表示を上書きしない', async () => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    render(<ShogiResearchScreen workerSearchRunner={() => pending.promise} />);

    await user.click(workerButton());
    await user.upload(
      gameRecordInput(),
      new File(
        [serializeShogiGameRecordV1(createInitialBoardState(), new Date('2026-09-12T00:00:00.000Z'))],
        'initial.json',
        { type: 'application/json' }
      )
    );
    await user.click(await screen.findByRole('button', { name: '読み込む' }));
    await act(async () => pending.reject(new Error('late worker failure')));

    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
    expect(screen.queryByRole('heading', { name: 'AI思考結果' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('分岐開始・本譜復帰・保存済み分岐への切替は探索を中止し、遅延結果を反映しない', async () => {
    const user = userEvent.setup();
    const pendingSearches = [
      deferred<PresetTimeLimitedSearchResult>(),
      deferred<PresetTimeLimitedSearchResult>(),
      deferred<PresetTimeLimitedSearchResult>(),
    ];
    const signals: AbortSignal[] = [];
    const runner = vi.fn((_: unknown, __: unknown, ___: unknown, signal?: AbortSignal) => {
      if (!signal) throw new Error('Worker search signal was not provided.');
      signals.push(signal);
      const pending = pendingSearches[signals.length - 1];
      if (!pending) throw new Error('Unexpected worker search.');
      return pending.promise;
    });
    render(<ShogiResearchScreen initialState={createFourMoveState()} workerSearchRunner={runner} />);

    await user.click(workerButton());
    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    expect(signals[0]?.aborted).toBe(true);
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));

    await user.click(workerButton());
    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    expect(signals[1]?.aborted).toBe(true);

    await user.click(workerButton());
    await user.click(screen.getByRole('button', { name: '第2手後からの分岐 1' }));
    expect(signals[2]?.aborted).toBe(true);

    const root = document.getElementById('shogi-research-screen')!;
    expect(root).toHaveAttribute('data-history-count', '2');
    expect(root).toHaveAttribute('data-branch-origin-history-index', '2');
    expect(root).toHaveAttribute('data-session-branch-count', '1');
    await act(async () => pendingSearches[2].resolve(workerResult(initialAction())));
    expect(root).toHaveAttribute('data-history-count', '2');
    expect(root).toHaveAttribute('data-branch-origin-history-index', '2');
    expect(screen.queryByRole('heading', { name: 'AI思考結果' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('中止済みの古い探索は次の探索結果や盤面を上書きしない', async () => {
    const user = userEvent.setup();
    const first = deferred<PresetTimeLimitedSearchResult>();
    const second = deferred<PresetTimeLimitedSearchResult>();
    const runner = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<ShogiResearchScreen workerSearchRunner={runner} />);

    await user.click(workerButton());
    await user.click(screen.getByRole('button', { name: '思考を中止' }));
    await user.click(workerButton());
    await act(async () => first.resolve(workerResult(initialAction())));
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');

    await act(async () => second.resolve(workerResult(initialAction())));
    expect(runner).toHaveBeenCalledTimes(2);
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '1');
  });

  it('アンマウント時に実行中の探索を中止する', async () => {
    const user = userEvent.setup();
    const pending = deferred<PresetTimeLimitedSearchResult>();
    let signal: AbortSignal | undefined;
    const rendered = render(
      <ShogiResearchScreen
        workerSearchRunner={(_, __, ___, receivedSignal) => {
          signal = receivedSignal;
          return pending.promise;
        }}
      />
    );

    await user.click(workerButton());
    rendered.unmount();

    expect(signal?.aborted).toBe(true);
  });
});
