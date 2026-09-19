import { DEFAULT_SEARCH_EVALUATION_PRESET_ID, resolveSearchEvaluationPreset, SEARCH_EVALUATION_PRESET_IDS, type SearchEvaluationPresetId } from '../domain/shogi/searchEvaluationPresets';
import { describe, expect, it, vi } from 'vitest';
import {
  analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch,
  cloneBoardSquares,
  type TimeLimitedIterativeDeepeningAlphaBetaSearchResult,
} from '../domain/shogi';
import { createInitialBoardState, type Piece } from '../types/shogi';
import {
  createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient,
  runTimeLimitedIterativeDeepeningAlphaBetaSearchInWorker,
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerAbortError,
  type TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerLike,
} from '../application/timeLimitedIterativeDeepeningAlphaBetaWorkerClient';
import {
  handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest,
  type TimeLimitedIterativeDeepeningAlphaBetaSearch,
} from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerHandler';
import type {
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest,
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse,
} from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerProtocol';

function request(overrides: Partial<TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest> = {}) {
  return {
    type: 'run-time-limited-iterative-deepening-alpha-beta-search' as const,
    requestId: 'request-1',
    state: createInitialBoardState(),
    maxDepth: 1,
    timeLimitMilliseconds: 1_000,
    ...overrides,
  };
}

function captureTrapState() {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) for (const square of row) square.piece = null;
  const piece = (id: string, type: Piece['type'], player: Piece['player']): Piece => ({ id, type, player });
  squares[8][8].piece = piece('sente-king', 'king', 'sente');
  squares[0][8].piece = piece('gote-king', 'king', 'gote');
  squares[5][4].piece = piece('sente-rook', 'rook', 'sente');
  squares[4][4].piece = piece('gote-pawn', 'pawn', 'gote');
  squares[3][4].piece = piece('gote-recapturing-pawn', 'pawn', 'gote');
  return { ...initial, squares, senteHand: [], goteHand: [], turn: 'sente' as const };
}

function comparableResult(result: TimeLimitedIterativeDeepeningAlphaBetaSearchResult) {
  return {
    selectedAction: result.selectedAction,
    selectedEvaluation: result.selectedEvaluation,
    principalVariation: result.principalVariation,
    evaluationBreakdown: result.evaluationBreakdown,
    requestedMaxDepth: result.requestedMaxDepth,
    completedDepth: result.completedDepth,
    timedOut: result.timedOut,
    iterationDepths: result.iterations.map((iteration) => iteration.depth),
    visitedPositionCount: result.visitedPositionCount,
    cutoffCount: result.cutoffCount,
    skippedActionCount: result.skippedActionCount,
    totalVisitedPositionCount: result.totalVisitedPositionCount,
    totalCutoffCount: result.totalCutoffCount,
    totalSkippedActionCount: result.totalSkippedActionCount,
  };
}

function createFakeWorker(options: { postMessageError?: unknown } = {}) {
  const listeners: {
    message: Array<(event: MessageEvent<unknown>) => void>;
    error: Array<(event: ErrorEvent) => void>;
    messageerror: Array<(event: MessageEvent<unknown>) => void>;
  } = { message: [], error: [], messageerror: [] };
  const terminate = vi.fn();
  const postMessage = vi.fn(() => {
    if (options.postMessageError !== undefined) throw options.postMessageError;
  });
  const worker = {
    addEventListener(type: keyof typeof listeners, listener: never) {
      listeners[type].push(listener);
    },
    postMessage,
    terminate,
  } as unknown as TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerLike;

  return {
    worker,
    postMessage,
    terminate,
    emitMessage(response: TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse) {
      listeners.message.forEach((listener) => listener({ data: response } as MessageEvent<unknown>));
    },
    emitError(message: string) {
      listeners.error.forEach((listener) => listener({ message } as ErrorEvent));
    },
    emitMessageError() {
      listeners.messageerror.forEach((listener) => listener({} as MessageEvent<unknown>));
    },
  };
}

async function expectWorkerAbort(pending: Promise<unknown>): Promise<void> {
  try {
    await pending;
    throw new Error('Expected the Worker search to be aborted.');
  } catch (error) {
    expect(error).toBeInstanceOf(TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerAbortError);
    expect(error).toMatchObject({ name: 'AbortError' });
  }
}

describe('時間制限付き反復深化αβ探索Workerの純粋処理', () => {
  it.each(SEARCH_EVALUATION_PRESET_IDS)('共有設定を探索へ渡し、実際のIDと完了反復の内訳を返す: %s', (id) => {
    const input = structuredClone(request({ evaluationPresetId: id, maxDepth: 2 }));
    const search = vi.fn((state, depth, milliseconds, evaluation) =>
      analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, depth, milliseconds, evaluation, () => 0));
    const response = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(input, search);
    expect(search).toHaveBeenCalledWith(input.state, 2, 1000, resolveSearchEvaluationPreset(id));
    expect(response.type).toBe('time-limited-iterative-deepening-alpha-beta-search-succeeded');
    if (response.type !== 'time-limited-iterative-deepening-alpha-beta-search-succeeded') throw new Error('Expected success');
    expect(response.result).toEqual({
      ...analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.state, 2, 1000, resolveSearchEvaluationPreset(id), () => 0),
      evaluationPresetId: id,
      quiescenceMaxTacticalDepth: null,
    });
    expect(structuredClone(response)).toEqual(response);
  });

  it.each(['unknown', '__proto__', null, 1])('不正なWorkerプリセットIDは探索前に失敗する: %s', (id) => {
    const search = vi.fn(analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch);
    const response = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(
      request({ evaluationPresetId: id as SearchEvaluationPresetId }), search);
    expect(response).toMatchObject({ type: 'time-limited-iterative-deepening-alpha-beta-search-failed', errorMessage: 'Unknown search evaluation preset.' });
    expect(search).not.toHaveBeenCalled();
  });

  it.each([1, 2] as const)('静止探索の追加%s手を探索optionsへ変換し、成功応答へ実値を含める', (depth) => {
    const search = vi.fn(analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch);
    const input = request({ quiescenceMaxTacticalDepth: depth });

    const response = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(input, search);

    expect(search).toHaveBeenCalledWith(
      input.state,
      input.maxDepth,
      input.timeLimitMilliseconds,
      resolveSearchEvaluationPreset(),
      undefined,
      { quiescence: { maxTacticalDepth: depth } }
    );
    expect(response).toMatchObject({
      type: 'time-limited-iterative-deepening-alpha-beta-search-succeeded',
      result: { quiescenceMaxTacticalDepth: depth },
    });
  });

  it('PR #113相当の取り返し局面をWorker経由で静止探索し、統計と使用設定を保持する', () => {
    const response = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(request({
      state: captureTrapState(),
      maxDepth: 1,
      quiescenceMaxTacticalDepth: 2,
    }));

    expect(response).toMatchObject({
      type: 'time-limited-iterative-deepening-alpha-beta-search-succeeded',
      result: { quiescenceMaxTacticalDepth: 2 },
    });
    if (response.type !== 'time-limited-iterative-deepening-alpha-beta-search-succeeded') throw new Error('Expected success');
    expect(response.result.quiescenceLeafCount).toBeGreaterThan(0);
    expect(response.result.totalQuiescenceLeafCount).toBe(response.result.quiescenceLeafCount);
  });

  it.each([0, -1, 1.5, 3, '1', Number.NaN, Number.POSITIVE_INFINITY, null, {}, { maxTacticalDepth: 1 }])(
    '不正な静止探索設定 %p は探索前に拒否する',
    (value) => {
      const search = vi.fn(analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch);
      const input = request({ quiescenceMaxTacticalDepth: value } as unknown as Partial<TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest>);

      const response = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(input, search);

      expect(response).toMatchObject({
        type: 'time-limited-iterative-deepening-alpha-beta-search-failed',
        errorName: 'RangeError',
        errorMessage: expect.stringMatching(/quiescence/i),
      });
      expect(search).not.toHaveBeenCalled();
    }
  );

  it('既存の同期探索を呼び、同じrequestIdと探索結果を構造化クローン可能な成功応答にする', () => {
    const input = request({ maxDepth: 2 });
    const snapshot = JSON.stringify(input.state);
    const direct = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(
      input.state,
      input.maxDepth,
      input.timeLimitMilliseconds
    );
    const search = vi.fn(analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch);
    const response = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(input, search);

    expect(search).toHaveBeenCalledWith(input.state, 2, 1_000, resolveSearchEvaluationPreset());
    expect(response.type).toBe('time-limited-iterative-deepening-alpha-beta-search-succeeded');
    if (response.type !== 'time-limited-iterative-deepening-alpha-beta-search-succeeded') {
      throw new Error('Expected a successful worker response.');
    }
    expect(response.requestId).toBe(input.requestId);
    expect(response.result.quiescenceMaxTacticalDepth).toBeNull();
    expect(comparableResult(response.result)).toEqual(comparableResult(direct));
    expect(response.result.principalVariation).toEqual(direct.principalVariation);
    expect(JSON.stringify(input.state)).toBe(snapshot);
  });

  it('探索入力エラーと未知throw値を安全な失敗応答へ変換する', () => {
    const invalid = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(request({ maxDepth: 0 }));
    const unknownThrowingSearch: TimeLimitedIterativeDeepeningAlphaBetaSearch = () => {
      throw 'unexpected worker failure';
    };
    const unknown = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(
      request(),
      unknownThrowingSearch
    );

    expect(invalid).toMatchObject({
      type: 'time-limited-iterative-deepening-alpha-beta-search-failed',
      requestId: 'request-1',
      errorName: 'Error',
    });
    expect(unknown).toEqual({
      type: 'time-limited-iterative-deepening-alpha-beta-search-failed',
      requestId: 'request-1',
      errorName: 'UnknownWorkerSearchError',
      errorMessage: 'unexpected worker failure',
    });
  });

  it('Infinityと-InfinityをJSONへ変換せず成功応答で保持する', () => {
    const baseline = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(createInitialBoardState(), 1, 1_000);
    const infinitySearch: TimeLimitedIterativeDeepeningAlphaBetaSearch = () => ({
      ...baseline,
      selectedEvaluation: Number.POSITIVE_INFINITY,
    });
    const negativeInfinitySearch: TimeLimitedIterativeDeepeningAlphaBetaSearch = () => ({
      ...baseline,
      selectedEvaluation: Number.NEGATIVE_INFINITY,
    });

    const positive = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(request(), infinitySearch);
    const negative = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(request(), negativeInfinitySearch);

    expect(positive.type === 'time-limited-iterative-deepening-alpha-beta-search-succeeded' &&
      positive.result.selectedEvaluation).toBe(Number.POSITIVE_INFINITY);
    expect(negative.type === 'time-limited-iterative-deepening-alpha-beta-search-succeeded' &&
      negative.result.selectedEvaluation).toBe(Number.NEGATIVE_INFINITY);
  });

  it('終局の全評価内訳とterminalをWorker応答でも構造化クローンのまま保持する', () => {
    const base = createInitialBoardState();
    const cases = [
      {
        state: {
          ...base,
          status: 'ended' as const,
          result: { winner: 'sente' as const, loser: 'gote' as const, endReason: 'checkmate' as const },
        },
        total: Number.POSITIVE_INFINITY,
        terminal: 'win' as const,
      },
      {
        state: {
          ...base,
          status: 'ended' as const,
          result: { winner: 'gote' as const, loser: 'sente' as const, endReason: 'resignation' as const },
        },
        total: Number.NEGATIVE_INFINITY,
        terminal: 'loss' as const,
      },
      {
        state: {
          ...base,
          status: 'ended' as const,
          result: { winner: null, loser: null, endReason: 'repetition' as const },
        },
        total: 0,
        terminal: 'draw' as const,
      },
    ];

    for (const testCase of cases) {
      const response = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(
        request({ state: testCase.state })
      );

      expect(response.type).toBe('time-limited-iterative-deepening-alpha-beta-search-succeeded');
      if (response.type !== 'time-limited-iterative-deepening-alpha-beta-search-succeeded') continue;
      expect(response.result.evaluationBreakdown).toEqual({
        total: testCase.total,
        material: 0,
        pieceSquare: 0,
        kingSafety: 0,
        undefendedPieceSafety: 0,
        terminal: testCase.terminal,
      });
      expect(response.result.iterations[0].evaluationBreakdown).toEqual(response.result.evaluationBreakdown);
      expect(structuredClone(response)).toEqual(response);
    }
  });
});

describe('時間制限付き反復深化αβ探索Workerクライアント', () => {
  it.each(SEARCH_EVALUATION_PRESET_IDS)('選択IDを要求へ渡し、そのIDを持つ応答だけを採用する: %s', async (id) => {
    const fake = createFakeWorker();
    const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({ workerFactory: () => fake.worker, requestIdFactory: () => 'preset-request' });
    const input = createInitialBoardState();
    const pending = client.run(input, 1, 1000, undefined, id);
    expect(fake.postMessage).toHaveBeenCalledWith(request({ state: input, requestId: 'preset-request', evaluationPresetId: id }));
    const response = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(request({ state: input, requestId: 'preset-request', evaluationPresetId: id }));
    fake.emitMessage(structuredClone(response));
    await expect(pending).resolves.toMatchObject({ evaluationPresetId: id });
  });

  it.each([1, 2] as const)('静止探索の追加%s手を要求へ渡し、同じ応答だけを採用する', async (depth) => {
    const fake = createFakeWorker();
    const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({ workerFactory: () => fake.worker, requestIdFactory: () => 'quiescence-request' });
    const input = createInitialBoardState();
    const pending = client.run(input, 1, 1000, undefined, undefined, depth);
    const workerRequest = request({
      state: input,
      requestId: 'quiescence-request',
      evaluationPresetId: DEFAULT_SEARCH_EVALUATION_PRESET_ID,
      quiescenceMaxTacticalDepth: depth,
    });
    expect(fake.postMessage).toHaveBeenCalledWith(workerRequest);
    fake.emitMessage(handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(workerRequest));
    await expect(pending).resolves.toMatchObject({ quiescenceMaxTacticalDepth: depth });
  });

  it('応答の静止探索設定不一致をWorkerProtocolErrorとして拒否する', async () => {
    const fake = createFakeWorker();
    const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({ workerFactory: () => fake.worker, requestIdFactory: () => 'request-1' });
    const pending = client.run(createInitialBoardState(), 1, 1000, undefined, undefined, 1);
    fake.emitMessage(successResponse());

    await expect(pending).rejects.toMatchObject({ name: 'WorkerProtocolError' });
  });

  it('応答の設定不一致を拒否し、公開クライアントの不正IDも安全に失敗する', async () => {
    const fake = createFakeWorker();
    const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({ workerFactory: () => fake.worker, requestIdFactory: () => 'request-1' });
    const pending = client.run(createInitialBoardState(), 1, 1000, undefined, 'material-focused');
    fake.emitMessage(successResponse());
    await expect(pending).rejects.toMatchObject({ name: 'WorkerProtocolError' });
    await expect(client.run(createInitialBoardState(), 1, 1000, undefined, 'invalid' as SearchEvaluationPresetId)).rejects.toThrow(/preset/);
    expect(fake.postMessage).toHaveBeenCalledTimes(1);
  });
  const successResponse = (requestId = 'request-1'): TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse => ({
    type: 'time-limited-iterative-deepening-alpha-beta-search-succeeded',
    requestId,
    result: {
      ...analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(createInitialBoardState(), 1, 1_000),
      evaluationPresetId: DEFAULT_SEARCH_EVALUATION_PRESET_ID,
      quiescenceMaxTacticalDepth: null,
    },
  });

  it('成功応答でresolveし、Workerを一度だけ終了する', async () => {
    const fake = createFakeWorker();
    const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({
      workerFactory: () => fake.worker,
      requestIdFactory: () => 'request-1',
    });
    const pending = client.run(createInitialBoardState(), 1, 1_000);

    fake.emitMessage(successResponse());

    await expect(pending).resolves.toMatchObject({ requestedMaxDepth: 1, completedDepth: 1 });
    expect(fake.terminate).toHaveBeenCalledTimes(1);
  });

  it('省略可能なsignalなしの既存3引数呼び出しを従来どおり成功させる', async () => {
    const fake = createFakeWorker();
    const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({
      workerFactory: () => fake.worker, requestIdFactory: () => 'request-1',
    });

    const pending = client.run(createInitialBoardState(), 1, 1_000);
    fake.emitMessage(successResponse());

    await expect(pending).resolves.toMatchObject({ completedDepth: 1 });
    expect(fake.postMessage).toHaveBeenCalledTimes(1);
    expect(fake.terminate).toHaveBeenCalledTimes(1);
  });

  it('実行前からabort済みならWorkerもpostMessageも使わず中止専用エラーでrejectする', async () => {
    const fake = createFakeWorker();
    const workerFactory = vi.fn(() => fake.worker);
    const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({ workerFactory });
    const controller = new AbortController();
    controller.abort({ stalePosition: true });

    await expectWorkerAbort(client.run(createInitialBoardState(), 1, 1_000, controller.signal));
    expect(workerFactory).not.toHaveBeenCalled();
    expect(fake.postMessage).not.toHaveBeenCalled();
    expect(fake.terminate).not.toHaveBeenCalled();
  });

  it('Worker生成中にabortされてもpostMessage前にWorkerを一度だけ終了する', async () => {
    const fake = createFakeWorker();
    const controller = new AbortController();
    const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({
      workerFactory: () => {
        controller.abort('new game');
        return fake.worker;
      },
    });

    await expectWorkerAbort(client.run(createInitialBoardState(), 1, 1_000, controller.signal));
    expect(fake.postMessage).not.toHaveBeenCalled();
    expect(fake.terminate).toHaveBeenCalledTimes(1);
  });

  it('探索中のabortはWorkerを一度だけ終了し、遅延した成功・失敗・errorを中止結果へ上書きさせない', async () => {
    const fake = createFakeWorker();
    const controller = new AbortController();
    const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({
      workerFactory: () => fake.worker, requestIdFactory: () => 'request-1',
    });
    const pending = client.run(createInitialBoardState(), 1, 1_000, controller.signal);

    controller.abort({ replacement: 'loaded-record' });
    fake.emitMessage(successResponse());
    fake.emitMessage({
      type: 'time-limited-iterative-deepening-alpha-beta-search-failed',
      requestId: 'request-1', errorName: 'LateError', errorMessage: 'late failure',
    });
    fake.emitError('late error');

    await expectWorkerAbort(pending);
    expect(fake.terminate).toHaveBeenCalledTimes(1);
  });

  it('成功または失敗が先なら後続abortは結果と終了回数を変えず、abortリスナーを解除する', async () => {
    const successFake = createFakeWorker();
    const successController = new AbortController();
    const successRemove = vi.spyOn(successController.signal, 'removeEventListener');
    const successClient = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({
      workerFactory: () => successFake.worker, requestIdFactory: () => 'request-1',
    });
    const successful = successClient.run(createInitialBoardState(), 1, 1_000, successController.signal);
    successFake.emitMessage(successResponse());
    successController.abort();

    await expect(successful).resolves.toMatchObject({ completedDepth: 1 });
    expect(successFake.terminate).toHaveBeenCalledTimes(1);
    expect(successRemove).toHaveBeenCalledWith('abort', expect.any(Function));

    const failureFake = createFakeWorker();
    const failureController = new AbortController();
    const failureRemove = vi.spyOn(failureController.signal, 'removeEventListener');
    const failureClient = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({
      workerFactory: () => failureFake.worker, requestIdFactory: () => 'request-1',
    });
    const failed = failureClient.run(createInitialBoardState(), 1, 1_000, failureController.signal);
    failureFake.emitError('worker crashed');
    failureController.abort();

    await expect(failed).rejects.toThrow('worker crashed');
    expect(failureFake.terminate).toHaveBeenCalledTimes(1);
    expect(failureRemove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('abort確定経路でもabortリスナーを解除する', async () => {
    const fake = createFakeWorker();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({
      workerFactory: () => fake.worker, requestIdFactory: () => 'request-1',
    });
    const pending = client.run(createInitialBoardState(), 1, 1_000, controller.signal);

    controller.abort();

    await expectWorkerAbort(pending);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('構造化された失敗応答、error、messageerror、postMessage失敗でrejectして終了する', async () => {
    const cases = [
      {
        trigger: (fake: ReturnType<typeof createFakeWorker>) => fake.emitMessage({
          type: 'time-limited-iterative-deepening-alpha-beta-search-failed',
          requestId: 'request-1', errorName: 'SearchError', errorMessage: 'invalid search',
        }),
        message: 'invalid search',
      },
      { trigger: (fake: ReturnType<typeof createFakeWorker>) => fake.emitError('worker crashed'), message: 'worker crashed' },
      { trigger: (fake: ReturnType<typeof createFakeWorker>) => fake.emitMessageError(), message: 'could not deserialize' },
    ];

    for (const testCase of cases) {
      const fake = createFakeWorker();
      const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({
        workerFactory: () => fake.worker, requestIdFactory: () => 'request-1',
      });
      const pending = client.run(createInitialBoardState(), 1, 1_000);
      testCase.trigger(fake);
      await expect(pending).rejects.toThrow(testCase.message);
      expect(fake.terminate).toHaveBeenCalledTimes(1);
    }

    const postFailure = createFakeWorker({ postMessageError: new Error('post failed') });
    const postFailureController = new AbortController();
    const postFailureRemove = vi.spyOn(postFailureController.signal, 'removeEventListener');
    const postFailureClient = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({
      workerFactory: () => postFailure.worker, requestIdFactory: () => 'request-1',
    });
    await expect(postFailureClient.run(
      createInitialBoardState(), 1, 1_000, postFailureController.signal
    )).rejects.toThrow('post failed');
    expect(postFailure.terminate).toHaveBeenCalledTimes(1);
    expect(postFailureRemove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('requestId不一致とWorker生成失敗を呼び出し側が判別できるエラーにする', async () => {
    const fake = createFakeWorker();
    const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({
      workerFactory: () => fake.worker, requestIdFactory: () => 'request-1',
    });
    const pending = client.run(createInitialBoardState(), 1, 1_000);
    fake.emitMessage(successResponse('wrong-request'));

    await expect(pending).rejects.toThrow('requestId did not match');
    expect(fake.terminate).toHaveBeenCalledTimes(1);

    const unavailable = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({
      workerFactory: () => { throw new Error('Worker unavailable'); },
    });
    await expect(unavailable.run(createInitialBoardState(), 1, 1_000)).rejects.toThrow('Worker unavailable');
  });

  it('確定後の重複イベントは結果も終了処理も変えない', async () => {
    const fake = createFakeWorker();
    const client = createTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerClient({
      workerFactory: () => fake.worker, requestIdFactory: () => 'request-1',
    });
    const pending = client.run(createInitialBoardState(), 1, 1_000);

    fake.emitMessage(successResponse());
    fake.emitError('late error');
    fake.emitMessage({
      type: 'time-limited-iterative-deepening-alpha-beta-search-failed',
      requestId: 'request-1', errorName: 'LateError', errorMessage: 'late failure',
    });

    await expect(pending).resolves.toMatchObject({ completedDepth: 1 });
    expect(fake.terminate).toHaveBeenCalledTimes(1);
  });

  it('公開ヘルパーの省略可能なsignalをWorkerクライアントへ渡す', async () => {
    const fake = createFakeWorker();
    const controller = new AbortController();
    const WorkerMock = vi.fn(function WorkerMock() {
      return fake.worker;
    });
    vi.stubGlobal('Worker', WorkerMock);

    try {
      const pending = runTimeLimitedIterativeDeepeningAlphaBetaSearchInWorker(
        createInitialBoardState(), 1, 1_000, controller.signal
      );
      controller.abort('disposed view');

      await expectWorkerAbort(pending);
      expect(WorkerMock).toHaveBeenCalledTimes(1);
      expect(fake.postMessage).toHaveBeenCalledTimes(1);
      expect(fake.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
