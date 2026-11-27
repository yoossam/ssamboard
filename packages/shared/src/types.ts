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

export type BlockType = 'tasks' | 'events' | 'table' | 'memo' | 'ai_result' | 'notifications' | 'view';
export const BLOCK_TYPES: BlockType[] = ['tasks', 'events', 'table', 'memo', 'ai_result', 'notifications', 'view'];
export const BLOCK_LABEL: Record<BlockType, string> = {
  tasks: '할 일',
  events: '오늘 일정',
  table: '표',
  memo: '메모',
  ai_result: 'AI 결과',
  notifications: '알림',
  view: 'AI 화면',
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
  default: '기본', blue: '파랑', purple: '보라', pink: '분홍', red: '빨강', orange: '주황', green: '초록', teal: '청록',
};
export const titleColor = (v: unknown): TitleColor => ((TITLE_COLORS as readonly unknown[]).includes(v) ? (v as TitleColor) : 'default');
/** 메모가 아닌 블록의 바탕. 처음은 흰색. */
export const blockBg = (block: { type: string; config: Record<string, any> }): MemoColor =>
  block.type === 'memo' ? memoColor(block.config.color) : (MEMO_COLORS as readonly unknown[]).includes(block.config.bg) ? (block.config.bg as MemoColor) : 'white';

/** 보드 전체 바탕(boards.theme.bg). 색 값은 styles.css 의 [data-board-bg]. */
export const BOARD_BGS = ['gray', 'white', 'cream', 'mint', 'sky', 'lavender', 'peach', 'slate'] as const;
export type BoardBg = (typeof BOARD_BGS)[number];
export const BOARD_BG_LABEL: Record<BoardBg, string> = {
  gray: '기본', white: '흰색', cream: '크림', mint: '민트', sky: '하늘', lavender: '라벤더', peach: '복숭아', slate: '어두운 회색',
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
export interface BoardDto {
  id: string;
  name: string;
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
  status: 'proposed' | 'applied' | 'undone' | 'cancelled';
  steps: PlanStepView[];
  skipped?: string[];
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
  models: { id: string; label: string; input: number; output: number }[];
  api_keys: { provider: string; last4: string }[];
  /** 이번 달(사용자 시간대)의 예상 비용 */
  month_cost: number;
  usage: { month: string; cost_usd: number; input_tokens: number; output_tokens: number }[];
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
