import { handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest } from './timeLimitedIterativeDeepeningAlphaBetaWorkerHandler';
import type {
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest,
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse,
} from './timeLimitedIterativeDeepeningAlphaBetaWorkerProtocol';

self.addEventListener(
  'message',
  (event: MessageEvent<TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest>) => {
    const response: TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse =
      handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(event.data);
    self.postMessage(response);
  }
);
