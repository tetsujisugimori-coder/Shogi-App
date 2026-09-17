import { EvaluationBreakdownDisplay } from './EvaluationBreakdownDisplay';
import { isSearchEvaluationPresetId } from '../../domain/shogi/searchEvaluationPresets';
import { SEARCH_EVALUATION_PRESET_DISPLAY } from './searchEvaluationPresetDisplay';
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
          <p>評価設定: {isSearchEvaluationPresetId(search.result.evaluationPresetId)
            ? SEARCH_EVALUATION_PRESET_DISPLAY[search.result.evaluationPresetId].name : '不明'}</p>
          <p className="text-stone-400">内訳は評価係数を適用した後の寄与値です。</p>
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
            <EvaluationBreakdownDisplay breakdown={breakdown} perspective={search.perspective} />
          ) : <p className="text-stone-300">内訳は利用できません</p>}
        </div>
      )}
    </details>
  );
}
