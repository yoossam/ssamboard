/*
 * '수업 자료' 블록(2026-11-28 수업 보드 2단계): 수업에 쓸 링크를 모아 두고 수업 중 큰 단추로 하나씩 연다.
 * 종류는 주소 모양으로 정한다(가져오지 않는다 — 로그인해야 보이는 도구가 많고, 서버가 바깥을 부르지 않게).
 * 학생에게 보이기를 켠 항목만 공유 링크(학생용)에 나간다. 원본(캔바 등)의 '보기 권한'은 그 도구에서 따로 열어야 한다.
 */

// shared 는 DOM 타입 없이 묶는다 — URL 은 브라우저·Node 모두에 있다(필요한 것만 적는다)
declare const URL: new (s: string) => { protocol: string; hostname: string; pathname: string; username: string; password: string; searchParams: { get(name: string): string | null }; toString(): string };

export const LINK_KINDS = ['canva', 'slides', 'docs', 'sheets', 'forms', 'drive', 'youtube', 'tuilders', 'padlet', 'thinkerbell', 'kahoot', 'edunet', 'iscream', 'web'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  canva: '캔바',
  slides: '구글 슬라이드',
  docs: '구글 문서',
  sheets: '구글 시트',
  forms: '구글 설문',
  drive: '구글 드라이브',
  youtube: '유튜브',
  tuilders: '틸더스',
  padlet: '패들렛',
  thinkerbell: '띵커벨',
  kahoot: '카훗',
  edunet: '에듀넷',
  iscream: '아이스크림',
  web: '웹',
};

/** 한 블록에 담는 자료 수 */
export const LINKS_MAX = 30;

export interface LinkItem {
  /** 블록 안에서만 쓰는 짧은 id */
  id: string;
  title: string;
  url: string;
  kind: LinkKind;
  /** 학생용 공유 링크에 보일지 */
  student: boolean;
  /** 한 줄 메모(어디서 쓰는지 등) */
  note?: string;
}

const RULES: [RegExp, LinkKind][] = [
  [/(^|\.)canva\.(com|link)$/, 'canva'],
  [/^docs\.google\.com$/, 'docs'],
  [/^forms\.gle$/, 'forms'],
  [/^drive\.google\.com$/, 'drive'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'youtube'],
  [/(^|\.)tuilders\.com$/, 'tuilders'],
  [/(^|\.)padlet\.(com|org)$/, 'padlet'],
  [/(^|\.)tkbell\.co\.kr$/, 'thinkerbell'],
  [/(^|\.)kahoot\.(it|com)$/, 'kahoot'],
  [/(^|\.)edunet\.net$/, 'edunet'],
  [/(^|\.)i-scream\.co\.kr$/, 'iscream'],
];

/** https 주소만 받는다. 아니면 null */
export function cleanUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length > 2000) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function linkKindOf(url: string): LinkKind {
  let u: InstanceType<typeof URL>;
  try {
    u = new URL(url);
  } catch {
    return 'web';
  }
  const host = u.hostname.toLowerCase();
  for (const [re, kind] of RULES) {
    if (!re.test(host)) continue;
    if (kind !== 'docs') return kind;
    // docs.google.com/presentation|document|spreadsheets|forms
    if (u.pathname.startsWith('/presentation')) return 'slides';
    if (u.pathname.startsWith('/spreadsheets')) return 'sheets';
    if (u.pathname.startsWith('/forms')) return 'forms';
    return 'docs';
  }
  return 'web';
}

/** 제목이 없을 때 주소로 짓는다(종류 + 주소 끝 조각) */
export function titleFromUrl(url: string): string {
  const kind = linkKindOf(url);
  try {
    const u = new URL(url);
    if (kind !== 'web') return `${LINK_KIND_LABEL[kind]} 자료`;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '자료';
  }
}

const clean = (v: unknown, max: number): string =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, max)
    : '';

let seq = 0;
const newId = (): string => `l${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}`;

/**
 * 블록에 저장할 자료 목록으로 거른다. 잘못된 주소가 있으면 그 까닭을 돌려준다(AI·화면이 고치게).
 * id 가 없거나 겹치면 새로 매긴다.
 */
export function checkLinkItems(input: unknown): { ok: true; items: LinkItem[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'items 는 목록이어야 합니다.' };
  if (input.length > LINKS_MAX) return { ok: false, error: `수업 자료는 한 블록에 ${LINKS_MAX}개까지입니다.` };
  const seen = new Set<string>();
  const items: LinkItem[] = [];
  for (const [i, raw] of input.entries()) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const url = cleanUrl(r.url);
    if (!url) return { ok: false, error: `${i + 1}번 주소가 잘못됐습니다(https 로 시작하는 주소만 됩니다).` };
    let id = typeof r.id === 'string' && /^[a-z0-9]{1,24}$/.test(r.id) ? r.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    const item: LinkItem = { id, title: clean(r.title, 80) || titleFromUrl(url), url, kind: linkKindOf(url), student: r.student === true };
    const note = clean(r.note, 120);
    if (note) item.note = note;
    items.push(item);
  }
  return { ok: true, items };
}

/**
 * 학생에게 보낼 주소: 편집 주소를 보기 주소로 바꾼다(구글 문서·슬라이드·시트 /edit → /preview, 캔바 /edit → /view).
 * 바꿔도 원본의 공유 권한은 그대로다 — 학생이 열 수 있게 원본을 '링크가 있는 사람 보기'로 열어 두어야 한다.
 */
export function studentUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // 일부 공유 파일은 resourcekey 가 있어야 열린다 — 바꾼 주소에도 붙인다(코덱스 재검토)
    const rk = u.searchParams.get('resourcekey');
    const keep = (s: string) => (rk ? `${s}?resourcekey=${encodeURIComponent(rk)}` : s);
    if (host === 'docs.google.com') {
      // /document|presentation|spreadsheets|forms/(u/0/)d/<id>/… — 사용자 번호(u/0)가 끼어도
      const m = u.pathname.match(/^\/(document|presentation|spreadsheets|forms)\/(?:u\/\d+\/)?d\/(e\/)?([A-Za-z0-9_-]+)/);
      if (m) {
        if (m[1] === 'forms') return m[2] ? url : keep(`https://docs.google.com/forms/d/${m[3]}/viewform`);
        return keep(`https://docs.google.com/${m[1]}/d/${m[3]}/preview`);
      }
    }
    if (host === 'drive.google.com') {
      const m = u.pathname.match(/^\/file\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/);
      if (m) return keep(`https://drive.google.com/file/d/${m[1]}/view`);
    }
    if (/(^|\.)canva\.com$/.test(host)) {
      const m = u.pathname.match(/^\/design\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?\/(edit|view|watch|present)/);
      if (m) return `https://www.canva.com/design/${m[1]}/${m[2] ? `${m[2]}/` : ''}view`;
    }
    return url;
  } catch {
    return url;
  }
}

/** 화면이 읽은 목록과 지금 저장된 목록이 같은지 — 두 기기에서 동시에 고칠 때 덮어쓰지 않게(코덱스·제미나이 검토) */
export function linksSignature(items: unknown): string {
  if (!Array.isArray(items)) return '';
  return items
    .map((r) => {
      const i = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      return [i.id, i.url, i.title, i.student === true, i.note ?? ''].map(String).join('\u0001');
    })
    .join('\u0002');
}

/** 틸더스 추천 앱(서버가 tuilders.com 에서 받아 거른 모양) */
export interface TuildersApp {
  slug: string;
  title: string;
  tagline: string;
  url: string;
  reasons: string[];
  score: number;
  /** 틸더스가 마지막으로 열어 본 결과(down 이면 지금 안 열릴 수 있음) */
  down: boolean;
}
