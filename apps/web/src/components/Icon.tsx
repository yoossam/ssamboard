import type { BlockType } from '@jarvis/shared';

// 시안에서 쓴 선 아이콘(24 격자, 선 굵기 1.75). 외부 이미지를 불러오지 않도록 모두 코드로 그린다(ONE-12).

const PATHS: Record<string, (string | { rect: [number, number, number, number, number] })[]> = {
  menu: ['M4 7h16M4 12h16M4 17h16'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  calendar: [{ rect: [4, 5, 16, 15, 2] }, 'M8 3v4M16 3v4M4 10h16'],
  tasks: [{ rect: [4, 4, 16, 16, 3] }, 'M8 12l3 3 5-6'],
  bell: ['M6 16v-5a6 6 0 1112 0v5l2 2H4l2-2zM10 20a2 2 0 004 0'],
  table: [{ rect: [4, 5, 16, 14, 2] }, 'M4 10h16M10 5v14'],
  sparkle: ['M12 4l1.8 4.7 4.7 1.8-4.7 1.8L12 17l-1.8-4.7-4.7-1.8 4.7-1.8z'],
  memo: ['M6 4h9l4 4v12H6zM15 4v4h4M9 13h6M9 16h4'],
  pin: ['M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7'],
  send: ['M5 12l14-7-5 14-3-6-6-1z'],
  prev: ['M14 7l-5 5 5 5'],
  next: ['M10 7l5 5-5 5'],
  close: ['M6 6l12 12M18 6L6 18'],
  check: ['M5 12l5 5 9-10'],
  plus: ['M12 5v14M5 12h14'],
  lock: [{ rect: [5, 11, 14, 9, 2] }, 'M8 11V8a4 4 0 018 0v3'],
  unlock: [{ rect: [5, 11, 14, 9, 2] }, 'M8 11V8a4 4 0 017.5-2'],
  logout: ['M10 5H6v14h4M14 8l4 4-4 4M18 12H9'],
  backspace: ['M9 6h10v12H9l-5-6 5-6zM12 10l4 4M16 10l-4 4'],
  settings: ['M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6'],
  trash: ['M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v5M14 11v5'],
  upload: ['M12 16V5M8 9l4-4 4 4M5 19h14'],
  edit: ['M5 19h4l10-10-4-4L5 15v4zM13 7l4 4'],
  undo: ['M9 7L5 11l4 4M5 11h9a5 5 0 010 10h-3'],
  refresh: ['M19 6v5h-5M5 18v-5h5M18 11a7 7 0 00-12-3M6 13a7 7 0 0012 3'],
  link: ['M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1'],
  device: [{ rect: [4, 5, 16, 11, 2] }, 'M9 20h6M12 16v4'],
  panel: [{ rect: [4, 5, 16, 14, 2] }, 'M14 5v14'],
  modal: [{ rect: [4, 5, 16, 14, 2] }, 'M8 9h8v6H8z'],
  grid: ['M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z'],
  paste: [{ rect: [6, 5, 12, 15, 2] }, 'M9 5V3h6v2M9 11h6M9 15h4'],
  info: ['M12 8h.01M12 11v5M12 21a9 9 0 100-18 9 9 0 000 18z'],
  sheet: [{ rect: [5, 3, 14, 18, 2] }, 'M5 9h14M5 15h14M11 9v12'],
  archive: ['M4 5h16v4H4zM6 9v10h12V9M10 13h4'],
  webhook: ['M9 7a3 3 0 115 2l-3 5M7 14a3 3 0 103 4h6M17 15a3 3 0 10-3-4l-2-4'],
  drag: ['M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01'],
  at: ['M16 12a4 4 0 10-1.5 3.1M16 8v5a2 2 0 004 0v-1a8 8 0 10-3 6.2'],
  save: ['M5 5h11l3 3v11H5zM8 5v5h7V5M8 19v-6h8v6'],
  palette: ['M12 4a8 8 0 100 16c1.2 0 1.8-1 1.4-2-.5-1.2.3-2.5 1.6-2.5H17a3 3 0 003-3c0-4.7-3.6-8.5-8-8.5zM8 12h.01M10 8.5h.01M14.5 8.5h.01'],
  key: ['M14 10a4 4 0 10-3.5 4L7 17.5V20h3v-2h2v-2l1.2-1.2A4 4 0 0014 10zM15.5 8.5h.01'],
  chart: ['M4 20h16M7 20v-7M12 20V6M17 20v-10'],
};

/** 점으로 그리는 아이콘은 선을 굵게 해야 보인다. */
const BOLD = new Set(['more', 'drag']);

export const BLOCK_ICON: Record<BlockType, string> = { tasks: 'tasks', events: 'calendar', table: 'table', memo: 'memo', ai_result: 'sparkle', notifications: 'bell', view: 'chart' };

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  const parts = PATHS[name] ?? PATHS.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={BOLD.has(name) ? 3 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className ?? ''}`}
    >
      {parts.map((p, i) => (typeof p === 'string' ? <path key={i} d={p} /> : <rect key={i} x={p.rect[0]} y={p.rect[1]} width={p.rect[2]} height={p.rect[3]} rx={p.rect[4]} />))}
    </svg>
  );
}
