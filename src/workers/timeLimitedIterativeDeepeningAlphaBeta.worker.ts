import { handleTimeLimitedQuiescenceComparisonWorkerRequest } from './timeLimitedQuiescenceComparisonWorkerHandler';
import type { TimeLimitedQuiescenceComparisonWorkerRequest } from './timeLimitedQuiescenceComparisonWorkerProtocol';
import { handleQuiescenceComparisonWorkerRequest } from './quiescenceComparisonWorkerHandler';
import type { QuiescenceComparisonWorkerRequest } from './quiescenceComparisonWorkerProtocol';
import { handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest } from './timeLimitedIterativeDeepeningAlphaBetaWorkerHandler';
import { handleEvaluationPresetComparisonWorkerRequest } from './evaluationPresetComparisonWorkerHandler';
import type { EvaluationPresetComparisonWorkerRequest } from './evaluationPresetComparisonWorkerProtocol';
import type {
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest,
} from './timeLimitedIterativeDeepeningAlphaBetaWorkerProtocol';

self.addEventListener(
  'message',
  (event: MessageEvent<TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest | EvaluationPresetComparisonWorkerRequest | QuiescenceComparisonWorkerRequest | TimeLimitedQuiescenceComparisonWorkerRequest>) => {
    switch (event.data.type) {
      case 'compare-time-limited-quiescence-settings':
        self.postMessage(handleTimeLimitedQuiescenceComparisonWorkerRequest(event.data));
        break;
      case 'compare-evaluation-presets':
        self.postMessage(handleEvaluationPresetComparisonWorkerRequest(event.data));
        break;
      case 'compare-quiescence-settings':
        self.postMessage(handleQuiescenceComparisonWorkerRequest(event.data));
        break;
      case 'run-time-limited-iterative-deepening-alpha-beta-search':
        self.postMessage(handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(event.data));
        break;
    }
  }
);
