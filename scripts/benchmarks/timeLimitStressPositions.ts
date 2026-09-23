import { createInitialBoardState, type BoardState } from '../../src/types/shogi';
import { areLegalActionsEqual } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import { executeLegalAction, getLegalActions, type LegalAction } from '../../src/domain/shogi/legalActions';
import { QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS } from './quiescenceOrderingSelfPlayScenarios';
import selfPlayActions from './fixtures/self-play-99-actions.json';

export interface TimeLimitStressPosition {
  readonly id: string;
  readonly origin: 'saved-self-play' | 'deterministic-legal-playout' | 'existing-composed-position' | 'existing-book-line';
  readonly provenance: string;
  readonly reproduction: string;
  readonly expectedHistoryPly: number;
  readonly create: () => BoardState;
}

function applyExactlyOne(state: BoardState, action: LegalAction, id: string, ply: number): BoardState {
  const matches = getLegalActions(state).filter((legal) => areLegalActionsEqual(legal, action));
  if (matches.length !== 1) throw new Error(`${id} ply ${ply}: expected one matching legal action, found ${matches.length}`);
  const result = executeLegalAction(state, matches[0], { proposer: 'local_ai' });
  if (result.type !== 'applied') throw new Error(`${id} ply ${ply}: legal action was rejected (${result.type})`);
  return result.state;
}

function replaySavedSelfPlay(plies: number): BoardState {
  const id = `saved-self-play-${plies}`;
  const actions = selfPlayActions as LegalAction[];
  if (actions.length !== 99 || plies > actions.length) throw new Error(`${id}: saved game has an unexpected length`);
  let state = createInitialBoardState();
  state.recordId = 'time-limit-stress-saved-self-play';
  for (let index = 0; index < plies; index += 1) {
    state = applyExactlyOne(state, actions[index], id, index + 1);
  }
  return state;
}

/** Xorshift32 chooses only from current legal actions; no history is synthesized. */
function replayDeterministicPlayout(plies: number): BoardState {
  const id = `seed-1-legal-playout-${plies}`;
  let state = createInitialBoardState();
  state.recordId = 'time-limit-stress-seed-1-playout';
  let random = 1;
  for (let ply = 1; ply <= plies; ply += 1) {
    const actions = getLegalActions(state);
    if (state.status === 'ended' || actions.length === 0) {
      throw new Error(`${id}: game ended at ${ply - 1} plies before requested ${plies}`);
    }
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    const result = executeLegalAction(state, actions[(random >>> 0) % actions.length], { proposer: 'local_ai' });
    if (result.type !== 'applied') throw new Error(`${id} ply ${ply}: generated legal action was rejected (${result.type})`);
    state = result.state;
  }
  return state;
}

function existingScenario(id: string): BoardState {
  const scenario = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.find((item) => item.id === id);
  if (!scenario) throw new Error(`Missing existing scenario: ${id}`);
  return scenario.create();
}

export const TIME_LIMIT_STRESS_POSITIONS: readonly TimeLimitStressPosition[] = Object.freeze([
  {
    id: 'saved-self-play-50', origin: 'saved-self-play', expectedHistoryPly: 50,
    provenance: 'docs/quiescence-ordering-self-play-output.txt の最初の RECORD（pair 1/game 1、99手で終局）から抽出した合法着手列。',
    reproduction: 'scripts/benchmarks/fixtures/self-play-99-actions.json の先頭50手を平手から意味的に照合して再生。',
    create: () => replaySavedSelfPlay(50),
  },
  {
    id: 'saved-self-play-98', origin: 'saved-self-play', expectedHistoryPly: 98,
    provenance: '同じ保存済み実対局の最終手直前。99手目で終局するため98手を採用。',
    reproduction: '同じ着手列の先頭98手を平手から意味的に照合して再生。',
    create: () => replaySavedSelfPlay(98),
  },
  {
    id: 'seed-1-legal-playout-150', origin: 'deterministic-legal-playout', expectedHistoryPly: 150,
    provenance: '実戦棋譜ではない。平手から合法手を選ぶ seed=1 の決定的擬似乱数対局。履歴を直接水増ししない。',
    reproduction: '各手の getLegalActions() の配列から xorshift32(seed=1) の符号なし値 % 合法手数で選び、executeLegalAction() で150手再生。',
    create: () => replayDeterministicPlayout(150),
  },
  {
    id: 'rook-pawn-recapture-middlegame', origin: 'existing-book-line', expectedHistoryPly: 10,
    provenance: '既存の固定10手手順。実戦棋譜ではない。歩交換と飛車による取り返しを含む駒の多い中盤。',
    reproduction: 'quiescenceOrderingSelfPlayScenarios.ts の同名シナリオを公開合法手APIで再生。',
    create: () => existingScenario('rook-pawn-recapture-middlegame'),
  },
  {
    id: 'check-evasion-endgame', origin: 'existing-composed-position', expectedHistoryPly: 0,
    provenance: '既存の研究用構成局面。実戦棋譜ではない。後手玉への飛車王手と王手回避を含む。',
    reproduction: 'quiescenceOrderingSelfPlayScenarios.ts の同名シナリオを正規化して生成。',
    create: () => existingScenario('check-evasion-endgame'),
  },
]);
