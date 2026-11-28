// 서버와 화면이 함께 쓰는 타입. 데이터는 제공자(LLM)와 무관한 형식으로 둔다(LLM-10).

export type ColumnType = 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'select' | 'url';
export const COLUMN_TYPES: ColumnType[] = ['text', 'number', 'date', 'datetime', 'boolean', 'select', 'url'];
export const COLUMN_TYPE_LABEL: Record<ColumnType, string> = {
  text: '글자',
  number: '숫자',
  date: '날짜',
  datetime: '날짜·시간',
  boolean: '예/아니오',
  select: '선택',
  url: '링크',
};

/** 컬럼 ID는 한번 정해지면 바뀌지 않는다(LLM-13, QRY-1). */
export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  options?: string[];
}
export interface TableSchema {
  columns: Column[];
}

/** menu(2026-11-28): 내 메뉴를 이름 단추로 모은 블록 — 보드에 하나 있으면 위쪽 바로가기 줄은 숨긴다. */
export type BlockType = 'tasks' | 'events' | 'table' | 'memo' | 'ai_result' | 'notifications' | 'view' | 'menu' | 'quiz' | 'links';
/** quiz(2026-11-28): 즉석 퀴즈 하나(QR·응답 수·문항별 막대). config.quiz_id. AI 의 create_quiz 가 만들고, 사람이 '블록 추가'로 놓지는 않는다. */
export const BLOCK_TYPES: BlockType[] = ['tasks', 'events', 'table', 'memo', 'ai_result', 'notifications', 'view', 'menu', 'quiz', 'links'];
export const BLOCK_LABEL: Record<BlockType, string> = {
  tasks: '할 일',
  events: '오늘 일정',
  table: '표',
  memo: '메모',
  ai_result: 'AI 결과',
  notifications: '알림',
  view: 'AI 화면',
  menu: '내 메뉴',
  quiz: '퀴즈',
  links: '수업 자료',
};

export interface GridPos {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** 24열 격자 기준 기본 크기. 화면 높이를 16줄로 나누므로 h=8 이 화면의 절반쯤이다. */
export const DEFAULT_BLOCK_SIZE: Record<BlockType, { w: number; h: number }> = {
  tasks: { w: 8, h: 8 },
  events: { w: 8, h: 8 },
  notifications: { w: 8, h: 8 },
  table: { w: 12, h: 8 },
  ai_result: { w: 6, h: 8 },
  memo: { w: 5, h: 6 },
  view: { w: 8, h: 8 },
  menu: { w: 6, h: 4 },
  quiz: { w: 10, h: 9 },
  links: { w: 8, h: 7 },
};
/** 줄일 수 있는 가장 작은 크기. 메모는 붙임쪽지처럼 작게도 쓴다. */
export const MIN_BLOCK_SIZE: Record<BlockType, { w: number; h: number }> = {
  tasks: { w: 4, h: 4 },
  events: { w: 4, h: 4 },
  notifications: { w: 4, h: 4 },
  table: { w: 4, h: 4 },
  ai_result: { w: 4, h: 4 },
  memo: { w: 2, h: 2 },
  view: { w: 4, h: 4 },
  menu: { w: 3, h: 2 },
  quiz: { w: 5, h: 5 },
  links: { w: 4, h: 3 },
};

/** 메모(붙임쪽지) 색 이름. 실제 색 값은 화면의 styles.css 에 있다. 블록 config.color 에 담는다. */
export const MEMO_COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'orange', 'white'] as const;
export type MemoColor = (typeof MEMO_COLORS)[number];
export const MEMO_COLOR_LABEL: Record<MemoColor, string> = { yellow: '노랑', pink: '분홍', green: '초록', blue: '파랑', purple: '보라', orange: '주황', white: '하양' };
export const DEFAULT_MEMO_COLOR: MemoColor = 'yellow';
/** 저장된 값이 없거나 모르는 색이면 기본색으로 본다. */
export const memoColor = (v: unknown): MemoColor => ((MEMO_COLORS as readonly unknown[]).includes(v) ? (v as MemoColor) : DEFAULT_MEMO_COLOR);

/**
 * 블록 꾸미기(2026-11-27 "제목 색깔, 배경 색깔 수정"). 바탕은 메모 종이 색과 같은 이름을 쓴다(색 값은 styles.css 의 [data-memo]).
 * config.bg(바탕), config.title_color(제목 글자색). 메모는 config.color 가 바탕이다(옛 값 그대로).
 */
export const TITLE_COLORS = ['default', 'blue', 'purple', 'pink', 'red', 'orange', 'green', 'teal'] as const;
export type TitleColor = (typeof TITLE_COLORS)[number];
export const TITLE_COLOR_LABEL: Record<TitleColor, string> = {
  default: '기본',
  blue: '파랑',
  purple: '보라',
  pink: '분홍',
  red: '빨강',
  orange: '주황',
  green: '초록',
  teal: '청록',
};
export const titleColor = (v: unknown): TitleColor => ((TITLE_COLORS as readonly unknown[]).includes(v) ? (v as TitleColor) : 'default');
/** 메모가 아닌 블록의 바탕. 처음은 흰색. */
export const blockBg = (block: { type: string; config: Record<string, any> }): MemoColor =>
  block.type === 'memo' ? memoColor(block.config.color) : (MEMO_COLORS as readonly unknown[]).includes(block.config.bg) ? (block.config.bg as MemoColor) : 'white';

/**
 * 마음대로 고른 색(2026-11-28 선생님 "블록 색깔도 자유자재로"): '#rrggbb'. 바탕(config.bg·메모 config.color)과 제목(config.title_color)에.
 * 정해 둔 이름(MEMO_COLORS·TITLE_COLORS)도 그대로 받는다. 어두운 바탕이면 글자를 밝게 바꿔 읽히게 한다.
 */
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) =>
  `#${c
    .map((x) =>
      Math.round(Math.max(0, Math.min(255, x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
/** 상대 밝기(0~1, WCAG) */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** 블록을 칠하는 법: data-memo 이름(정해 둔 색) 또는 CSS 변수(고른 색). paper 면 종이 바탕 클래스를 쓴다. */
export function paintOf(block: { type: string; config: Record<string, any> }): { memo?: string; paper: boolean; dark?: boolean; style?: Record<string, string> } {
  const raw = block.type === 'memo' ? block.config.color : block.config.bg;
  if (isHexColor(raw)) {
    const dark = luminance(raw) < 0.22;
    const bar = toHex(rgb(raw).map((v) => (dark ? v + (255 - v) * 0.18 : v * 0.86)));
    return {
      memo: 'custom',
      paper: true,
      dark,
      style: {
        '--memo-bg': raw,
        '--memo-bar': bar,
        ...(dark ? { '--color-ink': '#ffffff', '--color-sub': 'rgba(255,255,255,0.78)', '--color-rule': 'rgba(255,255,255,0.22)', '--color-accent': '#ffe28a' } : {}),
      },
    };
  }
  const name = block.type === 'memo' ? memoColor(raw) : blockBg(block);
  const paper = block.type === 'memo' || name !== 'white';
  return { memo: paper ? name : undefined, paper };
}
/** 제목 글자색: 정해 둔 이름이면 data-title-color, 고른 색이면 style */
export function titlePaint(v: unknown): { attr?: TitleColor; style?: { color: string } } {
  return isHexColor(v) ? { style: { color: v } } : { attr: titleColor(v) };
}

/** 보드 전체 바탕(boards.theme.bg). 색 값은 styles.css 의 [data-board-bg]. */
export const BOARD_BGS = ['gray', 'white', 'cream', 'mint', 'sky', 'lavender', 'peach', 'slate'] as const;
export type BoardBg = (typeof BOARD_BGS)[number];
export const BOARD_BG_LABEL: Record<BoardBg, string> = {
  gray: '기본',
  white: '흰색',
  cream: '크림',
  mint: '민트',
  sky: '하늘',
  lavender: '라벤더',
  peach: '복숭아',
  slate: '어두운 회색',
};
export const boardBg = (v: unknown): BoardBg => ((BOARD_BGS as readonly unknown[]).includes(v) ? (v as BoardBg) : 'gray');
export interface BoardTheme {
  bg?: BoardBg;
}

export interface BlockDto {
  id: string;
  type: BlockType;
  title: string;
  layout_lg: GridPos;
  layout_sm: { order: number } | null;
  pinned: boolean;
  config: Record<string, any>;
  source_table_id: string | null;
}
/**
 * 두 보드(2026-11-28 선생님): 업무 보드와 수업 보드. 어느 보드를 보는지는 기기마다(화면이 X-Board 머리글로 보낸다 — 세 모델 합의:
 * 교실 TV 에 수업 보드를 띄운 채 휴대폰으로 업무 보드를 봐도 TV 가 바뀌지 않게).
 */
export const BOARD_KINDS = ['work', 'class'] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];
export const BOARD_KIND_LABEL: Record<BoardKind, string> = { work: '업무', class: '수업' };
export const boardKindOf = (v: unknown): BoardKind => (v === 'class' ? 'class' : 'work');

export interface BoardDto {
  id: string;
  name: string;
  kind: BoardKind;
  /** 보드 꾸미기(바탕색) */
  theme: BoardTheme;
  blocks: BlockDto[];
}

export interface TaskDto {
  id: string;
  title: string;
  due_at: string | null;
  status: 'open' | 'done';
  /** 자세한 내용. 기존 자비스에서 옮긴 프로젝트의 설명과 진행 기록이 여기 들어 있다. */
  note: string;
}
export interface EventDto {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
}

export type Priority = 'urgent' | 'normal' | 'info';
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: '급함', normal: '일반', info: '참고' };
export interface NotificationDto {
  id: string;
  source: string;
  title: string;
  body: string;
  priority: Priority;
  status: 'unread' | 'read' | 'archived';
  count: number;
  last_seen_at: string;
  created_at: string;
}

export interface TableDto {
  id: string;
  name: string;
  schema: TableSchema;
  origin: 'llm' | 'upload' | 'sheet' | 'manual' | 'form';
  row_count: number;
  llm_excluded: boolean;
  linked: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  /** 설문 응답을 모으는 표일 때만 있다. */
  form: TableForm | null;
}
/** 표에 이어진 Google 설문지. responder_uri 가 바깥에 보내는 응답 주소다. */
export interface TableForm {
  title: string;
  responder_uri: string;
  edit_uri: string;
  /** 링크만 있으면 누구나 응답할 수 있는지(열지 못했으면 false — 설문지에서 직접 열어야 한다) */
  public_link: boolean;
}
export interface RowDto {
  id: string;
  values: Record<string, string | number | boolean | null>;
  raw: Record<string, string> | null;
}
export interface RowPage {
  rows: RowDto[];
  total: number;
  page: number;
  size: number;
}
export interface QueryResult {
  columns: { key: string; label: string; type: string }[];
  rows: (string | number | boolean | null)[][];
}

/** 표를 만들기 전 미리보기(LLM-4). 원문과 나란히 보여 준다. */
export interface TablePreview {
  name: string;
  columns: { name: string; type: ColumnType }[];
  rows: (string | null)[][];
  total: number;
}
export interface PlanStepView {
  index: number;
  tool: string;
  title: string;
  detail: string;
  preview?: TablePreview;
}
export interface CommandDto {
  id: string;
  /** applying = 반영했고 바깥 일(공유 링크)을 마저 하는 중 — 끝나면 applied */
  status: 'proposed' | 'applying' | 'applied' | 'undone' | 'cancelled';
  steps: PlanStepView[];
  skipped?: string[];
  /** 승인해서 만든 파일(AI 가 고친 엑셀·한글) — 내려받기. expires_at 이 지나면(하루) 지워진다 */
  files?: { id: string; name: string; expires_at?: string | null; gone?: boolean }[];
  /** 처리 결과함(2026-11-28 세 모델 UX 토론 A·J) */
  created_at?: string;
  applied_at?: string | null;
  /** 바뀐 곳 — 화면이 이 항목을 보여 주는 블록을 찾아 강조한다 */
  touched?: { entity: string; id: string }[];
  /** 이 처리로 만든 공유 링크 */
  shares?: { id: string; title: string; url: string; revoked: boolean }[];
  /** 지금 되돌릴 수 있는지(가장 최근에 적용한 것만) */
  undoable?: boolean;
}

export interface AuthStatus {
  authenticated: boolean;
  /** 로그인 전 화면이 쓴다: 'password' 면 이메일·암호 칸, 'google' 이면 Google 단추. */
  login_mode?: 'password' | 'google';
  /** 암호 방식에서 아직 주인 계정이 없으면 참 — 설치 코드로 처음 계정을 만든다. */
  setup_needed?: boolean;
  locked?: boolean;
  pin_set?: boolean;
  lock_minutes?: number;
  seconds_left?: number | null;
  attempts_left?: number;
  pin_locked_until?: string | null;
  user?: { email: string; name: string; timezone: string };
}

export interface SessionDto {
  id: string;
  device_name: string;
  last_active_at: string;
  created_at: string;
  current: boolean;
  locked: boolean;
}

export interface SettingsDto {
  timezone: string;
  monthly_budget: number;
  llm_provider: string;
  llm_model: string;
  lock_minutes: number;
  models: { id: string; provider: string; label: string; input: number; output: number }[];
  providers: { id: string; label: string; keyHint: string }[];
  api_keys: { provider: string; last4: string }[];
  /** 이번 달(사용자 시간대)의 예상 비용 */
  month_cost: number;
  usage: { month: string; cost_usd: number; input_tokens: number; output_tokens: number }[];
  /** 처음 접속 안내(AI 열쇠 → 고치는 법 → 메뉴 추천)를 마쳤거나 건너뛰었는지 */
  onboarded: boolean;
}

export interface ConnectorDto {
  id: string;
  type: 'google_sheets' | 'webhook';
  name: string;
  status: string;
  scopes: string[];
  last_synced_at: string | null;
  last_error: string | null;
}

export interface TrashItem {
  kind: 'blocks' | 'data_tables' | 'data_rows' | 'tasks' | 'events';
  id: string;
  title: string;
  deleted_at: string;
}

/** AI 창이 받는 스트림 이벤트(/api/ai/messages). */
export type AiStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; label: string }
  /** AI 가 화면에서 창을 연다(open_screen) — 바꾸는 것이 없어 승인 없이 */
  | { type: 'open'; target: string; id?: string }
  | { type: 'plan'; command: CommandDto }
  | { type: 'error'; message: string }
  | { type: 'done'; conversation_id: string };

export const LOCK_MINUTE_OPTIONS = [1, 5, 10, 30, 60, 0];
export const PIN_LENGTH = 6;
/** 암호 로그인(배포판)의 가장 짧은 암호 길이. 서버와 화면이 함께 쓴다. */
export const PASSWORD_MIN_LENGTH = 10;
export const PIN_MAX_FAILS = 5;
export const PIN_LOCKOUT_MINUTES = 15;
export const TRASH_DAYS = 30;
export const MAX_UPDATE_ROWS = 1000;
export const MAX_EXTRACT_ROWS = 200;
export const MAX_COLUMNS = 50;
export const MAX_TABLE_ROWS = 100_000;
