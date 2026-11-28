import type { AuthStatus } from '@jarvis/shared';
import type { AttachedFile, AttachedImage, AttachedLink } from './images';
import { create } from 'zustand';

// 화면 상태(잠금, 열려 있는 창, 편집 모드). 서버 데이터는 TanStack Query가 맡는다.

export type Panel =
  | { kind: 'menu' }
  | { kind: 'more' }
  | { kind: 'add-block' }
  | { kind: 'settings'; tab?: SettingsTab }
  | { kind: 'notifications' }
  | { kind: 'tables' }
  | { kind: 'table'; tableId: string; addRow?: boolean }
  | { kind: 'upload' }
  | { kind: 'sheet'; connectorId: string }
  | { kind: 'trash' }
  | { kind: 'block'; blockId: string }
  | { kind: 'block-edit'; blockId: string }
  | { kind: 'task'; taskId?: string }
  | { kind: 'event'; eventId?: string };

export type SettingsTab = 'general' | 'menu' | 'security' | 'connect' | 'devices' | 'drive' | 'data';
export type AiLayout = 'modal' | 'panel';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error';
}

interface AppState {
  /** null이면 아직 서버에 묻는 중. */
  status: AuthStatus | null;
  /** 이 화면에서 잠긴 까닭(잠금 화면의 안내 문구용). */
  lockReason: 'idle' | 'manual' | null;
  offline: boolean;
  /** 열린 창들. 마지막이 맨 위다(설정 → PIN 확인처럼 겹칠 수 있다). */
  panels: Panel[];
  aiOpen: boolean;
  aiLayout: AiLayout;
  /** AI 창을 열면서 바로 보낼 말. data 는 요청이 아니라 자료로 붙는다(믿을 수 없는 글은 여기에 싣는다). */
  aiDraft: { text: string; data?: string; images?: AttachedImage[]; files?: AttachedFile[]; links?: AttachedLink[] } | null;
  editMode: boolean;
  /** AI에 컨텍스트로 줄 블록(ONE-7). */
  selected: string[];
  toasts: Toast[];

  setStatus: (status: AuthStatus | null) => void;
  setOffline: (offline: boolean) => void;
  markLocked: (reason?: 'idle' | 'manual') => void;
  markSignedOut: () => void;
  open: (panel: Panel) => void;
  replace: (panel: Panel) => void;
  close: () => void;
  closeAll: () => void;
  openAi: (draft?: string, data?: string, images?: AttachedImage[], files?: AttachedFile[], links?: AttachedLink[]) => void;
  closeAi: () => void;
  takeDraft: () => { text: string; data?: string; images?: AttachedImage[]; files?: AttachedFile[]; links?: AttachedLink[] } | null;
  setAiLayout: (layout: AiLayout) => void;
  setEditMode: (on: boolean) => void;
  toggleSelected: (blockId: string) => void;
  clearSelected: () => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dropToast: (id: number) => void;
}

function savedLayout(): AiLayout {
  try {
    return localStorage.getItem('jarvis.aiLayout') === 'panel' ? 'panel' : 'modal';
  } catch {
    return 'modal';
  }
}

let toastSeq = 0;

export const useApp = create<AppState>()((set, get) => ({
  status: null,
  lockReason: null,
  offline: false,
  panels: [],
  aiOpen: false,
  aiLayout: savedLayout(),
  aiDraft: null,
  editMode: false,
  selected: [],
  toasts: [],

  setStatus: (status) => set(status?.authenticated && !status.locked ? { status, lockReason: null } : { status }),
  setOffline: (offline) => set({ offline }),
  // 잠기면 열려 있던 창과 선택을 모두 닫는다. 잠금 화면 뒤에 내용이 남지 않게 한다.
  markLocked: (reason) => {
    const s = get().status;
    if (s?.authenticated && !s.locked) set({ status: { ...s, locked: true, seconds_left: 0 }, lockReason: reason ?? null, panels: [], aiOpen: false, editMode: false, selected: [] });
  },
  markSignedOut: () => set({ status: { authenticated: false }, panels: [], aiOpen: false, editMode: false, selected: [] }),
  open: (panel) => set((s) => ({ panels: [...s.panels, panel] })),
  replace: (panel) => set((s) => ({ panels: [...s.panels.slice(0, -1), panel] })),
  close: () => set((s) => ({ panels: s.panels.slice(0, -1) })),
  closeAll: () => set({ panels: [] }),
  openAi: (draft, data, images, files, links) => set({ aiOpen: true, aiDraft: draft || images?.length || files?.length || links?.length ? { text: draft ?? '', data, images, files, links } : null, panels: [] }),
  closeAi: () => set({ aiOpen: false, aiDraft: null }),
  takeDraft: () => {
    const draft = get().aiDraft;
    if (draft !== null) set({ aiDraft: null });
    return draft;
  },
  setAiLayout: (aiLayout) => {
    try {
      localStorage.setItem('jarvis.aiLayout', aiLayout);
    } catch {
      /* 저장하지 못해도 이번 화면에서는 적용된다. */
    }
    set({ aiLayout });
  },
  setEditMode: (editMode) => set({ editMode }),
  toggleSelected: (blockId) => set((s) => ({ selected: s.selected.includes(blockId) ? s.selected.filter((id) => id !== blockId) : [...s.selected, blockId].slice(-5) })),
  clearSelected: () => set({ selected: [] }),
  toast: (text, tone = 'ok') => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
    setTimeout(() => get().dropToast(id), tone === 'error' ? 6000 : 3500);
  },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
