import type { GameResult, Player } from '../../types/shogi';

export type GameResultTone = 'neutral' | 'amber' | 'sky' | 'rose';

export interface GameResultDisplay {
  panelText: string;
  statusText: string;
  tone: GameResultTone;
}

function getPlayerName(player: Player): '先手' | '後手' {
  return player === 'sente' ? '先手' : '後手';
}

function assertNever(value: never): never {
  throw new Error(`未対応の終局理由です: ${JSON.stringify(value)}`);
}

/**
 * Converts the discriminated GameResult union into the Japanese text shared by
 * the status badge and the read-only move-history panel.
 */
export function getGameResultDisplay(result: GameResult): GameResultDisplay {
  switch (result.endReason) {
    case 'repetition':
      return {
        panelText: '千日手（無勝負）',
        statusText: '千日手（無勝負）',
        tone: 'neutral',
      };
    case 'five_hundred_move_jishogi':
      return {
        panelText: '500手規定による持将棋・無勝負',
        statusText: '500手規定による持将棋・無勝負',
        tone: 'neutral',
      };
    case 'entering_king_draw':
      return {
        panelText: '入玉宣言による無勝負',
        statusText: '入玉宣言による無勝負',
        tone: 'amber',
      };
    case 'agreed_jishogi_draw': {
      const points = `先手${result.sentePoints}点・後手${result.gotePoints}点`;
      return {
        panelText: `合意による持将棋・無勝負（${points}）`,
        statusText: `合意による持将棋・無勝負（${points}）`,
        tone: 'sky',
      };
    }
    case 'entering_king_win': {
      const winner = getPlayerName(result.winner);
      return {
        panelText: `${winner}勝ち（入玉宣言）`,
        statusText: `${winner}勝ち（入玉宣言）`,
        tone: 'amber',
      };
    }
    case 'agreed_jishogi_point_loss': {
      const winner = getPlayerName(result.winner);
      const loser = getPlayerName(result.loser);
      const points = `先手${result.sentePoints}点・後手${result.gotePoints}点`;
      return {
        panelText: `${winner}勝ち（${loser}の点数不足・合意による持将棋、${points}）`,
        statusText: `${winner}勝ち（${loser}の点数不足・合意による持将棋、${points}）`,
        tone: 'sky',
      };
    }
    case 'entering_king_declaration_failure': {
      const winner = getPlayerName(result.winner);
      const loser = getPlayerName(result.loser);
      return {
        panelText: `${winner}勝ち（${loser}の入玉宣言失敗）`,
        statusText: `${loser}敗け（入玉宣言失敗）`,
        tone: 'rose',
      };
    }
    case 'foul_loss': {
      const winner = getPlayerName(result.winner);
      const loser = getPlayerName(result.loser);
      if (result.foulReason === 'perpetual_check_repetition') {
        return {
          panelText: `${winner}勝ち（${loser}反則負け・連続王手の千日手）`,
          statusText: `${loser}反則負け（連続王手の千日手）`,
          tone: 'rose',
        };
      }
      return {
        panelText: `${winner}勝ち（${loser}反則負け）`,
        statusText: `${winner}勝ち（${loser}反則負け）`,
        tone: 'rose',
      };
    }
    case 'checkmate': {
      const winner = getPlayerName(result.winner);
      return {
        panelText: `${winner}勝ち（詰み）`,
        statusText: `${winner}勝ち（詰み）`,
        tone: 'rose',
      };
    }
    case 'resignation': {
      const winner = getPlayerName(result.winner);
      const loser = getPlayerName(result.loser);
      return {
        panelText: `${winner}勝ち（${loser}投了）`,
        statusText: `${winner}勝ち（${loser}投了）`,
        tone: 'rose',
      };
    }
    default:
      return assertNever(result);
  }
}
