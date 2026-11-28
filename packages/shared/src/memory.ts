/* 기억(2026-11-28): 오래 가는 기억과 이어지는 대화. 서버는 apps/api/src/memory. */

/** 기억 한 개의 글자 수, 기억 개수 — AI 를 부를 때마다 모두 보내므로 작게 둔다 */
export const MEMORY_TEXT_MAX = 300;
export const MEMORY_MAX = 60;

export interface MemoryDto {
  id: string;
  text: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationDto {
  id: string;
  title: string;
  updated_at: string;
  /** 앞부분을 요약해 둔 것이 있으면 */
  summarized: boolean;
}

export interface ConversationMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  /** 이 답에 딸린 변경 계획 */
  command_id?: string | null;
}
