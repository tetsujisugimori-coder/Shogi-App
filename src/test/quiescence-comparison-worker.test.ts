import { comparisonCaptureTrap, comparisonExtendedPv } from './fixtures/quiescenceComparisonPositions';
import * as alphaBeta from '../domain/shogi/twoPlyAlphaBetaAi';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createInitialBoardState, type BoardState } from '../types/shogi';
import { analyzeQuiescenceComparison, type QuiescenceComparisonResult } from '../domain/shogi/quiescenceComparison';
import { createQuiescenceComparisonWorkerClient } from '../application/quiescenceComparisonWorkerClient';
import { handleQuiescenceComparisonWorkerRequest } from '../workers/quiescenceComparisonWorkerHandler';
import type { QuiescenceComparisonWorkerRequest } from '../workers/quiescenceComparisonWorkerProtocol';

const state = comparisonCaptureTrap(true);
let results: readonly QuiescenceComparisonResult[];
beforeAll(() => { results = analyzeQuiescenceComparison(state, 3, () => 0); });

class FakeWorker {
  private events = new EventTarget();
  addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(type: string, listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)) {
    this.events.addEventListener(type, listener as EventListener);
  }
  dispatchEvent(event: Event) { return this.events.dispatchEvent(event); }
  terminate = vi.fn();
  postMessage = vi.fn<(request: QuiescenceComparisonWorkerRequest) => void>();
  message(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }
}
function setup(position = state) {
  const worker = new FakeWorker();
  const factory = vi.fn(() => worker);
  const client = createQuiescenceComparisonWorkerClient({ workerFactory: factory, requestIdFactory: () => 'comparison-1' });
  const response = () => ({ type: 'quiescence-comparison-succeeded', requestId: 'comparison-1',
    state: position, depth: 3, results: structuredClone(results) });
  return { worker, factory, client, response };
}

describe('比較Workerのアトミックな通信と終了', () => {
  it('固定深さを超える合法PVを構造化クローン後も受理する', async () => {
    const position = comparisonExtendedPv();
    const { worker, client } = setup(position);
    const pending = client.run(position, 3);
    worker.message(handleQuiescenceComparisonWorkerRequest(worker.postMessage.mock.calls[0][0]));
    const found = await pending;
    expect(found[1].principalVariation).toHaveLength(4);
    expect(found.map((r) => r.depth)).toEqual([3, 3, 3]);
  });

  it('第2探索の例外はhandler全体の失敗となり部分結果を送信しない', () => {
    const first = alphaBeta.analyzeAlphaBetaSearch(state, 3, undefined, () => 0);
    const spy = vi.spyOn(alphaBeta, 'analyzeAlphaBetaSearch').mockReturnValueOnce(first)
      .mockImplementationOnce(() => { throw new RangeError('second pass failed'); });
    try {
      const response = handleQuiescenceComparisonWorkerRequest({ type: 'compare-quiescence-settings', requestId: 'x', state, depth: 3 });
      expect(response).toEqual({ type: 'quiescence-comparison-failed', requestId: 'x', errorName: 'RangeError', errorMessage: 'second pass failed' });
      expect(spy).toHaveBeenCalledTimes(2);
    } finally { spy.mockRestore(); }
  });

  it('1要求で3探索を直列実行し、全フィールドを構造化クローンで保持する', async () => {
    const { worker, client } = setup();
    const pending = client.run(state, 3);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const request = structuredClone(worker.postMessage.mock.calls[0][0]);
    const response = handleQuiescenceComparisonWorkerRequest(request, (s, depth) => analyzeQuiescenceComparison(s, depth, () => 0));
    worker.message(response);
    expect(await pending).toEqual(results);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    worker.message(response);
    worker.dispatchEvent(new Event('messageerror'));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(['sente', 'gote', null] as const)('終局内訳の無限値と0を転送する: %s', async (winner) => {
    const ended: BoardState = { ...state, status: 'ended', result: winner === null
      ? { winner: null, loser: null, endReason: 'repetition' }
      : { winner, loser: winner === 'sente' ? 'gote' : 'sente', endReason: 'resignation' } };
    const { worker, client } = setup(ended);
    const pending = client.run(ended, 3);
    worker.message(handleQuiescenceComparisonWorkerRequest(worker.postMessage.mock.calls[0][0]));
    expect((await pending).map((result) => result.evaluationBreakdown.total))
      .toEqual(Array(3).fill(winner === 'sente' ? Infinity : winner === 'gote' ? -Infinity : 0));
  });

  it.each([
    ['requestId', (r: ReturnType<ReturnType<typeof setup>['response']>) => { r.requestId = 'stale'; }],
    ['順序', (r) => { r.results = [r.results[0], r.results[2], r.results[1]]; }],
    ['不足', (r) => { r.results = r.results.slice(0, 2); }],
    ['重複', (r) => { Object.assign(r.results[1], { quiescenceMaxTacticalDepth: r.results[0].quiescenceMaxTacticalDepth }); }],
    ['未知ID', (r) => { Object.assign(r.results[0], { quiescenceMaxTacticalDepth: 'unknown' }); }],
    ['IDなし', (r) => { Object.assign(r.results[0], { quiescenceMaxTacticalDepth: undefined }); }],
    ['深さ', (r) => { r.depth = 2; }],
    ['結果深さ', (r) => { r.results[0].depth = 2; }],
    ['別局面', (r) => { r.state = { ...state, turn: 'gote' }; }],
    ['PV先頭', (r) => { r.results[0].selectedAction = r.results[0].principalVariation[1]; }],
    ['不正PV', (r) => { r.results[0].principalVariation[1] = r.results[0].principalVariation[0]; }],
    ['長いPV', (r) => { r.results[0].principalVariation.push(r.results[0].principalVariation[0]); }],
    ['打ち切られたPV', (r) => { r.results[0].principalVariation = r.results[0].principalVariation.slice(0, 1); }],
    ['非終局PVの終局内訳', (r) => {
      r.results[0].selectedEvaluation = Infinity;
      r.results[0].evaluationBreakdown = { material: 0, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0, total: Infinity, terminal: 'win' };
    }],
    ['内訳合計', (r) => { Object.assign(r.results[0].evaluationBreakdown, { total: r.results[0].evaluationBreakdown.total + 1 }); }],
    ['内訳なし', (r) => { Object.assign(r.results[0], { evaluationBreakdown: null }); }],
    ['NaN', (r) => { r.results[0].selectedEvaluation = NaN; }],
    ['静止探索負数', (r) => { r.results[1].quiescenceLeafCount = -1; }],
    ['静止探索NaN', (r) => { r.results[1].quiescenceVisitedPositionCount = NaN; }],
    ['静止探索小数', (r) => { r.results[1].quiescenceCutoffCount = 0.5; }],
    ['静止探索型', (r) => { Object.assign(r.results[1], { quiescenceSkippedActionCount: '1' }); }],
    ['無効条件の静止探索', (r) => { r.results[0].quiescenceLeafCount = 1; }],
    ['過剰な葉', (r) => { r.results[1].quiescenceLeafCount = r.results[1].visitedPositionCount + 1; }],
    ['処理時間', (r) => { r.results[1].elapsedMilliseconds = -1; }],
    ['別プロトコル', (r) => { r.type = 'evaluation-preset-comparison-succeeded'; }],
    ['統計', (r) => { r.results[0].cutoffCount = -1; }],
    ['型', (r) => { Object.assign(r.results[0], { visitedPositionCount: '1' }); }],
  ] satisfies [string, (response: ReturnType<ReturnType<typeof setup>['response']>) => void][])('不正応答を全体として拒否する: %s', async (_, corrupt) => {
    const { worker, client, response } = setup();
    const pending = client.run(state, 3);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'WorkerProtocolError' });
    const data = response();
    corrupt(data);
    worker.message(data);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(['error', 'messageerror', 'abort', 'clone', 'worker-failure'] as const)('%sでも一度だけ失敗・終了し遅延結果を無視する', async (path) => {
    const { worker, client, response } = setup();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    if (path === 'clone') worker.postMessage.mockImplementation(() => { throw new DOMException('clone failed', 'DataCloneError'); });
    const pending = client.run(state, 3, controller.signal);
    const rejected = expect(pending).rejects.toBeInstanceOf(Error);
    if (path === 'abort') controller.abort();
    if (path === 'error') worker.dispatchEvent(new ErrorEvent('error', { message: 'worker crashed' }));
    if (path === 'messageerror') worker.dispatchEvent(new Event('messageerror'));
    if (path === 'worker-failure') worker.message({ type: 'quiescence-comparison-failed', requestId: 'comparison-1', errorName: 'Error', errorMessage: 'failed' });
    await rejected;
    worker.message(response());
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('中止済みsignalではWorkerを生成せず、生成失敗も同期探索へ戻らない', async () => {
    const { client, factory } = setup();
    const controller = new AbortController(); controller.abort();
    await expect(client.run(state, 3, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(factory).not.toHaveBeenCalled();
    factory.mockImplementation(() => { throw new Error('unavailable'); });
    await expect(client.run(state, 3)).rejects.toThrow('unavailable');
  });

  it('Worker内の例外を失敗応答にし部分結果を返さない', () => {
    const request: QuiescenceComparisonWorkerRequest = { type: 'compare-quiescence-settings', requestId: 'x', state, depth: 3 };
    const response = handleQuiescenceComparisonWorkerRequest(request, () => { throw new Error('third search failed'); });
    expect(response).toEqual({ type: 'quiescence-comparison-failed', requestId: 'x', errorName: 'Error', errorMessage: 'third search failed' });
    expect(response).not.toHaveProperty('results');
  });
});
