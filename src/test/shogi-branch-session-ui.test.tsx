// Keep the long session-switch/export scenarios in their own jsdom environment.
// The interactions and assertions are unchanged; no timeout override is used.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import { executeMove } from '../domain/shogi';
import { createInitialBoardState, type BoardState } from '../types/shogi';

function applyMove(
  state: BoardState,
  from: { row: number; col: number },
  to: { row: number; col: number },
  promotion?: 'promote' | 'decline'
): BoardState {
  const execution = executeMove(state, from, to, { promotion });
  expect(execution.type).toBe('applied');
  if (execution.type !== 'applied') throw new Error('fixture move failed');
  return execution.state;
}

function createFourMoveState(): BoardState {
  let state = createInitialBoardState();
  state = applyMove(state, { row: 6, col: 2 }, { row: 5, col: 2 }); // ▲7六歩
  state = applyMove(state, { row: 2, col: 6 }, { row: 3, col: 6 }); // △3四歩
  state = applyMove(state, { row: 6, col: 3 }, { row: 5, col: 3 }); // ▲6六歩
  return applyMove(state, { row: 2, col: 5 }, { row: 3, col: 5 }); // △4四歩
}

describe('兄弟分岐の切り替えとセッション出力UI', () => {
  it('同じ本譜から作った兄弟分岐をセッション内に保持し、独立した続きへ切り替えられる', async () => {
    const user = userEvent.setup();
    render(React.createElement(ShogiResearchScreen, { initialState: createFourMoveState() }));
    const root = document.getElementById('shogi-research-screen')!;

    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    await user.click(document.querySelector('[data-coordinate="6七"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="6六"]') as HTMLElement);
    expect(root).toHaveAttribute('data-last-move', '▲6六歩');

    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    expect(root).toHaveAttribute('data-history-count', '4');
    expect(root).toHaveAttribute('data-session-branch-count', '1');
    expect(screen.getByRole('button', { name: '本譜' })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    await user.click(document.querySelector('[data-coordinate="2七"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="2六"]') as HTMLElement);
    expect(root).toHaveAttribute('data-last-move', '▲2六歩');
    expect(root).toHaveAttribute('data-session-branch-count', '2');

    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    await user.click(screen.getByRole('button', { name: '第2手後からの分岐 1' }));
    expect(root).toHaveAttribute('data-history-count', '3');
    expect(root).toHaveAttribute('data-last-move', '▲6六歩');
    await user.click(document.querySelector('[data-coordinate="4三"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="4四"]') as HTMLElement);
    expect(root).toHaveAttribute('data-last-move', '△4四歩');

    await user.click(screen.getByRole('button', { name: '第2手後からの分岐 2' }));
    expect(root).toHaveAttribute('data-history-count', '3');
    expect(root).toHaveAttribute('data-last-move', '▲2六歩');
    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));
    expect(root).toHaveAttribute('data-last-move', '△4四歩');

    await user.click(screen.getByRole('button', { name: '第2手後からの分岐 1' }));
    expect(root).toHaveAttribute('data-history-count', '4');
    expect(root).toHaveAttribute('data-last-move', '△4四歩');
    expect(screen.getByRole('button', { name: '第2手後からの分岐 1' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('JSONでは本譜と兄弟分岐をセッション全体で、KIFでは選択中の一本道だけを書き出す', async () => {
    const user = userEvent.setup();
    render(React.createElement(ShogiResearchScreen, { initialState: createFourMoveState() }));
    await user.click(screen.getByRole('button', { name: /2手目 △3四歩の局面を表示/ }));
    await user.click(screen.getByRole('button', { name: 'ここから指し直す' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ここから指し直す' }));
    await user.click(document.querySelector('[data-coordinate="6七"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="6六"]') as HTMLElement);
    await user.click(screen.getByRole('button', { name: '本譜へ戻る' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '本譜へ戻る' }));

    const blobs: Blob[] = [];
    const originalCreateElement = document.createElement.bind(document);
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:session-${blobs.length}`;
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'a') vi.spyOn(element as HTMLAnchorElement, 'click').mockImplementation(() => {});
      return element;
    });

    try {
      await user.click(screen.getByRole('button', { name: '対局記録を保存' }));
      const mainlineSession = JSON.parse(await blobs[0].text());
      expect(mainlineSession.format).toBe('shogi-app-game-record-session');
      expect(mainlineSession.mainline.history).toHaveLength(4);
      expect(mainlineSession.mainline.branchFrom).toBeUndefined();
      expect(mainlineSession.branches).toHaveLength(1);

      await user.click(screen.getByRole('button', { name: '第2手後からの分岐 1' }));
      await user.click(screen.getByRole('button', { name: '対局記録を保存' }));
      const branchSession = JSON.parse(await blobs[1].text());
      expect(branchSession.mainline.history).toHaveLength(4);
      expect(branchSession.branches[0].record.history).toHaveLength(3);
      expect(branchSession.branches[0].record.recordId).not.toBe(branchSession.mainline.recordId);
      expect(branchSession.branches[0].record.branchFrom).toEqual({ recordId: branchSession.mainline.recordId, ply: 2 });
      expect(branchSession.selectedRecordId).toBe(branchSession.branches[0].record.recordId);

      await user.click(screen.getByRole('button', { name: 'KIF棋譜を保存' }));
      expect(await blobs[2].text()).toContain('   3 ６六歩(67)');
      expect(await blobs[2].text()).not.toContain('branchFrom');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

});
