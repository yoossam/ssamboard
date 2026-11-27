/** 외부 LLM에 보내기 전에 주민등록번호·카드번호 모양의 숫자를 가린다(5장 외부 LLM 전송 기준). */

const RRN = /(?<!\d)(\d{6})[-\s]?[1-4]\d{6}(?!\d)/g;
const CARD = /(?<!\d)(?:\d{4}[-\s]?){3}(\d{4})(?!\d)/g;

export function maskPii(text: string): string {
  return text.replace(RRN, '$1-*******').replace(CARD, '****-****-****-$1');
}

export function maskDeep<T>(value: T): T {
  if (typeof value === 'string') return maskPii(value) as unknown as T;
  if (Array.isArray(value)) return value.map(maskDeep) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskDeep(v);
    return out as T;
  }
  return value;
}
