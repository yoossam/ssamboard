import type { LlmUsage } from './adapter';

/**
 * 설정에서 고를 수 있는 모델과 가격(USD, 백만 토큰당 기본 요금).
 * Claude 는 2026-11-25에 https://platform.claude.com/docs/en/models/overview, GPT 는 2026-11-28에 OpenAI 문서에서 확인한 값이다.
 * Haiku 5.5는 문서에 "From $0.10 / $0.50"으로 적혀 있어 시작 가격을 넣었다.
 * 가격이 바뀌면 이 표만 고치면 된다. 비용 한도(USR-5)는 이 표로 계산한 예상(추정) 비용을 쓴다.
 * 캐시(2026-11-28 확인 — platform.claude.com/docs/en/about-claude/pricing, developers.openai.com/api/docs/pricing):
 * cacheRead = 캐시 읽기, cacheWrite = Claude 5분 캐시 저장(입력의 1.25배). GPT 는 저장 요금이 없다.
 * 실제 청구와 다를 수 있는 것: Haiku 5.5 의 10만 토큰 넘는 요청(5배), 세금·환율, 끊긴 요청.
 */
export const MODELS: { id: string; provider: string; label: string; input: number; output: number; cacheRead: number; cacheWrite: number }[] = [
  { id: 'claude-haiku-5-5', provider: 'anthropic', label: 'Claude Haiku 5.5 · 가장 빠름', input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  { id: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Claude Sonnet 5.5 · 균형', input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  { id: 'claude-opus-5-5', provider: 'anthropic', label: 'Claude Opus 5.5', input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  { id: 'claude-fable-5-2', provider: 'anthropic', label: 'Claude Fable 5.2', input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
  // GPT(OpenAI) — 2026-11-28 developers.openai.com/api/docs/pricing 에서 확인한 값(짧은 문맥 ≤27만 토큰).
  { id: 'gpt-6-luna', provider: 'openai', label: 'GPT-6 Luna · 가장 빠름', input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0 },
  { id: 'gpt-6.2-sol', provider: 'openai', label: 'GPT-6.2 Sol · 균형', input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
  { id: 'gpt-6.2-astra', provider: 'openai', label: 'GPT-6.2 Astra', input: 8, output: 40, cacheRead: 0.4, cacheWrite: 0 },
];

/** 제공자 이름(화면·안내용) */
export const PROVIDERS: { id: string; label: string; keyHint: string }[] = [
  { id: 'anthropic', label: 'Claude', keyHint: 'sk-ant-…' },
  { id: 'openai', label: 'GPT(OpenAI)', keyHint: 'sk-…' },
];

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export function costUsd(model: string, usage: LlmUsage): number {
  const m = MODELS.find((x) => x.id === model);
  if (!m) return 0;
  return (usage.input_tokens * m.input + usage.output_tokens * m.output + (usage.cache_read_tokens ?? 0) * m.cacheRead + (usage.cache_write_tokens ?? 0) * m.cacheWrite) / 1_000_000;
}
