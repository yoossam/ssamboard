/*
 * 공유 링크(2026-11-28): 블록 하나를 로그인 없이 보는 읽기 전용 페이지로.
 * 서버 트랙은 쌤보드가 /s/<열쇠> 를 직접 내보내고(볼 때마다 지금 자료), 구글 드라이브 트랙은 내 드라이브에 구글 문서를 만들어
 * '링크가 있는 사람 보기'로 연다(만든 때의 자료 — '다시 올리기'로 갱신).
 */
import type { BlockType } from './types';

/** 공유할 수 있는 블록(알림은 개인 것이라, AI 화면 블록은 아직 빼 둠) */
export const SHAREABLE_BLOCKS: BlockType[] = ['tasks', 'events', 'table', 'memo', 'ai_result'];
/** 링크 기간(일). 0 은 기간 없음. 구글 문서(드라이브 트랙)는 구글이 공개 링크에 기간을 둘 수 없어 늘 0 */
export const SHARE_DAYS = [7, 30, 90, 0] as const;

export interface ShareOptions {
  /** 만들 때 보낸 값: 표 블록에서 숨길 칸(열 id) */
  hide_columns?: string[];
  /** 서버가 저장하는 값: 공유할 때 보이기로 한 칸(열 id·결과 열 이름). 뒤에 더한 칸은 보이지 않는다. */
  show_columns?: string[];
}

export interface ShareDto {
  id: string;
  block_id: string;
  title: string;
  url: string;
  /** 'server' = 쌤보드가 보여 줌(늘 지금 자료), 'drive' = 구글 문서(만든 때 자료) */
  mode: 'server' | 'drive';
  options: ShareOptions;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
}
