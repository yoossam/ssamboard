import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readViewData, type BlockDto, type EventDto, type ViewData } from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { Empty } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { LOCAL_TRACK, localHandle } from '../lib/edition';
import { useQueryResult, useTable, useTasks } from '../lib/data';
import { dayKey, timezone, zoneOffset } from '../lib/format';
import { useApp } from '../lib/store';

// AI 화면 블록(type: view). AI가 쓴 그리기 코드를 두 겹의 격리된 틀 안에서 돌리고, 자료는 여기서(브라우저에서) 넣어 준다.
// 틀이 어떻게 가두는지와 약속(render(data, size), 신호 이름)은 서버의 boards/view-frame.ts 에 있다.
// 안쪽 틀은 믿지 않는다: 거기서 오는 신호는 종류와 짧은 글자만 읽고, 그 글자를 AI에 보낼 때는 요청이 아니라 자료로 붙인다.

const DAY = 86_400_000;

/** 틀의 준비 코드가 알려 주는 오류 종류(서버의 VIEW_ERROR_KINDS)와 그 안내 글. 이 글은 여기서 정한 것이라 AI에 그대로 보내도 된다. */
const PROBLEM: Record<string, string> = {
  no_render: 'render(data, size) 함수가 없습니다',
  threw: '그리는 코드가 실행 중에 오류를 냈습니다',
  timeout: '그리는 데 너무 오래 걸려 멈췄습니다(3초)',
  bad_output: '돌려준 화면이 글자가 아니거나 너무 큽니다',
  start: '그리는 코드를 시작하지 못했습니다',
};

/** 그리기 코드나 꾸밈이 바뀌면 틀을 새로 읽게 하는 짧은 표시. */
function revOf(source: string): string {
  let h = 5381;
  for (let i = 0; i < source.length; i++) h = ((h << 5) + h + source.charCodeAt(i)) | 0;
  return `${source.length.toString(36)}x${(h >>> 0).toString(36)}`;
}

/** 바깥 틀(같은 출처의 빈 문서) 안에 든 안쪽 틀의 창. */
function innerWindow(frame: HTMLIFrameElement | null): Window | null {
  try {
    // 서버 트랙은 바깥 틀 안의 안쪽 틀, 구글 드라이브 트랙은 틀 하나(sandbox srcdoc)다.
    if (LOCAL_TRACK) return frame?.contentWindow ?? null;
    return frame?.contentWindow?.frames[0] ?? null;
  } catch {
    return null;
  }
}

/** 오늘 앞뒤 며칠의 일정. */
function useViewEvents(spec: ViewData) {
  const on = spec.kind === 'events';
  const before = on ? spec.days_before : 0;
  const after = on ? spec.days_after : 0;
  const today = dayKey(new Date());
  return useQuery({
    queryKey: ['events', 'view', before, after, today],
    queryFn: () => {
      const start = new Date(`${today}T00:00:00${zoneOffset()}`).getTime();
      const from = new Date(start - before * DAY).toISOString();
      const to = new Date(start + (after + 1) * DAY).toISOString();
      return api.get<EventDto[]>(`/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    },
    enabled: on,
    refetchInterval: 5 * 60_000,
  });
}

/** 화면에 넣어 줄 자료. loaded 가 되면 넣고, stamp 가 바뀌면 다시 넣는다. */
function usePayload(spec: ViewData): { loaded: boolean; error: string | null; stamp: string; data: Record<string, unknown> } {
  const table = useQueryResult(spec.kind === 'table' ? spec.table_id : null, spec.kind === 'table' ? spec.query : null);
  const tasks = useTasks();
  const events = useViewEvents(spec);
  return useMemo(() => {
    const done = (loaded: boolean, error: unknown, data: Record<string, unknown>) => ({ loaded, error: error ? errorMessage(error) : null, data, stamp: loaded ? JSON.stringify(data) : '' });
    switch (spec.kind) {
      case 'table':
        return done(!!table.data, table.error, table.data ? { columns: table.data.columns, rows: table.data.rows } : {});
      case 'tasks':
        return done(!!tasks.data, tasks.error, { tasks: (tasks.data ?? []).map((t) => ({ title: t.title, due_at: t.due_at, status: t.status })) });
      case 'events':
        return done(!!events.data, events.error, { events: (events.data ?? []).map((e) => ({ title: e.title, start_at: e.start_at, end_at: e.end_at })) });
      default:
        return done(true, null, {});
    }
  }, [spec.kind, table.data, table.error, tasks.data, tasks.error, events.data, events.error]);
}

export function ViewBody({ block }: { block: BlockDto }) {
  const code = typeof block.config.code === 'string' ? block.config.code : '';
  const css = typeof block.config.css === 'string' ? block.config.css : '';
  const specKey = JSON.stringify(block.config.data ?? null);
  const spec = useMemo(() => readViewData(block.config.data), [specKey]);
  const payload = usePayload(spec);
  const rev = useMemo(() => revOf(`${code}\n/*css*/\n${css}`), [code, css]);
  const frame = useRef<HTMLIFrameElement>(null);
  const codeRef = useRef({ code, css });
  codeRef.current = { code, css };
  const localDoc = useMemo(() => (LOCAL_TRACK ? (localHandle()?.viewDocument() ?? '') : ''), []);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<{ kind: string; detail: string } | null>(null);
  // "LLM에 보내지 않음" 표의 자료로 그리는 화면이면, 코드가 알려 준 오류 글자는 AI에 붙이지 않는다(그 글자에 자료가 실려 있을 수 있다).
  const source = useTable(spec.kind === 'table' ? spec.table_id : null);
  const mayShare = spec.kind !== 'table' || (!!source.table && !source.table.llm_excluded);

  // 코드가 바뀌면 틀이 새로 열린다. 준비 신호를 다시 기다린다.
  useEffect(() => {
    setReady(false);
    setProblem(null);
  }, [rev]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const inner = innerWindow(frame.current);
      if (!inner || e.source !== inner) return;
      const m = e.data as { type?: unknown; kind?: unknown; message?: unknown } | null;
      if (!m || typeof m !== 'object') return;
      // 구글 드라이브 트랙: 틀이 떴다고 알리면 그때 AI 코드를 넣어 준다(코드는 문서에 적지 않는다).
      if (m.type === 'ssam:boot' && LOCAL_TRACK) inner.postMessage({ type: 'ssam:code', code: codeRef.current.code, css: codeRef.current.css }, '*');
      else if (m.type === 'ssam:ready') setReady(true);
      else if (m.type === 'ssam:drawn') setProblem(null);
      else if (m.type === 'ssam:error')
        setProblem({ kind: typeof m.kind === 'string' && m.kind in PROBLEM ? m.kind : 'threw', detail: typeof m.message === 'string' ? m.message.replace(/\s+/g, ' ').slice(0, 200) : '' });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // 틀이 준비됐고 자료가 왔으면 넣어 준다. 자료가 바뀌면 다시 넣는다.
  useEffect(() => {
    if (!ready || !payload.loaded) return;
    innerWindow(frame.current)?.postMessage({ type: 'ssam:data', expect_render: spec.kind !== 'none', data: { ...payload.data, now: new Date().toISOString(), timezone: timezone() } }, '*');
  }, [ready, payload.loaded, payload.stamp, spec.kind]);

  /**
   * 요청 글은 늘 같은 문장이다. 오류의 종류는 틀이 정한 것이라 그대로 붙이고, 코드가 알려 준 글자는 요청에 섞지 않고 자료로만 붙인다.
   * AI가 볼 수 없게 한 표의 자료로 그리는 화면이면 그 글자는 붙이지 않는다.
   */
  const askFix = () => {
    if (!problem) return;
    const app = useApp.getState();
    if (!app.selected.includes(block.id)) app.toggleSelected(block.id);
    const detail = mayShare && problem.detail ? `\n코드가 알려 준 글: ${problem.detail}` : '';
    app.openAi('선택한 화면 블록에서 오류가 납니다. 고쳐 주세요.', `오류 종류: ${PROBLEM[problem.kind]}${detail}`);
  };

  if (!code) return <Empty>화면이 비어 있습니다</Empty>;
  return (
    <div className="relative min-h-0 flex-1 bg-card">
      {LOCAL_TRACK ? (
        <iframe ref={frame} key={rev} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={localDoc} title={block.title} className="view-frame absolute inset-0 size-full border-0" />
      ) : (
        <iframe ref={frame} key={rev} src={`/api/blocks/${block.id}/frame?rev=${rev}`} title={block.title} className="view-frame absolute inset-0 size-full border-0" />
      )}
      {payload.error && (
        <div className="absolute inset-0 flex items-center justify-center bg-card px-4 text-center text-sm text-sub">자료를 불러오지 못했습니다. {payload.error}</div>
      )}
      {problem && !payload.error && (
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-lg border border-danger/30 bg-dangertint py-1.5 pr-1.5 pl-3 text-xs text-danger">
          <span className="min-w-0 flex-1 truncate" title={problem.detail || PROBLEM[problem.kind]}>
            화면에서 오류가 났습니다 · {PROBLEM[problem.kind]}
          </span>
          <button type="button" onClick={askFix} className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-card px-2 font-medium whitespace-nowrap text-accent hover:bg-tint">
            <Icon name="sparkle" size={14} />
            AI에게 고쳐 달라고 하기
          </button>
        </div>
      )}
    </div>
  );
}
