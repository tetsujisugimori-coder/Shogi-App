import type { Player } from '../../types/shogi';
import type { QuiescenceComparisonResult, QuiescenceComparisonSetting } from '../../domain/shogi/quiescenceComparison';
import { formatSenteEvaluation } from './searchEvaluationDisplay';

export function quiescenceComparisonName(setting: QuiescenceComparisonSetting): string {
  return setting === null ? '静止探索なし' : `追加${setting}手`;
}

export interface QuiescenceComparisonDisplay {
  perspective: Player;
  entries: readonly {
    result: QuiescenceComparisonResult;
    principalVariationNotations: readonly string[];
  }[];
}

export function QuiescenceComparisonPanel({ display, state }: {
  display: QuiescenceComparisonDisplay | null;
  state: { kind: 'idle' | 'thinking' | 'cancelled' } | { kind: 'error'; message: string };
}) {
  return (
    <section aria-labelledby="quiescence-comparison-title" className="mx-auto mt-4 w-full min-w-0 max-w-6xl rounded border border-sky-800/70 bg-sky-950/30 p-3 text-xs text-sky-100 [overflow-wrap:anywhere]">
      <h2 id="quiescence-comparison-title" className="font-serif text-sm">静止探索設定の比較</h2>
      <p className="mt-2 text-stone-300">同一局面を同じ既定評価設定・固定深さ3で解析し、盤面には着手しません。</p>
      <p className="mt-1 text-stone-400">主変化は静止探索の読み足しにより3手を超える場合があります。通常探索と静止探索の統計は別々に表示します。</p>
      <p className="mt-1 text-stone-400">処理時間は実行環境に左右される参考値です。棋力や設定の優劣を直接表すものではなく、最適設定を自動選択しません。</p>
      {state.kind === 'thinking' && <p role="status" className="mt-2">静止探索の3条件を解析中</p>}
      {state.kind === 'cancelled' && <p role="status" className="mt-2">静止探索比較を中止しました。</p>}
      {state.kind === 'error' && <p role="alert" className="mt-2">静止探索比較に失敗しました: {state.message}</p>}
      {display && state.kind === 'idle' && <>
        <p className="mt-2 text-stone-300">先手基準：＋は先手有利、−は後手有利、0は互角です。</p>
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
          {display.entries.map(({ result, principalVariationNotations }) => {
            const name = quiescenceComparisonName(result.quiescenceMaxTacticalDepth);
            return <article key={name} aria-label={name} className="min-w-0 space-y-3 rounded border border-sky-900 p-3">
              <h3 className="text-sm font-semibold">{name}</h3>
              <dl className="grid grid-cols-2 gap-2">
                <dt>推奨手</dt><dd>{principalVariationNotations[0] ?? '指せる手はありません'}</dd>
                <dt>評価値</dt><dd>先手 {formatSenteEvaluation(result.selectedEvaluation ?? result.evaluationBreakdown.total, display.perspective)}</dd>
                <dt>固定深さ</dt><dd>{result.depth} ply</dd>
              </dl>
              <div><h4>主変化</h4>{principalVariationNotations.length > 0
                ? <ol className="mt-1 list-decimal space-y-1 pl-5">{principalVariationNotations.map((notation, index) => <li key={index}>{notation}</li>)}</ol>
                : <p>手順なし</p>}</div>
              <dl className="grid grid-cols-2 gap-2 border-t border-sky-900 pt-2">
                <dt>通常探索の訪問局面数</dt><dd>{result.visitedPositionCount}</dd>
                <dt>通常探索のカットオフ回数</dt><dd>{result.cutoffCount}</dd>
                <dt>通常探索のスキップ手数</dt><dd>{result.skippedActionCount}</dd>
                <dt>静止探索を開始した葉の数</dt><dd>{result.quiescenceLeafCount}</dd>
                <dt>静止探索の訪問局面数</dt><dd>{result.quiescenceVisitedPositionCount}</dd>
                <dt>静止探索のカットオフ回数</dt><dd>{result.quiescenceCutoffCount}</dd>
                <dt>静止探索のスキップ手数</dt><dd>{result.quiescenceSkippedActionCount}</dd>
                <dt>参考処理時間</dt><dd>{result.elapsedMilliseconds.toFixed(1)} ms</dd>
              </dl>
            </article>;
          })}
        </div>
      </>}
    </section>
  );
}
