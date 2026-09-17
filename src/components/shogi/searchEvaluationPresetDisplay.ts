import type { SearchEvaluationPresetId } from '../../domain/shogi/searchEvaluationPresets';

export const SEARCH_EVALUATION_PRESET_DISPLAY = {
  standard: { name: '標準', description: '現在の基本評価を使用します。' },
  'material-focused': { name: '駒得重視', description: '駒の損得を優先して評価します。' },
  'king-safety-focused': { name: '玉の安全重視', description: '王手圧力と玉周辺の安全を強く評価します。' },
} satisfies Record<SearchEvaluationPresetId, { name: string; description: string }>;
