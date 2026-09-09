import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';

const KIF = '#KIF version=2.0 encoding=UTF-8\n手数----指手---------消費時間--\n1 ７六歩(77)\n';

function kifInput(): HTMLInputElement {
  const input = document.getElementById('shogi-kif-file-input');
  if (!(input instanceof HTMLInputElement)) throw new Error('KIF file input not found.');
  return input;
}

function searchPanel(): HTMLElement {
  const panel = screen.getByRole('heading', { name: 'AI思考結果' }).closest('section');
  if (!panel) throw new Error('AI search result panel not found.');
  return panel;
}

describe('AI思考結果パネル', () => {
  it('AI着手後に計測値と上位候補を表示し、新規対局とKIF読込で古い結果を消す', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);

    await user.click(screen.getByRole('button', { name: '2手読みAIに指させる' }));
    const firstPanel = searchPanel();
    expect(within(firstPanel).getByText('選択手')).toBeInTheDocument();
    expect(within(firstPanel).getByText('評価値')).toBeInTheDocument();
    expect(within(firstPanel).getByText('合法手数')).toBeInTheDocument();
    expect(within(firstPanel).getByText('調査局面数')).toBeInTheDocument();
    expect(within(firstPanel).getByText('読みの深さ')).toBeInTheDocument();
    expect(within(firstPanel).getByText('経過時間')).toBeInTheDocument();
    expect(within(firstPanel).getByRole('heading', { name: '上位候補手' })).toBeInTheDocument();
    expect(within(firstPanel).getAllByRole('listitem')).toHaveLength(3);
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-ai-search-depth', '2');

    await user.click(screen.getByRole('button', { name: '新しい対局' }));
    await user.click(screen.getByRole('button', { name: '新しい対局を始める' }));
    expect(screen.queryByRole('heading', { name: 'AI思考結果' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '2手読みAIに指させる' }));
    expect(searchPanel()).toBeInTheDocument();
    await user.upload(kifInput(), new File([KIF], 'replace.kif', { type: 'text/plain' }));
    await user.click(await screen.findByRole('button', { name: '読み込む' }));
    expect(screen.queryByRole('heading', { name: 'AI思考結果' })).not.toBeInTheDocument();
  });
});
