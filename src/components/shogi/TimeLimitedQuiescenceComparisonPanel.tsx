import { Fragment } from 'react';
import type { Player } from '../../types/shogi';
import type { TimeLimitedQuiescenceComparisonResult } from '../../domain/shogi/timeLimitedQuiescenceComparison';
import { quiescenceComparisonName } from './QuiescenceComparisonPanel';
import { formatSenteEvaluation } from './searchEvaluationDisplay';

export interface TimeLimitedQuiescenceComparisonDisplay {
  perspective: Player;
  entries: readonly {
    result: TimeLimitedQuiescenceComparisonResult;
    principalVariationNotations: readonly string[];
  }[];
}

const normalStatistics = [
  ['訪問局面数', 'visitedPositionCount', 'totalVisitedPositionCount'],
  ['カットオフ回数', 'cutoffCount', 'totalCutoffCount'],
  ['スキップ手数', 'skippedActionCount', 'totalSkippedActionCount'],
] as const;
const tacticalStatistics = [
  ['開始した葉の数', 'quiescenceLeafCount', 'totalQuiescenceLeafCount'],
  ['訪問局面数', 'quiescenceVisitedPositionCount', 'totalQuiescenceVisitedPositionCount'],
  ['カットオフ回数', 'quiescenceCutoffCount', 'totalQuiescenceCutoffCount'],
  ['スキップ手数', 'quiescenceSkippedActionCount', 'totalQuiescenceSkippedActionCount'],
] as const;

export function TimeLimitedQuiescenceComparisonPanel({ display, state }: {
  display: TimeLimitedQuiescenceComparisonDisplay | null;
  state: { kind: 'idle' | 'thinking' | 'cancelled' } | { kind: 'error'; message: string };
}) {
  return <section aria-labelledby="time-limited-quiescence-title" className="mx-auto mt-4 w-full min-w-0 max-w-6xl rounded border border-sky-800/70 bg-sky-950/30 p-3 text-xs text-sky-100 [overflow-wrap:anywhere]">
    <h2 id="time-limited-quiescence-title" className="font-serif text-sm">同一時間の静止探索比較</h2>
    <p className="mt-2 text-stone-300">同一局面・標準評価・最大深さ4で、各条件に独立した1秒を与えて順番に解析します。盤面には着手しません。</p>
    <p className="mt-1 text-stone-400">全体では約3秒以上かかる場合があります。深さ1の最低保証と協調的な期限確認のため、各条件も1秒を超える場合があります。</p>
    <p className="mt-1 text-stone-400">時間だけで棋力や設定の優劣を判断せず、最適設定を自動選択しません。主変化は完了深さに静止探索の追加手数を加えた長さまで伸びる場合があります。</p>
    <p className="mt-1 text-stone-400">参考処理時間は探索API全体（未完了反復を含む）です。Worker起動・通信・描画は含みません。統計は完了反復のみです。</p>
    {state.kind === 'thinking' && <p role="status" className="mt-2">静止探索の3条件を順番に解析中（各1秒）</p>}
    {state.kind === 'cancelled' && <p role="status" className="mt-2">同一時間の静止探索比較を中止しました。</p>}
    {state.kind === 'error' && <p role="alert" className="mt-2">同一時間の静止探索比較に失敗しました: {state.message}</p>}
    {display && state.kind === 'idle' && <>
      <p className="mt-2">先手基準：＋は先手有利、−は後手有利、0は互角です。</p>
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
        {display.entries.map(({ result, principalVariationNotations }) => {
          const name = quiescenceComparisonName(result.quiescenceMaxTacticalDepth);
          return <article key={name} aria-label={name} className="min-w-0 space-y-3 rounded border border-sky-900 p-3">
            <h3 className="text-sm font-semibold">{name}</h3>
            <dl className="grid grid-cols-2 gap-2">
              <dt>推奨手</dt><dd>{principalVariationNotations[0] ?? '指せる手はありません'}</dd>
              <dt>評価値</dt><dd>先手 {formatSenteEvaluation(result.selectedEvaluation ?? result.evaluationBreakdown.total, display.perspective)}</dd>
              <dt>完了深さ／指定最大深さ</dt><dd>{result.completedDepth} / {result.requestedMaxDepth} ply</dd>
              <dt>時間切れ</dt><dd>{result.timedOut ? 'あり' : 'なし（最大深さ完了）'}</dd>
              <dt>API全体の参考処理時間</dt><dd>{result.elapsedMilliseconds.toFixed(1)} ms</dd>
            </dl>
            <div><h4>主変化</h4>{principalVariationNotations.length > 0
              ? <ol className="mt-1 list-decimal space-y-1 pl-5">{principalVariationNotations.map((notation, index) => <li key={index}>{notation}</li>)}</ol>
              : <p>手順なし</p>}</div>
            {([false, true] as const).map((total) => <Fragment key={String(total)}>
              {([['通常探索', normalStatistics], ['静止探索', tacticalStatistics]] as const).map(([label, keys]) =>
                <div key={label} className="border-t border-sky-900 pt-2">
                  <h4>{total ? '全完了反復合計' : '最深完了反復'}の{label}</h4>
                  <dl className="mt-1 grid grid-cols-2 gap-2">{keys.map(([title, current, sum]) =>
                    <Fragment key={current}><dt>{title}</dt><dd>{result[total ? sum : current]}</dd></Fragment>)}</dl>
                </div>)}
            </Fragment>)}
          </article>;
        })}
      </div>
    </>}
  </section>;
}
