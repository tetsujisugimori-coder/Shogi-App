import type {
  TimeLimitedIterativeDeepeningAlphaBetaSearchResult,
  TwoPlyMinimaxSearchResult,
} from '../../domain/shogi';

export type AiSearchDisplay =
  | {
      kind: 'two-ply';
      result: TwoPlyMinimaxSearchResult;
      selectedNotation: string;
      candidateNotations: readonly string[];
    }
  | {
      kind: 'time-limited-worker';
      result: TimeLimitedIterativeDeepeningAlphaBetaSearchResult;
      selectedNotation: string;
    };

interface AiSearchResultPanelProps {
  search: AiSearchDisplay;
}

function formatEvaluation(evaluation: number | null): string {
  if (evaluation === null) return '該当なし';
  if (evaluation === Number.POSITIVE_INFINITY) return '+∞';
  if (evaluation === Number.NEGATIVE_INFINITY) return '-∞';
  return String(evaluation);
}

/** A compact presentation of the latest synchronous or Worker AI search. */
export function AiSearchResultPanel({ search }: AiSearchResultPanelProps) {
  if (search.kind === 'time-limited-worker') {
    const { result, selectedNotation } = search;
    return (
      <section
        aria-labelledby="ai-search-result-title"
        className="w-full min-w-0 rounded border border-sky-800/70 bg-sky-950/30 p-3 shadow-inner xl:max-w-sm"
      >
        <h2 id="ai-search-result-title" className="font-serif text-sm tracking-[0.12em] text-sky-100">
          AI思考結果
        </h2>
        <p className="mt-1 text-xs text-stone-300">時間制限付き反復深化αβ探索</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-stone-400">選択手</dt>
          <dd className="min-w-0 break-words text-sky-100">{selectedNotation}</dd>
          <dt className="text-stone-400">評価値</dt>
          <dd className="text-sky-100">{formatEvaluation(result.selectedEvaluation)}</dd>
          <dt className="text-stone-400">完了深さ</dt>
          <dd className="text-sky-100">{result.completedDepth}</dd>
          <dt className="text-stone-400">指定最大深さ</dt>
          <dd className="text-sky-100">{result.requestedMaxDepth}</dd>
          <dt className="text-stone-400">API全体の経過時間</dt>
          <dd className="text-sky-100">{result.elapsedMilliseconds.toFixed(2)} ms</dd>
          <dt className="text-stone-400">最深完了反復の調査局面数</dt>
          <dd className="text-sky-100">{result.visitedPositionCount}</dd>
          <dt className="text-stone-400">最深完了反復の枝刈り回数</dt>
          <dd className="text-sky-100">{result.cutoffCount}</dd>
          <dt className="text-stone-400">最深完了反復の未調査候補手数</dt>
          <dd className="text-sky-100">{result.skippedActionCount}</dd>
          <dt className="text-stone-400">全反復合計の調査局面数</dt>
          <dd className="text-sky-100">{result.totalVisitedPositionCount}</dd>
          <dt className="text-stone-400">全反復合計の枝刈り回数</dt>
          <dd className="text-sky-100">{result.totalCutoffCount}</dd>
          <dt className="text-stone-400">全反復合計の未調査候補手数</dt>
          <dd className="text-sky-100">{result.totalSkippedActionCount}</dd>
        </dl>
      </section>
    );
  }

  const { result, selectedNotation, candidateNotations } = search;
  return (
    <section
      aria-labelledby="ai-search-result-title"
      className="w-full min-w-0 rounded border border-violet-800/70 bg-violet-950/30 p-3 shadow-inner xl:max-w-sm"
    >
      <h2 id="ai-search-result-title" className="font-serif text-sm tracking-[0.12em] text-violet-100">
        AI思考結果
      </h2>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-stone-400">選択手</dt>
        <dd className="min-w-0 break-words text-violet-100">{selectedNotation}</dd>
        <dt className="text-stone-400">評価値</dt>
        <dd className="text-violet-100">{formatEvaluation(result.selectedEvaluation)}</dd>
        <dt className="text-stone-400">合法手数</dt>
        <dd className="text-violet-100">{result.rootLegalActionCount}</dd>
        <dt className="text-stone-400">調査局面数</dt>
        <dd className="text-violet-100">{result.visitedPositionCount}</dd>
        <dt className="text-stone-400">読みの深さ</dt>
        <dd className="text-violet-100">{result.depth}</dd>
        <dt className="text-stone-400">経過時間</dt>
        <dd className="text-violet-100">{result.elapsedMilliseconds.toFixed(2)} ms</dd>
      </dl>
      <div className="mt-3 border-t border-violet-900/80 pt-2">
        <h3 className="text-xs font-medium text-stone-300">上位候補手</h3>
        <ol className="mt-1 space-y-1 text-xs text-violet-100">
          {result.topCandidates.map((candidate, index) => (
            <li key={`${candidateNotations[index]}-${index}`} className="flex justify-between gap-3">
              <span>{candidateNotations[index]}</span>
              <span>{formatEvaluation(candidate.evaluation)}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
