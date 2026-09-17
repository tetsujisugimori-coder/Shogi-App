import type { SearchEvaluationBreakdown } from '../../domain/shogi';
import type { Player } from '../../types/shogi';
import { formatSenteEvaluation } from './searchEvaluationDisplay';

export function EvaluationBreakdownDisplay({ breakdown, perspective }: {
  breakdown: SearchEvaluationBreakdown; perspective: Player;
}) {
  return (
    <>
      <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-sky-900/80 pt-2">
        <dt>駒得<span className="block text-stone-400">盤上と持ち駒の価値差</span></dt>
        <dd>{formatSenteEvaluation(breakdown.material, perspective)}</dd>
        <dt>位置<span className="block text-stone-400">駒の配置による評価</span></dt>
        <dd>{formatSenteEvaluation(breakdown.pieceSquare, perspective)}</dd>
        <dt>玉の安全<span className="block text-stone-400">玉への利きと周辺の守り</span></dt>
        <dd>{formatSenteEvaluation(breakdown.kingSafety, perspective)}</dd>
        <dt>守られていない駒<span className="block text-stone-400">敵の利きがある未防御駒の危険度</span></dt>
        <dd>{formatSenteEvaluation(breakdown.undefendedPieceSafety, perspective)}</dd>
        <dt className="font-semibold">内訳合計</dt>
        <dd className="font-semibold">先手 {formatSenteEvaluation(breakdown.total, perspective)}</dd>
      </dl>
      {breakdown.terminal !== null && (
        <p className="text-stone-300">
          探索末端は終局（{breakdown.terminal === 'draw' ? '引き分け' :
            (breakdown.terminal === 'win') === (perspective === 'sente') ? '先手勝ち' : '後手勝ち'}）です。
          終局評価を優先し、通常の4項目は0として扱います。合計の±∞は勝敗を表します。
        </p>
      )}
    </>
  );
}
