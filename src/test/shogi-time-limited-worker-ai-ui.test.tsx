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
  type TimeLimitedIterativeDeepeningAlphaBetaSearchResult,
} from '../domain/shogi';
import { createInitialBoardState } from '../types/shogi';
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

function workerResult(selectedAction: LegalAction | null): TimeLimitedIterativeDeepeningAlphaBetaSearchResult {
  const iteration = {
    selectedAction,
    selectedEvaluation: 42,
    rootLegalActionCount: 30,
    visitedPositionCount: 120,
    depth: 3,
    elapsedMilliseconds: 12.5,
    cutoffCount: 8,
    skippedActionCount: 16,
  };

  return {
    ...iteration,
    iterations: [iteration],
    totalVisitedPositionCount: 220,
    totalCutoffCount: 14,
    totalSkippedActionCount: 31,
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
  it('Worker探索を一度だけ開始し、思考中は重複開始と盤面操作を止める', async () => {
    const user = userEvent.setup();
    const pending = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
    const runner = vi.fn(() => pending.promise);
    render(<ShogiResearchScreen workerSearchRunner={runner} />);

    await user.click(workerButton());
    await user.click(workerButton());
    await user.click(screen.getByRole('gridcell', { name: '7筋 7段、先手の歩兵' }));

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(expect.anything(), 4, 1_000, expect.any(AbortSignal));
    expect(screen.getByText('AI思考中')).toHaveAttribute('role', 'status');
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
  });

  it('成功した選択手を探索開始局面へ一度だけ適用し、Worker結果を表示する', async () => {
    const user = userEvent.setup();
    const pending = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
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

  it('適用できないWorkerのselectedActionは盤面も成功表示も変更せず、利用者向けエラーにする', async () => {
    const user = userEvent.setup();
    const pending = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
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
    const pending = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
    render(<ShogiResearchScreen workerSearchRunner={() => pending.promise} />);

    await user.click(workerButton());
    await act(async () => pending.resolve(workerResult(null)));

    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
    expect(screen.queryByRole('heading', { name: 'AI思考結果' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('AIの指し手を受け取れませんでした。');
  });

  it('Worker失敗では盤面を変更せず、通常エラーをalertで表示する', async () => {
    const user = userEvent.setup();
    const pending = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
    render(<ShogiResearchScreen workerSearchRunner={() => pending.promise} />);

    await user.click(workerButton());
    await act(async () => pending.reject(new Error('worker unavailable')));

    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
    expect(screen.getByRole('alert')).toHaveTextContent('worker unavailable');
  });

  it('明示的な中止はsignalをabortし、AbortErrorを通常エラーとして表示しない', async () => {
    const user = userEvent.setup();
    const pending = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
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
    const pending = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
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
    const first = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
    const second = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
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
    const pending = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
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
    const pending = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
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
      deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>(),
      deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>(),
      deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>(),
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
    const first = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
    const second = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
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
    const pending = deferred<TimeLimitedIterativeDeepeningAlphaBetaSearchResult>();
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
