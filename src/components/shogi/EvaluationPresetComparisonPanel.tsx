import type { Player } from '../../types/shogi';
import type { EvaluationPresetComparisonResult } from '../../domain/shogi/evaluationPresetComparison';
import { SEARCH_EVALUATION_PRESET_DISPLAY } from './searchEvaluationPresetDisplay';
import { formatSenteEvaluation } from './searchEvaluationDisplay';
import { EvaluationBreakdownDisplay } from './EvaluationBreakdownDisplay';

export interface EvaluationPresetComparisonDisplay {
  perspective: Player;
  entries: readonly {
    result: EvaluationPresetComparisonResult;
    principalVariationNotations: readonly string[];
  }[];
}

export function EvaluationPresetComparisonPanel({ display, state }: {
  display: EvaluationPresetComparisonDisplay | null;
  state: { kind: 'idle' | 'thinking' | 'cancelled' } | { kind: 'error'; message: string };
}) {
  return (
    <section aria-labelledby="preset-comparison-title" className="mx-auto mt-4 w-full min-w-0 max-w-6xl rounded border border-sky-800/70 bg-sky-950/30 p-3 text-xs text-sky-100 [overflow-wrap:anywhere]">
      <h2 id="preset-comparison-title" className="font-serif text-sm">評価プリセットの比較</h2>
      <p className="mt-2 text-stone-300">同一局面を固定深さ3で解析します。盤面には着手しません。</p>
      <p className="mt-1 text-stone-400">評価尺度が異なるため、数値が高いほど強いというランキングではありません。評価値の大小だけで優劣は決められず、同じ推奨手になる場合もあります。</p>
      {state.kind === 'thinking' && <p role="status" className="mt-2">3プリセットを解析中</p>}
      {state.kind === 'cancelled' && <p role="status" className="mt-2">比較を中止しました。</p>}
      {state.kind === 'error' && <p role="alert" className="mt-2">比較に失敗しました: {state.message}</p>}
      {display && state.kind === 'idle' && <>
        <p className="mt-2 text-stone-300">先手基準：＋は先手有利、−は後手有利、0は互角です。内訳は探索末端の係数適用後の寄与値です。</p>
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
          {display.entries.map(({ result, principalVariationNotations }) => {
            const preset = SEARCH_EVALUATION_PRESET_DISPLAY[result.presetId];
            return <article key={result.presetId} aria-label={preset.name} className="min-w-0 space-y-3 rounded border border-sky-900 p-3">
              <h3 className="text-sm font-semibold">{preset.name}</h3>
              <p>{preset.description}</p>
              <p className="text-stone-400">プリセットID: {result.presetId}</p>
              <dl className="grid grid-cols-2 gap-2">
                <dt>推奨手</dt><dd>{principalVariationNotations[0] ?? '指せる手はありません'}</dd>
                <dt>評価値</dt><dd>先手 {formatSenteEvaluation(result.selectedEvaluation ?? result.evaluationBreakdown.total, display.perspective)}</dd>
                <dt>固定深さ</dt><dd>{result.depth} ply</dd>
              </dl>
              <div><h4>主変化</h4>{principalVariationNotations.length > 0
                ? <ol className="mt-1 list-decimal space-y-1 pl-5">{principalVariationNotations.map((notation, index) => <li key={index}>{notation}</li>)}</ol>
                : <p>手順なし</p>}</div>
              <EvaluationBreakdownDisplay breakdown={result.evaluationBreakdown} perspective={display.perspective} />
              <dl className="grid grid-cols-2 gap-2 border-t border-sky-900 pt-2">
                <dt>訪問局面数</dt><dd>{result.visitedPositionCount}</dd>
                <dt>カットオフ回数</dt><dd>{result.cutoffCount}</dd>
                <dt>スキップ手数</dt><dd>{result.skippedActionCount}</dd>
              </dl>
            </article>;
          })}
        </div>
      </>}
    </section>
  );
}
