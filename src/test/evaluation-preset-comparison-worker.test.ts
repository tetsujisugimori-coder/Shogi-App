import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createInitialBoardState, type BoardState } from '../types/shogi';
import { analyzeEvaluationPresetComparison, type EvaluationPresetComparisonResult } from '../domain/shogi/evaluationPresetComparison';
import { createEvaluationPresetComparisonWorkerClient } from '../application/evaluationPresetComparisonWorkerClient';
import { handleEvaluationPresetComparisonWorkerRequest } from '../workers/evaluationPresetComparisonWorkerHandler';
import type { EvaluationPresetComparisonWorkerRequest } from '../workers/evaluationPresetComparisonWorkerProtocol';

const state = createInitialBoardState();
let results: readonly EvaluationPresetComparisonResult[];
beforeAll(() => { results = analyzeEvaluationPresetComparison(state, 3, () => 0); });

class FakeWorker {
  private events = new EventTarget();
  addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(type: string, listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)) {
    this.events.addEventListener(type, listener as EventListener);
  }
  dispatchEvent(event: Event) { return this.events.dispatchEvent(event); }
  terminate = vi.fn();
  postMessage = vi.fn<(request: EvaluationPresetComparisonWorkerRequest) => void>();
  message(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }
}
function setup(position = state) {
  const worker = new FakeWorker();
  const factory = vi.fn(() => worker);
  const client = createEvaluationPresetComparisonWorkerClient({ workerFactory: factory, requestIdFactory: () => 'comparison-1' });
  const response = () => ({ type: 'evaluation-preset-comparison-succeeded', requestId: 'comparison-1',
    state: position, depth: 3, results: structuredClone(results) });
  return { worker, factory, client, response };
}

describe('比較Workerのアトミックな通信と終了', () => {
  it('1要求で3探索を直列実行し、全フィールドを構造化クローンで保持する', async () => {
    const { worker, client } = setup();
    const pending = client.run(state, 3);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const request = structuredClone(worker.postMessage.mock.calls[0][0]);
    const response = handleEvaluationPresetComparisonWorkerRequest(request, (s, depth) => analyzeEvaluationPresetComparison(s, depth, () => 0));
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
    worker.message(handleEvaluationPresetComparisonWorkerRequest(worker.postMessage.mock.calls[0][0]));
    expect((await pending).map((result) => result.evaluationBreakdown.total))
      .toEqual(Array(3).fill(winner === 'sente' ? Infinity : winner === 'gote' ? -Infinity : 0));
  });

  it.each([
    ['requestId', (r: ReturnType<ReturnType<typeof setup>['response']>) => { r.requestId = 'stale'; }],
    ['不足', (r) => { r.results = r.results.slice(0, 2); }],
    ['重複', (r) => { Object.assign(r.results[1], { presetId: r.results[0].presetId }); }],
    ['未知ID', (r) => { Object.assign(r.results[0], { presetId: 'unknown' }); }],
    ['IDなし', (r) => { Object.assign(r.results[0], { presetId: undefined }); }],
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
    ['統計', (r) => { r.results[0].cutoffCount = -1; }],
    ['型', (r) => { Object.assign(r.results[0], { visitedPositionCount: '1' }); }],
  ] satisfies [string, (response: ReturnType<ReturnType<typeof setup>['response']>) => void][])('不正応答を全体として拒否する: %s', async (_, corrupt) => {
    const { worker, client, response } = setup();
    const pending = client.run(state, 3);
    const rejected = expect(pending).rejects.toBeInstanceOf(Error);
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
    if (path === 'worker-failure') worker.message({ type: 'evaluation-preset-comparison-failed', requestId: 'comparison-1', errorName: 'Error', errorMessage: 'failed' });
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
    const request: EvaluationPresetComparisonWorkerRequest = { type: 'compare-evaluation-presets', requestId: 'x', state, depth: 3 };
    const response = handleEvaluationPresetComparisonWorkerRequest(request, () => { throw new Error('third search failed'); });
    expect(response).toEqual({ type: 'evaluation-preset-comparison-failed', requestId: 'x', errorName: 'Error', errorMessage: 'third search failed' });
    expect(response).not.toHaveProperty('results');
  });
});
