import { handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest } from './timeLimitedIterativeDeepeningAlphaBetaWorkerHandler';
import { handleEvaluationPresetComparisonWorkerRequest } from './evaluationPresetComparisonWorkerHandler';
import type { EvaluationPresetComparisonWorkerRequest } from './evaluationPresetComparisonWorkerProtocol';
import type {
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest,
} from './timeLimitedIterativeDeepeningAlphaBetaWorkerProtocol';

self.addEventListener(
  'message',
  (event: MessageEvent<TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest | EvaluationPresetComparisonWorkerRequest>) => {
    const response = event.data.type === 'compare-evaluation-presets'
      ? handleEvaluationPresetComparisonWorkerRequest(event.data) :
      handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(event.data);
    self.postMessage(response);
  }
);
