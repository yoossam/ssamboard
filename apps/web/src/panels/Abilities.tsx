/*
 * '할 수 있는 일'(2026-11-28 선생님 "업무 보드에서 할 수 있는 일을 어딘가에서 볼 수 있으면"):
 * 지금 보드(업무·수업)에서 되는 일을 묶어 보여 주고, [해 보기]로 그 화면을 바로 연다.
 * AI 예시 문장은 누르면 AI 에게 보낸다 — 바꾸는 일은 계획으로만 나오고 승인해야 반영되므로 눌러 봐도 안전하다.
 * 기능을 더하면 여기와 사용 안내(guide.html)를 함께 고친다.
 */
import { BOARD_KIND_LABEL } from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { Button, Sheet } from '../components/ui';
import { LOCAL_TRACK } from '../lib/edition';
import { useApp, type Panel } from '../lib/store';

interface Ability {
  icon: string;
  title: string;
  desc: string;
  /** 누르면 열 창 */
  panel?: Panel;
  /** 누르면 AI 에게 보낼 말(계획으로만 나온다) */
  ask?: string;
  /** 서버 판에서만 되는 것 */
  server?: boolean;
}
interface Group {
  title: string;
  items: Ability[];
}

const WORK: Group[] = [
  {
    title: '일 처리',
    items: [
      { icon: 'tasks', title: '할 일 넣기', desc: '마감을 넣으면 할 일 블록에, 비우면 담당 사업 블록에 보입니다. 누르면 큰 창에서 진행 기록을 읽고 고칩니다.', panel: { kind: 'task' } },
      { icon: 'calendar', title: '일정 넣기', desc: '오늘 일정 블록과 오늘 확인 줄에 나옵니다. 서버 판은 10분 전에 알려 줍니다.', panel: { kind: 'event' } },
      { icon: 'image', title: '가정통신문 → 일정', desc: '아래 [통신문 → 일정]으로 사진·PDF·한글 파일을 고르면 날짜를 찾아 일정·할 일로 계획합니다.' },
      { icon: 'edit', title: '엑셀·한글 파일 고치기', desc: '아래 [파일 고치기]로 파일을 고르고 고칠 내용을 적으면, 원본은 두고 고친 새 파일을 내려받습니다.' },
      {
        icon: 'sheet',
        title: '구글 설문 만들고 응답 모으기',
        desc: '설문지와 응답 표를 함께 만들고, 응답이 표로 저절로 모입니다(구글 연결 필요).',
        ask: '현장체험학습 참가 신청 구글 설문 만들어 줘. 이름, 참가 여부, 알레르기를 물어봐 줘',
      },
      { icon: 'table', title: '표 만들기·파일로 표', desc: '엑셀·CSV 를 올리면 표가 됩니다. 표 블록으로 보드에 놓고 AI 로 집계·그래프를 그립니다.', panel: { kind: 'upload' } },
    ],
  },
  {
    title: '결과 확인',
    items: [
      { icon: 'archive', title: '처리 결과', desc: 'AI 에게 맡긴 일의 상태·만든 파일·공유 링크를 한곳에서 보고, 가장 최근 것은 되돌립니다.', panel: { kind: 'results' } },
      { icon: 'bell', title: '오늘 확인 줄', desc: '보드 위쪽에 승인 대기·마감 지남·오늘 마감·남은 일정·안 읽은 알림 수가 뜹니다(0건은 숨김).' },
      { icon: 'link', title: '공유 링크', desc: '블록의 링크 단추로 로그인 없이 보는 읽기 전용 링크와 QR 을 만듭니다. 개인정보 칸은 숨길 수 있습니다.' },
      { icon: 'chart', title: '그래프·현황판', desc: '말로 시키면 AI 가 표·할 일·일정을 그래프나 현황판 블록으로 그립니다.', ask: '할 일을 마감 날짜별 막대그래프로 보여 줘' },
    ],
  },
  {
    title: '보드 꾸리기',
    items: [
      { icon: 'plus', title: '블록 추가', desc: '위쪽 [+ 블록]을 누르면 자주 넣는 블록이 나오고, 하나를 누르면 바로 빈 곳에 놓입니다(메모·할 일·일정·표·수업 자료…).', panel: { kind: 'add-block' } },
      { icon: 'modal', title: '스티커로 접기', desc: '블록 ⋯ → 스티커로 접기: 제목만 남겨 자리만 차지하게 하고, 누르면 큰 창으로 봅니다.' },
      { icon: 'drag', title: '옮기기·크기·자리 고정', desc: '머리줄 왼쪽 손잡이(⠿)로 옮기고 모서리로 크기를 바꿉니다. 놓은 자리 그대로 있고, 자리 고정하면 밀리지 않습니다.' },
      {
        icon: 'grid',
        title: '내 메뉴',
        desc: "자주 쓰는 순으로 저절로 정리됩니다(하루 한 번). 자주 쓰는 기능은 '자동'으로 들어오고, 스티커를 누르면 오른쪽에 세로로 열립니다. 지울 수 없고 접어 둘 수 있어요.",
        panel: { kind: 'menu-drawer' },
      },
    ],
  },
];

const CLASS: Group[] = [
  {
    title: '수업 중에 바로',
    items: [
      {
        icon: 'check',
        title: '즉석 퀴즈',
        desc: '주제를 말하면 문항·정답을 만들고, [퀴즈 시작]이면 QR 이 크게 열립니다. 학생은 로그인 없이 번호·별명으로 답합니다.',
        ask: '분수의 덧셈 퀴즈 5문제 만들어 줘',
        server: true,
      },
      {
        icon: 'sheet',
        title: '구글 설문 퀴즈',
        desc: '같은 퀴즈를 구글 설문(정답·점수)으로 만들고 같은 블록에서 결과를 봅니다(구글 연결 필요).',
        ask: '구글 설문으로 O·X 퀴즈 5문제 만들어 줘 — 주제: 자석의 성질',
      },
      { icon: 'sparkle', title: '결과 정리', desc: '마감한 퀴즈에서 많이 틀린 문항·자주 고른 오답·다시 설명할 점을 AI 가 정리합니다.', ask: '방금 낸 퀴즈 결과를 정리해 줘' },
    ],
  },
  {
    title: '수업 자료',
    items: [
      {
        icon: 'table',
        title: '학급 시간표',
        desc: '시간표는 수업 보드의 표 블록에서 보고 고칩니다. 내 메뉴 [시간표 편성]으로 바로 열고, AI 에게 "내일 시간표 알려 줘"처럼 물어도 됩니다.',
        panel: { kind: 'tables' },
      },
      { icon: 'link', title: '수업 자료 블록', desc: '캔바·구글 슬라이드·유튜브 주소를 붙여 모아 두고 큰 단추로 하나씩 엽니다. 학생 표시한 것만 학생용 링크·QR 로.', panel: { kind: 'add-block' } },
      { icon: 'grid', title: '틸더스 앱 추천', desc: '수업 자료 블록의 [틸더스]에서 주제·학년으로 수업 앱을 추천받아 담습니다.', ask: '자석 수업에 쓸 3학년 과학 앱 추천해 줘', server: true },
    ],
  },
  {
    title: '보드 꾸리기',
    items: [
      { icon: 'modal', title: '스티커로 접기', desc: '블록 ⋯ → 스티커로 접기: 제목만 남기고 누르면 큰 창. 교실 TV 에 띄울 때 깔끔합니다.' },
      { icon: 'grid', title: '수업 메뉴', desc: '수업 보드의 내 메뉴는 수업 보드에서 쓴 기능으로만 따로 정리됩니다.', panel: { kind: 'menu-drawer' } },
    ],
  },
];

const ASK_WORK = ['이번 주 마감 할 일 정리해 줘', '담당 사업 진행 상황 요약해 줘', '다음 주 일정 정리해 줘', '마감 지난 할 일 어떻게 할지 제안해 줘'];
const ASK_CLASS = ['오늘 수업 마무리 O·X 퀴즈 만들어 줘', '이 단원 핵심 개념 3가지로 정리해 줘'];

export function AbilitiesPanel() {
  const { close, openAi, replace } = useApp.getState();
  const kind = useApp((s) => s.boardKind);
  const groups = kind === 'class' ? CLASS : WORK;
  const asks = kind === 'class' ? ASK_CLASS : ASK_WORK;
  const run = (a: Ability) => {
    if (a.ask) return openAi(a.ask);
    if (a.panel) return replace(a.panel);
  };
  return (
    <Sheet
      title={`도움말 — ${BOARD_KIND_LABEL[kind]} 보드에서 할 수 있는 일`}
      icon="info"
      onClose={close}
      width={880}
      tall
      footer={
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-xs text-sub">AI 에게 보낸 말이 무언가를 바꾸면 먼저 계획으로 보여 주고, 승인해야 반영됩니다.</p>
          <Button icon="info" onClick={() => window.open('./guide.html', '_blank', 'noopener')}>
            사용 안내 전체
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-sm font-bold text-accent">{g.title}</h3>
            <div className="grid gap-2 md:grid-cols-2">
              {g.items
                .filter((a) => !(a.server && LOCAL_TRACK))
                .map((a) => (
                  <div key={a.title} className="flex gap-3 rounded-xl border bg-card p-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-tint text-accent">
                      <Icon name={a.icon} size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{a.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-sub">{a.desc}</p>
                      {(a.panel || a.ask) && (
                        <button type="button" className="mt-1.5 block text-left text-sm font-bold text-accent hover:underline" onClick={() => run(a)}>
                          {a.ask ? `"${a.ask}" 보내 보기 →` : '해 보기 →'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </section>
        ))}
        <section>
          <h3 className="mb-2 text-sm font-bold text-accent">AI 에게 이렇게 말해 보세요</h3>
          <div className="flex flex-wrap gap-1.5">
            {asks.map((t) => (
              <button key={t} type="button" className="h-9 rounded-full border bg-card px-3 text-sm transition hover:border-accent hover:text-accent" onClick={() => openAi(t)}>
                {t}
              </button>
            ))}
          </div>
        </section>
      </div>
    </Sheet>
  );
}
