/*
 * 내 메뉴(2026-11-28) — 위쪽 바로가기 줄의 메뉴. AI 가 사용자 말을 정리해 이 '틀'에 맞춰 추천하고, 사용자가 고르면 만든다.
 * 메뉴는 코드가 아니라 자료다: 이름·아이콘·설명 + 정해진 동작 하나. 새 동작이 필요하면 여기와 화면(TopBar)·서버 검사(menus/menu-spec.ts)를 함께 늘린다.
 */
import type { ColumnType } from './types';

/** 메뉴가 할 수 있는 동작 — 이 밖의 것은 만들 수 없다. */
export type MenuAction =
  /** AI 창을 열고 정해 둔 말을 보낸다(바꾸는 일은 여느 때처럼 계획 → 승인). */
  | { type: 'ask_ai'; prompt: string }
  /** 표를 연다. */
  | { type: 'open_table'; table_id: string }
  /** 표에 한 줄 넣는 칸을 바로 연다. */
  | { type: 'add_row'; table_id: string }
  /** 바깥 주소(https)를 새 탭으로. */
  | { type: 'link'; url: string }
  /** 앱 안 화면을 연다. */
  | { type: 'open_panel'; panel: MenuPanel };

export const MENU_ACTION_TYPES = ['ask_ai', 'open_table', 'add_row', 'link', 'open_panel'] as const;
export const MENU_PANELS = ['notifications', 'tables', 'upload', 'trash', 'add-block', 'settings'] as const;
export type MenuPanel = (typeof MENU_PANELS)[number];
export const MENU_PANEL_LABEL: Record<MenuPanel, string> = {
  notifications: '알림 센터',
  tables: '표 목록',
  upload: '파일 올리기',
  trash: '휴지통',
  'add-block': '블록 추가',
  settings: '설정',
};
export const MENU_ACTION_LABEL: Record<MenuAction['type'], string> = {
  ask_ai: 'AI 에게 시키기',
  open_table: '표 열기',
  add_row: '표에 한 줄 넣기',
  link: '바깥 링크',
  open_panel: '앱 화면 열기',
};
/** 메뉴에 쓸 수 있는 아이콘(화면의 Icon 이름 중 일부) */
export const MENU_ICONS = ['sparkle', 'tasks', 'calendar', 'table', 'memo', 'bell', 'chart', 'sheet', 'link', 'upload', 'image', 'clip', 'edit', 'archive', 'pin', 'send', 'key', 'grid', 'palette', 'info'] as const;
export type MenuIcon = (typeof MENU_ICONS)[number];

export const MENU_MAX = 12;
export const MENU_LABEL_MAX = 16;

export interface MenuItemDto {
  id: string;
  position: number;
  label: string;
  icon: MenuIcon;
  description: string;
  action: MenuAction;
}

/** 메뉴에 필요한 새 표(추천이 제안, 고르면 만든다) */
export interface MenuNewTable {
  name: string;
  columns: { name: string; type: ColumnType }[];
}

/**
 * AI 추천 한 건(아직 만들지 않은 것). 표를 쓰는 동작은 table_id(이미 있는 표) 또는 new_table(새로 만들 표) 중 하나.
 * 추천에 없는 값은 null.
 */
export interface MenuDraft {
  label: string;
  icon: MenuIcon;
  description: string;
  action_type: MenuAction['type'];
  prompt: string | null;
  url: string | null;
  panel: MenuPanel | null;
  table_id: string | null;
  new_table: MenuNewTable | null;
  /** 왜 이 메뉴를 추천했는지(사용자에게 보여 줌) */
  reason: string;
}

export interface MenuRecommendation {
  /** 사용자 말을 AI 가 정리한 것 */
  summary: string;
  menus: MenuDraft[];
}
