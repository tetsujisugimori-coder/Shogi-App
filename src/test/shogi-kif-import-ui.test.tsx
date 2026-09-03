import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';

const KIF = '#KIF version=2.0 encoding=UTF-8\n手数----指手---------消費時間--\n1 ７六歩(77)\n';
const SHIFT_JIS_RESIGNATION = new Uint8Array([
  0x23, 0x4b, 0x49, 0x46, 0x20, 0x76, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e, 0x3d, 0x32, 0x2e, 0x30, 0x20, 0x65, 0x6e, 0x63, 0x6f, 0x64, 0x69, 0x6e, 0x67, 0x3d, 0x53, 0x68, 0x69, 0x66, 0x74, 0x5f, 0x4a, 0x49, 0x53, 0x0d, 0x0a, 0x8e, 0xe8, 0x90, 0x94, 0x2d, 0x2d, 0x2d, 0x2d, 0x8e, 0x77, 0x8e, 0xe8, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x8f, 0xc1, 0x94, 0xef, 0x8e, 0x9e, 0x8a, 0xd4, 0x2d, 0x2d, 0x0d, 0x0a, 0x31, 0x20, 0x93, 0x8a, 0x97, 0xb9, 0x0d, 0x0a,
]);

afterEach(() => vi.restoreAllMocks());

function input(): HTMLInputElement {
  const element = document.getElementById('shogi-kif-file-input');
  if (!(element instanceof HTMLInputElement)) throw new Error('KIF file input not found');
  return element;
}

describe('KIF棋譜読み込みUI', () => {
  it('File.arrayBufferでShift_JISを読み込み、確認ダイアログに文字コードを表示する', async () => {
    const user = userEvent.setup();
    const arrayBuffer = vi.spyOn(File.prototype, 'arrayBuffer').mockResolvedValue(SHIFT_JIS_RESIGNATION.buffer);
    render(<ShogiResearchScreen />);

    await user.upload(input(), new File(['placeholder'], 'legacy.kif', { type: 'text/plain' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Shift_JIS');
    expect(arrayBuffer).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '読み込む' }));
    expect(document.getElementById('shogi-status-badge')).toHaveTextContent('終局');
  });

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
