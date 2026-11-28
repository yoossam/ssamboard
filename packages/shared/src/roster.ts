/*
 * 명단 대조(2026-11-28 세 모델 토론 4번): 붙여 넣은 명단과 응답의 이름 칸을 견줘 미제출·중복·명단에 없는 응답을 가른다.
 * 학생 DB 를 만들지 않는다 — 명단은 화면(이 기기)에만 두고 서버·AI 로 보내지 않는다.
 * 맞추는 법: 띄어쓰기·번호(예: "12번", "3-2")를 떼고 같은 이름이면 맞음. 응답이 "3학년 2반 김민수"처럼 길면 명단 이름이 그 안에 하나만 있을 때 맞음.
 */

export interface RosterResult {
  /** 낸 사람(명단 순서) */
  submitted: string[];
  /** 안 낸 사람(명단 순서) */
  missing: string[];
  /** 두 번 이상 낸 사람과 횟수 */
  duplicates: { name: string; count: number }[];
  /** 명단의 누구와도 맞지 않는 응답 이름(오타·별명 등 — 사람이 확인) */
  unmatched: string[];
}

/** 명단 글 → 이름 목록(줄·쉼표·탭으로 나눔, 빈 것과 같은 이름 겹침은 뺀다) */
export function parseRoster(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,\t;]+/)) {
    const name = raw.trim();
    const key = normName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, 500);
}

/** 비교용 이름: 번호·학년반 표시·띄어쓰기·기호를 뗀다 */
export function normName(s: string): string {
  return s
    .replace(/\d+\s*(학년|반|번)/g, '')
    .replace(/[0-9\s\-_.()[\]#·:]/g, '')
    .toLowerCase();
}

export function compareRoster(roster: string[], answers: (string | null | undefined)[]): RosterResult {
  const keys = roster.map(normName);
  const counts = new Map<number, number>();
  const unmatched: string[] = [];
  for (const a of answers) {
    const v = normName(String(a ?? ''));
    if (!v) continue;
    let hit = keys.indexOf(v);
    if (hit < 0) {
      const inside = keys.map((k, i) => (k.length >= 2 && v.includes(k) ? i : -1)).filter((i) => i >= 0);
      if (inside.length === 1) hit = inside[0];
    }
    if (hit < 0) unmatched.push(String(a).trim());
    else counts.set(hit, (counts.get(hit) ?? 0) + 1);
  }
  return {
    submitted: roster.filter((_, i) => counts.has(i)),
    missing: roster.filter((_, i) => !counts.has(i)),
    duplicates: roster.flatMap((name, i) => ((counts.get(i) ?? 0) > 1 ? [{ name, count: counts.get(i)! }] : [])),
    unmatched,
  };
}
