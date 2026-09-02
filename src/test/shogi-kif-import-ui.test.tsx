import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';

const KIF = '#KIF version=2.0 encoding=UTF-8\n手数----指手---------消費時間--\n1 ７六歩(77)\n';

function input(): HTMLInputElement {
  const element = document.getElementById('shogi-kif-file-input');
  if (!(element instanceof HTMLInputElement)) throw new Error('KIF file input not found');
  return element;
}

describe('KIF棋譜読み込みUI', () => {
  it('確認・キャンセル・Escape・同じファイルの再選択で現在局面とフォーカスを維持する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    const button = screen.getByRole('button', { name: 'KIF棋譜を読み込む' });
    const file = new File([KIF], 'same.kif', { type: 'text/plain' });
    expect(input()).toHaveAttribute('accept', '.kif,text/plain');

    await user.upload(input(), file);
    expect(await screen.findByRole('dialog', { name: 'このKIF棋譜を読み込みますか？' })).toHaveTextContent('1手');
    expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(button).toHaveFocus();
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');

    await user.upload(input(), file);
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.upload(input(), file);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('確定時だけ棋譜と最新局面を置換し、未終局棋譜を続行可能にする', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    await user.upload(input(), new File([KIF], 'continue.kif', { type: 'text/plain' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: '読み込む' }));
    expect(document.getElementById('shogi-status-badge')).toHaveTextContent('対局中 / 後手番');
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '1');
    expect(screen.getByText('KIF棋譜を読み込みました（continue.kif）')).toHaveAttribute('role', 'status');
  });

  it('不正なKIFはダイアログを開かずalertを表示し現在局面を維持する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    await user.upload(input(), new File([
      '#KIF version=2.0 encoding=UTF-8\n手数----指手---------消費時間--\n1 同歩(77)\n',
    ], 'bad.kif', { type: 'text/plain' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('直前の合法手'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
  });
});
