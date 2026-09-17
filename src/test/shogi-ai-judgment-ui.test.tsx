import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AiJudgmentPanel } from '../components/shogi/AiJudgmentPanel';
import type { AiSearchDisplay } from '../components/shogi/AiSearchResultPanel';
import { formatSenteEvaluation, getDisplayEvaluationBreakdown } from '../components/shogi/searchEvaluationDisplay';
import type { SearchEvaluationBreakdown } from '../domain/shogi';

const breakdown: SearchEvaluationBreakdown = {
  material: 100, pieceSquare: 20, kingSafety: -5, undefendedPieceSafety: -30, total: 85, terminal: null,
};

function search(evaluationBreakdown: SearchEvaluationBreakdown | null = breakdown): AiSearchDisplay {
  return {
    kind: 'two-ply', perspective: 'gote', selectedNotation: '△3四歩', candidateNotations: [],
    result: {
      selectedAction: null, selectedEvaluation: evaluationBreakdown?.total ?? 85, evaluationBreakdown,
      rootLegalActionCount: 1, visitedPositionCount: 2, depth: 2, elapsedMilliseconds: 1, topCandidates: [],
    },
  };
}

describe('AIの判断', () => {
  it('初期状態は折りたたみ、後手探索の評価と全項目を先手基準で表示する', async () => {
    const user = userEvent.setup();
    render(<AiJudgmentPanel search={search()} thinking={false} />);
    const summary = screen.getByText('AIの判断');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await user.click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(screen.getByText('△3四歩')).toBeVisible();
    expect(screen.getAllByText('先手 -85')).toHaveLength(2);
    for (const value of ['-100', '-20', '+5', '+30']) expect(screen.getByText(value)).toBeVisible();
    expect(screen.getByText(/＋は先手有利、−は後手有利/)).toBeVisible();
  });

  it.each([null, undefined, {}, { ...breakdown, total: 86 }, { ...breakdown, material: NaN }, { ...breakdown, terminal: 'unknown' }])(
    '欠落・不正・不整合な内訳を安全に利用不可にする: %j', async (received) => {
      const user = userEvent.setup();
      // Simulate a legacy/malformed structured-clone payload at the UI boundary.
      const display = search();
      Object.assign(display.result, { evaluationBreakdown: received });
      render(<AiJudgmentPanel search={display} thinking={false} />);
      await user.click(screen.getByText('AIの判断'));
      expect(screen.getByText('内訳は利用できません')).toBeVisible();
      expect(screen.getByText('先手 -85')).toBeVisible();
      expect(screen.queryByText('内訳合計')).not.toBeInTheDocument();
    },
  );

  it('解析中・空の状態では前局面の数値を残さない', async () => {
    const user = userEvent.setup();
    const view = render(<AiJudgmentPanel search={search()} thinking={false} />);
    await user.click(screen.getByText('AIの判断'));
    view.rerender(<AiJudgmentPanel search={search()} thinking />);
    expect(screen.getByRole('status')).toHaveTextContent('解析中');
    expect(screen.queryByText('先手 -85')).not.toBeInTheDocument();
    view.rerender(<AiJudgmentPanel search={null} thinking={false} />);
    expect(screen.getByText('AIの探索結果はまだありません。')).toBeVisible();
  });

  it.each([
    ['win', Infinity, '後手勝ち', '先手 -∞'],
    ['loss', -Infinity, '先手勝ち', '先手 +∞'],
    ['draw', 0, '引き分け', '先手 0'],
  ] as const)('終局 %s は有限項目の加算より終局評価を優先する', async (terminal, total, outcome, text) => {
    const user = userEvent.setup();
    render(<AiJudgmentPanel search={search({ material: 0, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0, total, terminal })} thinking={false} />);
    await user.click(screen.getByText('AIの判断'));
    expect(screen.getAllByText(text)).toHaveLength(2);
    expect(screen.getByText(new RegExp(`探索末端は終局（${outcome}）`))).toBeVisible();
  });

  it('符号変換は先後、ゼロ、無限値、欠落値で一貫する', () => {
    expect(formatSenteEvaluation(85, 'sente')).toBe('+85');
    expect(formatSenteEvaluation(85, 'gote')).toBe('-85');
    expect(formatSenteEvaluation(-85, 'gote')).toBe('+85');
    expect(formatSenteEvaluation(0, 'gote')).toBe('0');
    expect(formatSenteEvaluation(Infinity, 'gote')).toBe('-∞');
    expect(formatSenteEvaluation(-Infinity, 'gote')).toBe('+∞');
    expect(formatSenteEvaluation(null, 'sente')).toBe('該当なし');
    expect(formatSenteEvaluation(NaN, 'sente')).toBe('該当なし');
    expect(getDisplayEvaluationBreakdown(breakdown, 99)).toBeNull();
    expect(getDisplayEvaluationBreakdown({ ...breakdown, terminal: 'win', total: Infinity }, Infinity)).toBeNull();
  });
});
