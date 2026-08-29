import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import * as shogiDomain from '../domain/shogi';
import {
  calculateAgreedJishogiPoints,
  cancelAgreedJishogiProposal,
  cloneBoardSquares,
  determineAgreedJishogiOutcome,
  evaluateAgreedJishogi,
  proposeAgreedJishogi,
  respondToAgreedJishogiProposal,
  type AgreedJishogiResponse,
} from '../domain/shogi';
import type {
  AgreedJishogiDrawGameResult,
  AgreedJishogiPointLossGameResult,
  BoardState,
  GameResult,
  Piece,
  PieceType,
  Player,
} from '../types/shogi';
import { createInitialBoardState } from '../types/shogi';

function piece(id: string, type: PieceType, player: Player, isPromoted = false): Piece {
  return { id, type, player, ...(isPromoted ? { isPromoted: true } : {}) };
}

function pointsAsHand(player: Player, points: number): Piece[] {
  const result: Piece[] = [];
  let remaining = points;
  let index = 0;
  while (remaining >= 5) {
    result.push(piece(`${player}-major-${index}`, index % 2 === 0 ? 'rook' : 'bishop', player, index % 3 === 0));
    remaining -= 5;
    index += 1;
  }
  while (remaining > 0) {
    result.push(piece(`${player}-small-${index}`, 'pawn', player, index % 2 === 0));
    remaining -= 1;
    index += 1;
  }
  return result;
}

function createJishogiState(
  sentePoints: number,
  gotePoints: number,
  entering: 'sente' | 'gote' | 'both' | 'none' = 'sente',
  overrides: Partial<BoardState> = {}
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) for (const square of row) square.piece = null;
  const senteRow = entering === 'sente' || entering === 'both' ? 1 : 8;
  const goteRow = entering === 'gote' || entering === 'both' ? 7 : 0;
  squares[senteRow][1].piece = piece('sente-king', 'king', 'sente');
  squares[goteRow][7].piece = piece('gote-king', 'king', 'gote');
  return {
    ...initial,
    squares,
    senteHand: pointsAsHand('sente', sentePoints),
    goteHand: pointsAsHand('gote', gotePoints),
    ...overrides,
  };
}

function proposed(state: BoardState = createJishogiState(24, 24)) {
  const result = proposeAgreedJishogi(state);
  if (result.type !== 'proposed') throw new Error(`proposal rejected: ${result.reason}`);
  return result.proposal;
}

describe('合意持将棋の全所有駒点数', () => {
  it.each([
    ['rook', false, 5], ['bishop', false, 5], ['rook', true, 5], ['bishop', true, 5],
    ['gold', false, 1], ['silver', false, 1], ['knight', false, 1], ['lance', false, 1],
    ['pawn', false, 1], ['silver', true, 1], ['knight', true, 1], ['lance', true, 1],
    ['pawn', true, 1], ['king', false, 0],
  ] as const)('%s（成り=%s）は%s点', (type, isPromoted, expected) => {
    const state = createJishogiState(0, 0);
    state.squares[4][4].piece = piece('target', type, 'sente', isPromoted);
    expect(calculateAgreedJishogiPoints(state, 'sente')).toBe(expected);
  });

  it('盤上の場所を問わず自駒と持ち駒を数え、相手駒は数えない', () => {
    const state = createJishogiState(0, 0);
    state.squares[0][0].piece = piece('own-major', 'rook', 'sente');
    state.squares[8][8].piece = piece('own-small', 'silver', 'sente', true);
    state.squares[4][4].piece = piece('enemy-major', 'bishop', 'gote');
    state.senteHand = [piece('hand-major', 'bishop', 'sente'), piece('wrong-owner', 'rook', 'gote')];
    expect(calculateAgreedJishogiPoints(state, 'sente')).toBe(11);
  });

  it('駒ID・持ち駒順序に依存せず、入力stateを変更しない', () => {
    const state = createJishogiState(25, 24);
    const snapshot = JSON.stringify(state);
    const reordered = {
      ...state,
      senteHand: [...state.senteHand].reverse().map((item, index) => ({ ...item, id: `changed-${index}` })),
    };
    expect(calculateAgreedJishogiPoints(state, 'sente')).toBe(25);
    expect(calculateAgreedJishogiPoints(reordered, 'sente')).toBe(25);
    evaluateAgreedJishogi(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('入玉宣言の集計と異なり、敵陣外の盤上駒も集計する', () => {
    const state = createJishogiState(0, 0);
    state.squares[8][0].piece = piece('outside-rook', 'rook', 'sente');
    expect(calculateAgreedJishogiPoints(state, 'sente')).toBe(5);
    expect(shogiDomain.calculateEnteringKingPoints(state, 'sente')).toBe(0);
  });
});

describe('合意持将棋の24点判定と入玉条件', () => {
  it.each([
    [23, 24, 'point_loss', 'gote', 'sente'],
    [24, 24, 'draw', null, null],
    [25, 24, 'draw', null, null],
    [24, 23, 'point_loss', 'sente', 'gote'],
    [24, 25, 'draw', null, null],
  ] as const)('先手%s点・後手%s点を%sと判定する', (sente, gote, kind, winner, loser) => {
    expect(determineAgreedJishogiOutcome(sente, gote)).toMatchObject({ kind, ...(winner ? { winner, loser } : {}) });
  });

  it.each([
    ['sente', true, false], ['gote', false, true], ['both', true, true], ['none', false, false],
  ] as const)('%s入玉を先手=%s・後手=%sと評価する', (entering, sente, gote) => {
    expect(evaluateAgreedJishogi(createJishogiState(24, 24, entering))).toMatchObject({
      senteKingInEnemyCamp: sente,
      goteKingInEnemyCamp: gote,
      hasEnteringKing: sente || gote,
      canPropose: sente || gote,
    });
  });

  it.each(['sente', 'gote'] as const)('%s玉欠落を安全に拒否する', (missing) => {
    const state = createJishogiState(24, 24, 'both');
    for (const row of state.squares) for (const square of row) {
      if (square.piece?.type === 'king' && square.piece.player === missing) square.piece = null;
    }
    const evaluation = evaluateAgreedJishogi(state);
    expect(evaluation.canPropose).toBe(false);
    expect(evaluation.reasons).toContain(`${missing}_king_missing`);
  });

  it('誰も入玉していない局面は反則負けにせず提案不可とする', () => {
    const state = createJishogiState(24, 24, 'none');
    const result = proposeAgreedJishogi(state);
    expect(result).toMatchObject({ type: 'rejected', state, reason: 'no_king_in_enemy_camp' });
    expect(state.status).toBe('active');
  });

  it('双方24点未満の不正stateは点数不足側を確定できず提案不可にする', () => {
    const state = createJishogiState(23, 23);
    const snapshot = JSON.stringify(state);
    const evaluation = evaluateAgreedJishogi(state);
    expect(evaluation).toMatchObject({
      outcome: { kind: 'invalid_point_distribution' },
      canPropose: false,
      reasons: expect.arrayContaining(['invalid_point_distribution']),
    });

    const result = proposeAgreedJishogi(state);
    expect(result).toMatchObject({
      type: 'rejected',
      state,
      reason: 'invalid_point_distribution',
      message: '双方が24点未満のため、点数不足側を一意に確定できず提案できません。',
    });
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(state.status).toBe('active');
    expect(state.result).toBeNull();
  });
});

describe('合意持将棋の提案・キャンセル・応答API', () => {
  it.each(['active', 'check'] as const)('%sの現在手番側から相手へ提案できる', (status) => {
    const state = createJishogiState(24, 24, 'sente', { status, turn: 'gote' });
    expect(proposeAgreedJishogi(state)).toMatchObject({
      type: 'proposed', state,
      proposal: { proposer: 'gote', responder: 'sente', sentePoints: 24, gotePoints: 24 },
    });
  });

  it('現在手番でない側の提案を拒否する', () => {
    const state = createJishogiState(24, 24);
    expect(proposeAgreedJishogi(state, 'gote')).toMatchObject({
      type: 'rejected', state, reason: 'proposer_not_current_turn',
    });
  });

  it('提案者だけがキャンセルでき、stateを変更しない', () => {
    const state = createJishogiState(24, 24);
    const proposal = proposed(state);
    expect(cancelAgreedJishogiProposal(state, proposal, 'gote')).toMatchObject({ type: 'rejected', state, reason: 'only_proposer_can_cancel' });
    expect(cancelAgreedJishogiProposal(state, proposal, 'sente')).toEqual({ type: 'cancelled', state });
  });

  it('相手の拒否では同じstate参照で対局を継続する', () => {
    const state = createJishogiState(24, 24);
    const result = respondToAgreedJishogiProposal(state, proposed(state), 'gote', 'reject');
    expect(result).toMatchObject({ type: 'declined', state });
    expect(result.state).toBe(state);
    expect(result.state.status).toBe('active');
  });

  it('自己承諾と不整合な応答者を安全に拒否する', () => {
    const state = createJishogiState(24, 24);
    const proposal = proposed(state);
    expect(respondToAgreedJishogiProposal(state, proposal, 'sente', 'accept')).toMatchObject({ type: 'rejected', reason: 'self_acceptance', state });
    const tampered = { ...proposal, responder: 'sente' as const };
    expect(respondToAgreedJishogiProposal(state, tampered, 'gote', 'accept')).toMatchObject({ type: 'rejected', reason: 'proposal_mismatch', state });
  });

  it('型境界を越えた承諾・拒否以外の応答値を安全に拒否する', () => {
    const state = createJishogiState(24, 24);
    const invalidResponse = 'approve' as AgreedJishogiResponse;
    expect(respondToAgreedJishogiProposal(state, proposed(state), 'gote', invalidResponse)).toMatchObject({
      type: 'rejected', reason: 'invalid_response', state,
    });
  });

  it.each(['sentePoints', 'gotePoints'] as const)(
    '提案の%sを改変した承諾を局面不一致として拒否する',
    (pointField) => {
      const state = createJishogiState(24, 24);
      const proposal = proposed(state);
      const tamperedProposal = { ...proposal, [pointField]: proposal[pointField] + 1 };
      expect(
        respondToAgreedJishogiProposal(state, tamperedProposal, 'gote', 'accept')
      ).toMatchObject({
        type: 'rejected',
        state,
        reason: 'proposal_mismatch',
      });
    }
  );

  it('局面キーと手数が同じでも再計算点数が提案時点と違えば拒否し、全状態を維持する', () => {
    const oldResult = { winner: null, loser: null, endReason: 'repetition' } satisfies GameResult;
    const state = createJishogiState(24, 24, 'both', {
      moveNumber: 501,
      result: oldResult,
      moveLimitJishogi: { kind: 'awaiting_continuous_check_end', checkingPlayer: 'gote' },
    });
    const proposal = proposed(state);
    const changedState: BoardState = {
      ...state,
      senteHand: state.senteHand.map((handPiece, index) =>
        index === 0 ? { ...handPiece, player: 'gote' } : handPiece
      ),
    };
    expect(shogiDomain.createPositionKey(changedState)).toBe(proposal.positionKey);
    expect(changedState.moveNumber).toBe(proposal.moveNumber);
    expect(calculateAgreedJishogiPoints(changedState, 'sente')).not.toBe(proposal.sentePoints);

    const snapshot = JSON.stringify(changedState);
    const result = respondToAgreedJishogiProposal(
      changedState,
      proposal,
      'gote',
      'accept'
    );
    expect(result).toMatchObject({
      type: 'rejected',
      state: changedState,
      reason: 'proposal_mismatch',
    });
    expect(result.state).toBe(changedState);
    expect(JSON.stringify(changedState)).toBe(snapshot);
    expect(result.state.squares).toBe(changedState.squares);
    expect(result.state.senteHand).toBe(changedState.senteHand);
    expect(result.state.goteHand).toBe(changedState.goteHand);
    expect(result.state.turn).toBe(changedState.turn);
    expect(result.state.moveNumber).toBe(changedState.moveNumber);
    expect(result.state.history).toBe(changedState.history);
    expect(result.state.lastMove).toBe(changedState.lastMove);
    expect(result.state.foulHistory).toBe(changedState.foulHistory);
    expect(result.state.positionHistory).toBe(changedState.positionHistory);
    expect(result.state.moveLimitJishogi).toBe(changedState.moveLimitJishogi);
    expect(result.state.result).toBe(oldResult);
  });

  it('駒IDと持ち駒順序だけの変更は同じ提案として承諾できる', () => {
    const state = createJishogiState(24, 24);
    const proposal = proposed(state);
    const reorderedState: BoardState = {
      ...state,
      senteHand: [...state.senteHand]
        .reverse()
        .map((handPiece, index) => ({ ...handPiece, id: `sente-reordered-${index}` })),
      goteHand: [...state.goteHand]
        .reverse()
        .map((handPiece, index) => ({ ...handPiece, id: `gote-reordered-${index}` })),
    };
    expect(shogiDomain.createPositionKey(reorderedState)).toBe(proposal.positionKey);
    expect(
      respondToAgreedJishogiProposal(reorderedState, proposal, 'gote', 'accept')
    ).toMatchObject({
      type: 'accepted',
      result: { endReason: 'agreed_jishogi_draw', sentePoints: 24, gotePoints: 24 },
    });
  });

  it('双方24点以上の承諾は確定点数付き無勝負にする', () => {
    const state = createJishogiState(24, 25);
    const result = respondToAgreedJishogiProposal(state, proposed(state), 'gote', 'accept');
    expect(result.type).toBe('accepted');
    if (result.type !== 'accepted') return;
    expect(result.result).toEqual({
      winner: null, loser: null, endReason: 'agreed_jishogi_draw',
      sentePoints: 24, gotePoints: 25, details: '合意による持将棋・無勝負',
    } satisfies AgreedJishogiDrawGameResult);
  });

  it.each([
    [23, 24, 'gote', 'sente'], [24, 23, 'sente', 'gote'],
  ] as const)('先手%s点・後手%s点では%s勝ち・%s負けにする', (sente, gote, winner, loser) => {
    const state = createJishogiState(sente, gote);
    const result = respondToAgreedJishogiProposal(state, proposed(state), 'gote', 'accept');
    expect(result.type).toBe('accepted');
    if (result.type !== 'accepted') return;
    expect(result.result).toMatchObject({
      winner, loser, endReason: 'agreed_jishogi_point_loss', sentePoints: sente, gotePoints: gote,
    } satisfies Partial<AgreedJishogiPointLossGameResult>);
  });

  it.each(['proposal', 'decline', 'accept'] as const)('%sで盤面・持ち駒・手番・手数・全履歴を変更しない', (operation) => {
    const base = createJishogiState(24, 24, 'both', {
      moveNumber: 501,
      moveLimitJishogi: { kind: 'awaiting_continuous_check_end', checkingPlayer: 'gote' },
    });
    const state: BoardState = {
      ...base,
      lastMove: base.history[0] ?? null,
      foulHistory: [],
      positionHistory: base.positionHistory ? [...base.positionHistory] : [],
    };
    const snapshot = JSON.stringify(state);
    const proposalResult = proposeAgreedJishogi(state);
    expect(proposalResult.type).toBe('proposed');
    if (proposalResult.type !== 'proposed') return;
    const output = operation === 'proposal'
      ? proposalResult.state
      : respondToAgreedJishogiProposal(state, proposalResult.proposal, 'gote', operation === 'accept' ? 'accept' : 'reject').state;
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(output.squares).toBe(state.squares);
    expect(output.senteHand).toBe(state.senteHand);
    expect(output.goteHand).toBe(state.goteHand);
    expect(output.turn).toBe(state.turn);
    expect(output.moveNumber).toBe(state.moveNumber);
    expect(output.history).toBe(state.history);
    expect(output.lastMove).toBe(state.lastMove);
    expect(output.foulHistory).toBe(state.foulHistory);
    expect(output.positionHistory).toBe(state.positionHistory);
    if (operation === 'accept') expect(output.moveLimitJishogi).toBeNull();
    else expect(output.moveLimitJishogi).toBe(state.moveLimitJishogi);
  });

  it('終局済み結果を上書きせず、非対局状態も拒否する', () => {
    const oldResult = { winner: 'sente', loser: 'gote', endReason: 'checkmate' } satisfies GameResult;
    const ended = createJishogiState(24, 24, 'sente', { status: 'ended', result: oldResult });
    expect(proposeAgreedJishogi(ended)).toMatchObject({ type: 'rejected', state: ended, reason: 'game_already_ended' });
    expect(ended.result).toBe(oldResult);
    const preparing = createJishogiState(24, 24, 'sente', { status: 'preparation' });
    expect(proposeAgreedJishogi(preparing)).toMatchObject({ type: 'rejected', state: preparing, reason: 'agreed_jishogi_not_available' });
  });

  it('公開ドメインAPIから提案・応答・点数計算を利用できる', () => {
    expect(shogiDomain.proposeAgreedJishogi).toBe(proposeAgreedJishogi);
    expect(shogiDomain.respondToAgreedJishogiProposal).toBe(respondToAgreedJishogiProposal);
    expect(shogiDomain.calculateAgreedJishogiPoints).toBe(calculateAgreedJishogiPoints);
  });
});

describe('合意持将棋の二段階UI', () => {
  it('双方24点未満では提案不可理由を表示して提案を無効化する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createJishogiState(23, 23)} />);
    await user.click(screen.getByRole('button', { name: '持将棋を提案' }));
    const dialog = screen.getByRole('dialog', { name: '持将棋の提案を確認' });
    expect(within(dialog).getByText(/点数不足側を一意に確定できず提案できません/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '提案する' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
  });

  it('初期局面では理由・双方点数・予定結果を示して提案確定を無効化する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    await user.click(screen.getByRole('button', { name: '持将棋を提案' }));
    const dialog = screen.getByRole('dialog', { name: '持将棋の提案を確認' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'agreed-jishogi-dialog-title');
    expect(dialog).toHaveAttribute('aria-describedby');
    expect(within(dialog).getByText(/提案者です/)).toHaveTextContent('先手');
    expect(within(dialog).getAllByText('27点')).toHaveLength(2);
    expect(within(dialog).getByText(/双方24点以上のため無勝負/)).toBeInTheDocument();
    expect(within(dialog).getByText(/どちらも敵陣3段目以内に入っていません/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '提案する' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toHaveFocus();
  });

  it('提案後は相手を応答者として示し、拒否を初期フォーカスにする', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createJishogiState(24, 25)} />);
    await user.click(screen.getByRole('button', { name: '持将棋を提案' }));
    await user.click(screen.getByRole('button', { name: '提案する' }));
    const dialog = screen.getByRole('dialog', { name: '持将棋の提案へ応答' });
    expect(within(dialog).getByText(/応答者は後手/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '拒否する' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
  });

  it.each(['button', 'escape', 'backdrop'] as const)(
    '承諾が拒否された後も理由と提案を維持し、%sで閉じて再表示時にエラーを残さない',
    async (method) => {
      const user = userEvent.setup();
      const state = createJishogiState(24, 24);
      render(<ShogiResearchScreen initialState={state} />);
      const proposalButton = screen.getByRole('button', { name: '持将棋を提案' });
      await user.click(proposalButton);
      await user.click(screen.getByRole('button', { name: '提案する' }));

      state.senteHand[0].player = 'gote';
      const snapshotAfterExternalChange = JSON.stringify(state);
      await user.click(screen.getByRole('button', { name: '承諾する' }));

      const dialog = screen.getByRole('dialog', { name: '持将棋の提案へ応答' });
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        '提案時の局面と現在の局面が一致しません。'
      );
      expect(within(dialog).getByRole('button', { name: '承諾する' })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: '拒否する' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
      expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-move-number', '1');
      expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
      expect(JSON.stringify(state)).toBe(snapshotAfterExternalChange);
      expect(state.status).toBe('active');
      expect(state.result).toBeNull();

      if (method === 'button') {
        await user.click(within(dialog).getByRole('button', { name: '拒否する' }));
      } else if (method === 'escape') {
        await user.keyboard('{Escape}');
      } else {
        fireEvent.mouseDown(dialog.parentElement!);
      }
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(proposalButton).toHaveFocus();

      await user.click(proposalButton);
      expect(screen.getByRole('dialog', { name: '持将棋の提案を確認' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  );

  it.each(['button', 'escape', 'backdrop'] as const)('%sで拒否し、選択を維持して提案ボタンへ戻る', async (method) => {
    const user = userEvent.setup();
    const state = createInitialBoardState();
    const movingKing = state.squares[8][4].piece;
    state.squares[8][4].piece = null;
    state.squares[2][4].piece = movingKing;
    render(<ShogiResearchScreen initialState={state} />);
    const source = document.querySelector('[data-coordinate="7七"]') as HTMLElement;
    await user.click(source);
    const proposalButton = screen.getByRole('button', { name: '持将棋を提案' });
    await user.click(proposalButton);
    await user.click(screen.getByRole('button', { name: '提案する' }));
    if (method === 'button') await user.click(screen.getByRole('button', { name: '拒否する' }));
    if (method === 'escape') await user.keyboard('{Escape}');
    if (method === 'backdrop') fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
    expect(proposalButton).toHaveFocus();
    await user.click(document.querySelector('[data-coordinate="7六"]') as HTMLElement);
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '1');
  });

  it('キャンセルでは成立させず提案ボタンへフォーカスを戻す', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createJishogiState(24, 24)} />);
    const button = screen.getByRole('button', { name: '持将棋を提案' });
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('対局中');
  });

  it('両段階でTabとShift+Tabを循環し、承諾を初期選択にしない', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createJishogiState(24, 24)} />);
    await user.click(screen.getByRole('button', { name: '持将棋を提案' }));
    const cancel = screen.getByRole('button', { name: 'キャンセル' });
    const propose = screen.getByRole('button', { name: '提案する' });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(propose).toHaveFocus();
    await user.click(propose);
    const reject = screen.getByRole('button', { name: '拒否する' });
    const accept = screen.getByRole('button', { name: '承諾する' });
    expect(reject).toHaveFocus();
    await user.tab();
    expect(accept).toHaveFocus();
    await user.tab({ shift: true });
    expect(reject).toHaveFocus();
  });

  it('確認中・応答中は盤、駒台、全終局ボタンを停止しダイアログを排他にする', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createJishogiState(24, 24)} />);
    await user.click(screen.getByRole('button', { name: '持将棋を提案' }));
    for (const name of ['持将棋を提案', '入玉宣言', '投了']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(document.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'false');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '提案する' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'キャンセル' })).not.toBeInTheDocument();
  });

  it.each([
    [24, 25, '合意による持将棋・無勝負', '先手24点・後手25点'],
    [23, 24, '後手勝ち', '先手の点数不足'],
    [24, 23, '先手勝ち', '後手の点数不足'],
  ] as const)('先手%s点・後手%s点の承諾結果を表示して全操作を停止する', async (sente, gote, resultText, pointText) => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createJishogiState(sente, gote)} />);
    await user.click(screen.getByRole('button', { name: '持将棋を提案' }));
    await user.click(screen.getByRole('button', { name: '提案する' }));
    await user.click(screen.getByRole('button', { name: '承諾する' }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(resultText);
    expect(status).toHaveTextContent(pointText);
    expect(status).toHaveAttribute('aria-live', 'polite');
    for (const name of ['持将棋を提案', '入玉宣言', '投了']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(document.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);
    expect(document.getElementById('piece-stand-gote')).toHaveAttribute('data-active', 'false');
  });

  it('成り・投了・入玉宣言の各確認中は持将棋の重複確認を無効化する', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ShogiResearchScreen />);
    await user.click(screen.getByRole('button', { name: '投了' }));
    expect(screen.getByRole('button', { name: '持将棋を提案' })).toBeDisabled();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    unmount();

    render(<ShogiResearchScreen />);
    await user.click(screen.getByRole('button', { name: '入玉宣言' }));
    expect(screen.getByRole('button', { name: '持将棋を提案' })).toBeDisabled();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});
