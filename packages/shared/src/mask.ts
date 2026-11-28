/** 외부 LLM에 보내기 전에 주민등록번호·카드번호 모양의 숫자를 가린다(5장 외부 LLM 전송 기준). */

// 뒷자리 첫 글자 1~4 주민등록번호, 5~8 외국인등록번호(다문화 학생 — 제미나이 검토)
const RRN = /(?<!\d)(\d{6})[-\s]?[1-8]\d{6}(?!\d)/g;
const CARD = /(?<!\d)(?:\d{4}[-\s]?){3}(\d{4})(?!\d)/g;

export function maskPii(text: string): string {
  return text.replace(RRN, '$1-*******').replace(CARD, '****-****-****-$1');
}

export function maskDeep<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === 'string') return maskPii(value) as unknown as T;
  // 날짜는 그대로, 같은 물건을 다시 만나면(순환) 멈춘다
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    if (seen.has(value)) return undefined as T;
    seen.add(value);
    try {
      if (Array.isArray(value)) return value.map((v) => maskDeep(v, seen)) as unknown as T;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskDeep(v, seen);
      return out as T;
    } finally {
      seen.delete(value); // 지금 걷는 길에서만 — 여러 곳에서 같은 물건을 가리키는 것은 괜찮다
    }
  }
  return value;
}
