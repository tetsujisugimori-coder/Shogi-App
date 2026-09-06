import {
  addGameRecordSessionBranch,
  createGameRecordSession,
  executeMove,
  executeResignation,
  storeGameRecordSessionState,
  type GameRecordSession,
} from '../../../domain/shogi';
import { createInitialBoardState, type BoardState } from '../../../types/shogi';

function applyMove(
  state: BoardState,
  from: { row: number; col: number },
  to: { row: number; col: number }
): BoardState {
  const result = executeMove(state, from, to);
  if (result.type !== 'applied') throw new Error('JSON exchange fixture move failed');
  return result.state;
}

/** 本譜だけを含む、数手進行した通常対局の生成fixture。 */
export function createMainlineOnlySessionFixture(): GameRecordSession {
  let state = createInitialBoardState();
  state = { ...state, recordId: 'fixture-mainline-v1' };
  state = applyMove(state, { row: 6, col: 2 }, { row: 5, col: 2 });
  state = applyMove(state, { row: 2, col: 6 }, { row: 3, col: 6 });
  state = applyMove(state, { row: 6, col: 3 }, { row: 5, col: 3 });
  return createGameRecordSession(state);
}

/** 本譜と兄弟ではない1件の分岐だけを含む生成fixture。 */
export function createSingleBranchSessionFixture(): GameRecordSession {
  const mainline = createMainlineOnlySessionFixture().mainline;
  const started = addGameRecordSessionBranch(createGameRecordSession(mainline), mainline, 2);
  if (!started.ok || !started.boardState) throw new Error('JSON exchange fixture branch failed');
  const branch = applyMove(started.boardState, { row: 6, col: 3 }, { row: 5, col: 3 });
  return storeGameRecordSessionState(started.session, branch);
}

/** result を持ち、status が ended の投了局を含む生成fixture。 */
export function createEndedSessionFixture(): GameRecordSession {
  const source = createMainlineOnlySessionFixture();
  const resigned = executeResignation(source.mainline);
  if (resigned.type !== 'applied') throw new Error('JSON exchange fixture resignation failed');
  return createGameRecordSession(resigned.state);
}
