import type { LlmUsage } from './adapter';

/**
 * 설정에서 고를 수 있는 모델과 가격(USD, 백만 토큰당 기본 요금).
 * 2026-11-25에 https://platform.claude.com/docs/en/models/overview 에서 확인한 값이다.
 * Haiku 5.5는 문서에 "From $0.10 / $0.50"으로 적혀 있어 시작 가격을 넣었다.
 * 가격이 바뀌면 이 표만 고치면 된다. 비용 한도(USR-5)는 이 표로 계산한 예상 비용을 쓴다.
 */
export const MODELS: { id: string; provider: string; label: string; input: number; output: number }[] = [
  { id: 'claude-haiku-5-5', provider: 'anthropic', label: 'Claude Haiku 5.5 · 가장 빠름', input: 0.1, output: 0.5 },
  { id: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Claude Sonnet 5.5 · 균형', input: 2, output: 10 },
  { id: 'claude-opus-5-5', provider: 'anthropic', label: 'Claude Opus 5.5', input: 4, output: 20 },
  { id: 'claude-fable-5-2', provider: 'anthropic', label: 'Claude Fable 5.2', input: 8, output: 40 },
];

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export function costUsd(model: string, usage: LlmUsage): number {
  const m = MODELS.find((x) => x.id === model);
  if (!m) return 0;
  return (usage.input_tokens * m.input + usage.output_tokens * m.output) / 1_000_000;
}
