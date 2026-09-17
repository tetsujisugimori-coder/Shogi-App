import type { AiSearchDisplay } from './AiSearchResultPanel';
import { formatSenteEvaluation, getDisplayEvaluationBreakdown } from './searchEvaluationDisplay';

interface AiJudgmentPanelProps {
  search: AiSearchDisplay | null;
  thinking: boolean;
}

/** Collapsed by default at every width; shares the accepted search result. */
export function AiJudgmentPanel({ search, thinking }: AiJudgmentPanelProps) {
  const breakdown = search && !thinking
    ? getDisplayEvaluationBreakdown(search.result.evaluationBreakdown, search.result.selectedEvaluation)
    : null;
  return (
    <details className="w-full min-w-0 rounded border border-sky-800/70 bg-sky-950/30 p-3 text-xs text-sky-100 shadow-inner xl:max-w-sm">
      <summary className="cursor-pointer font-serif text-sm tracking-[0.12em] focus-visible:outline focus-visible:outline-sky-300">
        AIの判断
      </summary>
      {thinking ? <p className="mt-2" role="status">解析中</p> : !search ? (
        <p className="mt-2 text-stone-400">AIの探索結果はまだありません。</p>
      ) : (
        <div className="mt-2 min-w-0 space-y-3 break-words [overflow-wrap:anywhere]">
          <p className="text-stone-300">先手基準：＋は先手有利、−は後手有利、0は互角です。</p>
          <p className="text-stone-400">直前のAI着手を選んだ探索の末端評価です。現在の盤面そのものの評価ではありません。</p>
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2">
            <dt>推奨手</dt><dd>{search.selectedNotation}</dd>
            <dt>評価値</dt><dd>先手 {formatSenteEvaluation(search.result.selectedEvaluation, search.perspective)}</dd>
          </dl>
          {search.kind === 'time-limited-worker' && (
            <div>
              <h3 className="font-medium">AIの読み筋</h3>
              <p className="mt-1 text-stone-400">完了深さ {search.result.completedDepth} ply 中 {search.principalVariationNotations.length} 手順</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {search.principalVariationNotations.map((notation, index) => <li key={index}>{notation}</li>)}
              </ol>
            </div>
          )}
          {breakdown ? (
            <>
              <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-sky-900/80 pt-2">
                <dt>駒得<span className="block text-stone-400">盤上と持ち駒の価値差</span></dt>
                <dd>{formatSenteEvaluation(breakdown.material, search.perspective)}</dd>
                <dt>位置<span className="block text-stone-400">駒の配置による評価</span></dt>
                <dd>{formatSenteEvaluation(breakdown.pieceSquare, search.perspective)}</dd>
                <dt>玉の安全<span className="block text-stone-400">玉への利きと周辺の守り</span></dt>
                <dd>{formatSenteEvaluation(breakdown.kingSafety, search.perspective)}</dd>
                <dt>守られていない駒<span className="block text-stone-400">敵の利きがある未防御駒の危険度</span></dt>
                <dd>{formatSenteEvaluation(breakdown.undefendedPieceSafety, search.perspective)}</dd>
                <dt className="font-semibold">内訳合計</dt>
                <dd className="font-semibold">先手 {formatSenteEvaluation(breakdown.total, search.perspective)}</dd>
              </dl>
              {breakdown.terminal !== null && (
                <p className="text-stone-300">
                  探索末端は終局（{breakdown.terminal === 'draw' ? '引き分け' :
                    (breakdown.terminal === 'win') === (search.perspective === 'sente') ? '先手勝ち' : '後手勝ち'}）です。
                  終局評価を優先し、通常の4項目は0として扱います。合計の±∞は勝敗を表します。
                </p>
              )}
            </>
          ) : <p className="text-stone-300">内訳は利用できません</p>}
        </div>
      )}
    </details>
  );
}
