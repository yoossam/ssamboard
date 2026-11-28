import { BLOCK_TYPES, COLUMN_TYPES, EVENT_DAYS, FORM_QUESTION_TYPES, MEMO_COLORS, MENU_ACTION_TYPES, MENU_ICONS, MENU_PANELS, NOTI_SHOWS, PLACE_HINTS, SHARE_DAYS, TASK_FILTERS, TITLE_COLORS } from '@jarvis/shared';
import type { LlmTool } from '../llm/adapter';

// AI가 쓸 수 있는 도구(ONE-3). 읽기 도구는 바로 실행하고, 쓰기 도구는 실행하지 않고 변경 계획에 담는다(ONE-5).
// 잠금·PIN·API 키·커넥터 권한을 바꾸는 도구는 일부러 두지 않는다(ONE-10).

const iso = '오프셋이 붙은 ISO 8601 시각(예: 2026-11-26T15:00:00+09:00). 사용자의 시간대 기준으로 계산한다.';
const position = { type: 'string', enum: PLACE_HINTS, description: '보드에서 놓을 모서리. 사용자가 위치를 말했을 때만 쓴다.' };
const memoColor = { type: 'string', enum: [...MEMO_COLORS], description: '메모(붙임쪽지) 종이 색. yellow 노랑, pink 분홍, green 초록, blue 파랑, purple 보라, orange 주황, white 하양' };
const viewCode = {
  type: 'string',
  description: '화면 블록(type: view)의 그리기 코드(자바스크립트). function render(data, size)를 정의하고 HTML·SVG 글자를 돌려준다. 쓰는 법은 시스템 안내의 "화면 블록"을 따른다.',
};
const viewCss = { type: 'string', description: '화면 블록의 꾸밈(CSS). render가 돌려주는 글자의 class를 꾸민다. 없어도 된다.' };
const viewData = {
  type: 'object',
  description:
    '화면 블록이 받을 자료. 표는 {"kind":"table","table_id":"…","query":{…query_table과 같은 규격}}, 할 일은 {"kind":"tasks"}, ' +
    '일정은 {"kind":"events","days_before":0,"days_after":30}. 자료가 필요 없으면 주지 않는다.',
};

export const READ_TOOLS: LlmTool[] = [
  {
    name: 'get_board',
    description: '보드에 놓인 블록 목록(id, 종류, 제목, 고정 여부, 위치)을 돌려준다. 블록을 옮기거나 지우거나 가리키기 전에 먼저 부른다.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_tasks',
    description: '할 일 목록(id, 제목, 마감, 상태)을 돌려준다. 할 일을 고치기 전에 id를 확인할 때 쓴다.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'done'] } }, additionalProperties: false },
  },
  {
    name: 'list_events',
    description: '일정 목록(id, 제목, 시작, 끝)을 돌려준다. 기간을 주지 않으면 오늘 일정이다.',
    input_schema: { type: 'object', properties: { from: { type: 'string', description: iso }, to: { type: 'string', description: iso } }, additionalProperties: false },
  },
  {
    name: 'list_tables',
    description:
      '사용자의 표 목록과 각 표의 컬럼(id, 이름, 타입), 행 수를 돌려준다. query_table이나 add_rows를 쓰기 전에 컬럼 id를 확인한다. "LLM에 보내지 않음"으로 설정된 표는 이름만 나온다.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'query_table',
    description:
      '표를 조회하거나 집계한다. 숫자는 서버가 계산하므로 합계·평균·건수가 필요하면 직접 계산하지 말고 반드시 이 도구를 쓴다. ' +
      '컬럼은 이름이 아니라 list_tables가 알려 준 col_id로 가리킨다. filter 조건은 모두 AND이고 조인과 OR은 없다. ' +
      'op: eq, ne, gt, gte, lt, lte, contains, in(값 배열), between(값 두 개), is_null. agg.fn: count, sum, avg, min, max. ' +
      '날짜 컬럼은 group_by에 bucket(day, week, month)을 줄 수 있다. sort는 col_id(묶을 때는 group_by에 든 컬럼) 또는 agg 순번으로 한다.',
    input_schema: {
      type: 'object',
      properties: {
        table_id: { type: 'string' },
        filter: { type: 'array', items: { type: 'object', properties: { col_id: { type: 'string' }, op: { type: 'string' }, value: {} }, required: ['col_id', 'op'] } },
        group_by: { type: 'array', items: { type: 'object', properties: { col_id: { type: 'string' }, bucket: { type: 'string', enum: ['day', 'week', 'month'] } }, required: ['col_id'] } },
        agg: { type: 'array', items: { type: 'object', properties: { col_id: { type: 'string' }, fn: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] } }, required: ['fn'] } },
        sort: { type: 'array', items: { type: 'object', properties: { col_id: { type: 'string' }, agg: { type: 'integer' }, dir: { type: 'string', enum: ['asc', 'desc'] } }, required: ['dir'] } },
        limit: { type: 'integer' },
      },
      required: ['table_id'],
    },
  },
  {
    name: 'list_notifications',
    description: '알림 목록(id, 제목, 중요도, 상태, 반복 횟수, 마지막 발생 시각)을 돌려준다. 알림을 요약하거나 읽음 처리하기 전에 쓴다.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['unread', 'read', 'archived'] } }, additionalProperties: false },
  },
];

// 말로 관리(2026-11-28 선생님 "AI 로 쉽게 정리·관리·보기"): 메뉴·공유 링크를 읽고, 화면을 연다.
READ_TOOLS.push(
  {
    name: 'list_menus',
    description: '보드 위쪽 바로가기 줄의 "내 메뉴" 목록(id, 순서, 이름, 아이콘, 동작)을 돌려준다. 메뉴를 고치거나 지우기 전에 id 를 확인할 때 쓴다.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_shares',
    description: '만든 공유 링크(로그인 없이 보는 읽기 전용 링크) 목록(id, 블록, 제목, 주소, 꺼짐·기간)을 돌려준다.',
    input_schema: { type: 'object', properties: { block_id: { type: 'string' } } },
  },
  {
    name: 'open_screen',
    description:
      '사용자 화면에서 창을 바로 연다(바꾸는 것이 없어 승인이 필요 없다). "출석부 열어 줘", "휴지통 보여 줘", "설정 열어 줘"처럼 화면을 열어 달라고 할 때 쓴다. ' +
      `target: ${MENU_PANELS.join(', ')}(앱 화면), table(표 하나 — id 는 list_tables), block(블록을 크게 — id 는 get_board), share(블록의 공유 링크 창 — id 는 블록 id).`,
    input_schema: { type: 'object', properties: { target: { type: 'string', enum: [...MENU_PANELS, 'table', 'block', 'share'] }, id: { type: 'string' } }, required: ['target'] },
  },
);

const menuDraft = {
  label: { type: 'string', description: '메뉴 이름(16자 이내)' },
  icon: { type: 'string', enum: [...MENU_ICONS] },
  description: { type: 'string', description: '누르면 무엇이 되는지 한 문장' },
  action_type: { type: 'string', enum: [...MENU_ACTION_TYPES], description: 'ask_ai(AI 에게 정해 둔 말 보내기), open_table(표 열기), add_row(표에 한 줄 넣기), link(https 주소), open_panel(앱 화면)' },
  prompt: { type: 'string', description: 'ask_ai 일 때 보낼 말' },
  url: { type: 'string', description: 'link 일 때 https 주소' },
  panel: { type: 'string', enum: [...MENU_PANELS], description: 'open_panel 일 때' },
  table_id: { type: 'string', description: 'open_table·add_row 에서 기존 표(list_tables)' },
  new_table: {
    type: 'object',
    description: 'open_table·add_row 에서 표가 없으면 새로 만들 표',
    properties: { name: { type: 'string' }, columns: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: COLUMN_TYPES } }, required: ['name', 'type'] } } },
    required: ['name', 'columns'],
  },
};

export const WRITE_TOOLS: LlmTool[] = [
  {
    name: 'add_task',
    description: '할 일을 추가하는 단계를 변경 계획에 담는다. 실제 반영은 사용자가 승인한 뒤에 된다.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, due_at: { type: 'string', description: `마감. ${iso}` } }, required: ['title'] },
  },
  {
    name: 'update_task',
    description: '할 일의 제목·마감·상태를 고치는 단계를 계획에 담는다. id는 list_tasks로 확인한다. 완료 처리는 status를 done으로 한다.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, title: { type: 'string' }, due_at: { type: ['string', 'null'], description: `${iso} 마감을 지우려면 null.` }, status: { type: 'string', enum: ['open', 'done'] } },
      required: ['id'],
    },
  },
  {
    name: 'add_event',
    description: '일정을 추가하는 단계를 계획에 담는다. "내일 3시"처럼 오전·오후가 없으면 업무 시간대(오후)로 본다.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, start_at: { type: 'string', description: iso }, end_at: { type: 'string', description: iso } }, required: ['title', 'start_at'] },
  },
  {
    name: 'update_event',
    description: '일정의 제목·시작·끝을 고치는 단계를 계획에 담는다. id는 list_events로 확인한다.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, start_at: { type: 'string', description: iso }, end_at: { type: ['string', 'null'], description: iso } }, required: ['id'] },
  },
  {
    name: 'create_block',
    description:
      '보드에 새 블록을 놓는 단계를 계획에 담는다. 글로 된 결과는 type을 ai_result로 하고 text에 담는다. ' +
      '표를 보여 주려면 type을 table로 하고 table_id를 준다. 집계 결과를 블록으로 꺼내려면 type을 ai_result로 하고 table_id와 query(query_table과 같은 규격)를 준다. ' +
      '이렇게 만든 블록은 원본이 바뀌면 다시 계산된다. 메모(붙임쪽지·포스트잇)는 type을 memo로 하고 text에 담는다. 메모는 color로 종이 색을 정할 수 있다(주지 않으면 노랑). ' +
      '그래프·달력·현황판처럼 그려서 보여 줄 것은 type을 view로 하고 code(그리기 코드), css(꾸밈), data(받을 자료)를 준다. view에는 text·table_id·query를 쓰지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: BLOCK_TYPES },
        title: { type: 'string' },
        text: { type: 'string' },
        table_id: { type: 'string' },
        query: { type: 'object' },
        color: memoColor,
        code: viewCode,
        css: viewCss,
        data: viewData,
        position,
      },
      required: ['type'],
    },
  },
  {
    name: 'update_block',
    description:
      '블록의 제목을 바꾸거나, 할 일·일정·알림 블록의 보여 줄 내용(task_filter·event_days·noti_show)을 바꾸거나, 고정하거나(pinned), 다른 모서리로 옮기거나(position), 바탕색(color — 메모는 종이 색, 다른 블록은 바탕)이나 제목 글자색(title_color)을 바꾸거나, ' +
      '화면 블록의 그리기 코드(code)·꾸밈(css, 각각 고친 전체를 준다)이나 받을 자료(data)를 바꾸는 단계를 계획에 담는다. id는 get_board로 확인한다.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        pinned: { type: 'boolean' },
        color: memoColor,
        title_color: { type: 'string', enum: [...TITLE_COLORS] },
        code: viewCode,
        css: viewCss,
        data: viewData,
        position,
        task_filter: { type: 'string', enum: [...TASK_FILTERS], description: '할 일 블록에 보여 줄 할 일: all 전부, open 안 끝난 것만, today 오늘까지 마감, week 이번 주까지 마감' },
        event_days: { type: 'integer', enum: [...EVENT_DAYS], description: '일정 블록에 보여 줄 기간(오늘부터 며칠)' },
        noti_show: { type: 'string', enum: [...NOTI_SHOWS], description: '알림 블록: all 전부, unread 안 읽은 것만' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_block',
    description: '블록을 휴지통으로 보내는 단계를 계획에 담는다. 사용자가 분명히 지워 달라고 했을 때만 쓴다. 블록이 보여 주던 표나 할 일 자체는 지워지지 않는다.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'create_table',
    description:
      '사용자가 붙여넣은 자료(<pasted_data>)에서 표를 만드는 단계를 계획에 담는다. 자료에 있는 값만 옮기고, 없는 값을 지어내지 않는다. ' +
      `한 번에 최대 200행이다. 컬럼 타입은 ${COLUMN_TYPES.join(', ')} 중에서 고른다. rows의 각 행은 columns와 같은 순서의 문자열 배열이고, 빈 칸은 null이다. ` +
      '값은 자료에 적힌 그대로 옮긴다("1,200원"을 숫자로 바꾸는 일은 서버가 한다). 같은 종류의 표가 이미 있으면 새로 만들지 말고 add_rows를 먼저 제안한다. ' +
      'place_block을 true로 하면 만든 표를 보드에 표 블록으로 놓는다.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        columns: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: COLUMN_TYPES } }, required: ['name', 'type'] } },
        rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'null'] } } },
        place_block: { type: 'boolean' },
        position,
      },
      required: ['name', 'columns', 'rows'],
    },
  },
  {
    name: 'create_form',
    description:
      '자료를 모을 Google 설문지를 만드는 단계를 계획에 담는다(참가 신청, 의견 조사, 제출 확인 등). 승인하면 사용자의 Google 드라이브에 설문지가 생기고, 응답을 모으는 표가 함께 만들어져 주기적으로 채워진다. ' +
      '응답 링크는 만든 뒤 알림과 표 상세에 나오고 list_tables의 form.responder_uri로도 확인할 수 있다. 만들기 전에는 알 수 없으니 링크를 지어내지 않는다. Google 설문지는 한번 만들면 되돌리기로 지워지지 않는다. ' +
      '질문 type: short(짧은 글), long(긴 글), choice(하나 고르기), checkbox(여러 개 고르기), dropdown(목록에서 고르기), date(날짜), scale(점수: low 0 또는 1, high 2~10). choice·checkbox·dropdown에는 options가 필요하다. ' +
      '설문지는 누가 냈는지 따로 알려 주지 않으므로, 알아야 하면 이름·학년·반 같은 질문을 넣는다. 꼭 필요한 것만 묻는다.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '설문 제목. 응답 표의 이름으로도 쓴다.' },
        description: { type: 'string', description: '설문 맨 위에 보이는 안내 글' },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              type: { type: 'string', enum: [...FORM_QUESTION_TYPES] },
              required: { type: 'boolean' },
              options: { type: 'array', items: { type: 'string' } },
              low: { type: 'integer' },
              high: { type: 'integer' },
            },
            required: ['title', 'type'],
          },
        },
        place_block: { type: 'boolean', description: '응답 표를 보드에 블록으로 놓을지. 주지 않으면 놓는다.' },
        position,
      },
      required: ['title', 'questions'],
    },
  },
  {
    name: 'add_rows',
    description: '기존 표에 행을 더하는 단계를 계획에 담는다. 각 행은 col_id를 키로 하는 객체다. col_id는 list_tables로 확인한다. 연결된 시트 표에는 쓸 수 없다.',
    input_schema: { type: 'object', properties: { table_id: { type: 'string' }, rows: { type: 'array', items: { type: 'object' } } }, required: ['table_id', 'rows'] },
  },
  {
    name: 'mark_notifications',
    description: '알림을 읽음(read) 또는 보관(archived)으로 바꾸는 단계를 계획에 담는다. id는 list_notifications로 확인한다.',
    input_schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['read', 'archived'] } }, required: ['ids', 'status'] },
  },
  {
    name: 'create_menu',
    description:
      '보드 위쪽 바로가기 줄에 "내 메뉴"를 하나 더하는 단계를 계획에 담는다. 메뉴는 정해진 동작 하나만 한다(action_type). ' +
      '자주 시키는 일은 ask_ai, 기록·명단·제출 현황처럼 한 줄씩 적는 일은 add_row, 보는 표는 open_table, 사이트는 link, 앱 화면은 open_panel. ' +
      '표가 필요한데 없으면 new_table 로 칸 구성까지 정한다(이미 있으면 table_id). 메뉴는 12개까지다.',
    input_schema: { type: 'object', properties: menuDraft, required: ['label', 'icon', 'action_type'] },
  },
  {
    name: 'update_menu',
    description: '내 메뉴의 이름·아이콘·설명을 바꾸거나 순서(index, 0 이 맨 앞)를 옮기는 단계를 계획에 담는다. id 는 list_menus 로 확인한다. 동작을 바꾸려면 지우고 새로 만든다.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, icon: { type: 'string', enum: [...MENU_ICONS] }, description: { type: 'string' }, index: { type: 'integer' } }, required: ['id'] },
  },
  {
    name: 'delete_menu',
    description: '내 메뉴를 지우는 단계를 계획에 담는다(메뉴가 쓰던 표는 그대로). 사용자가 분명히 지워 달라고 했을 때만 쓴다.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'create_share',
    description:
      '블록 하나를 로그인 없이 보는 읽기 전용 공유 링크로 만드는 단계를 계획에 담는다(할 일·일정·표·메모·AI 결과 블록만). 승인하면 링크가 생기고 결과에 주소가 나온다. ' +
      '학부모·바깥 사람에게 보여 줄 것이라 개인정보 칸(전화·주소 등)은 hide_columns 에 칸 이름으로 넣어 숨기기를 권한다. days 는 기간(0 은 기간 없음).',
    input_schema: {
      type: 'object',
      properties: {
        block_id: { type: 'string' },
        title: { type: 'string', description: '받는 사람에게 보일 제목' },
        days: { type: 'integer', enum: [...SHARE_DAYS] },
        hide_columns: { type: 'array', items: { type: 'string' }, description: '숨길 칸 이름(표 블록)' },
      },
      required: ['block_id'],
    },
  },
  {
    name: 'edit_file',
    description:
      '붙인 엑셀(.xlsx)·한글(.hwpx) 파일을 고치는 단계를 계획에 담는다. 원본은 그대로 두고, 승인하면 고친 새 파일을 내려받는다. file_id 는 <attached_file … file_id> 의 값. ' +
      '엑셀 edits: {op:"set", sheet?, cell:"C3", value} 값 넣기 · {op:"formula", sheet?, cell, formula:"SUM(B2:C2)"} 수식(합계·평균은 이것으로) · {op:"append_row", sheet?, values:[…]} 줄 더하기 · ' +
      '{op:"highlight", sheet?, range:"A2:D2", color: yellow|red|green|blue|orange|gray|none} 바탕색 · {op:"bold", sheet?, range} 굵게. sheet 를 주지 않으면 첫 시트. ' +
      '한글 edits: {op:"set_text", p:12, text:"…"} 그 문단의 글을 통째로 바꾸기(빈 칸 채우기) · {op:"replace", find:"11월 30일", replace:"12월 5일"} 문서 전체에서 찾아 바꾸기. 글자만 바뀌고 서식은 그대로다.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string' },
        edits: { type: 'array', items: { type: 'object' } },
        summary: { type: 'string', description: '무엇을 고쳤는지 한 문장(사용자에게 보임)' },
      },
      required: ['file_id', 'edits'],
    },
  },
  {
    name: 'remember',
    description:
      '오래 가는 기억에 짧은 한 문장을 넣는 단계를 계획에 담는다(승인하면 다음 대화부터 늘 함께 보인다). 사용자에 대한 사실·선호·자주 쓰는 형식만(예: "5학년 3반 담임", "학부모 문자는 존댓말로 세 줄 이내"). ' +
      '학생 개인정보·비밀번호·열쇠는 넣지 않는다.',
    input_schema: { type: 'object', properties: { text: { type: 'string', description: '300자 이내 한 문장' } }, required: ['text'] },
  },
  {
    name: 'forget',
    description: '오래 가는 기억 하나를 지우는 단계를 계획에 담는다. id 는 안내문 끝 "기억" 목록의 [id].',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

export const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));
export const ALL_TOOLS: LlmTool[] = [...READ_TOOLS, ...WRITE_TOOLS];

/** AI 창에 보여 주는 진행 표시. */
export const TOOL_LABEL: Record<string, string> = {
  get_board: '보드 확인',
  list_tasks: '할 일 확인',
  list_events: '일정 확인',
  list_tables: '표 목록 확인',
  query_table: '표 집계',
  list_notifications: '알림 확인',
  add_task: '할 일 추가',
  update_task: '할 일 변경',
  add_event: '일정 추가',
  update_event: '일정 변경',
  create_block: '새 블록',
  update_block: '블록 변경',
  delete_block: '블록 삭제',
  create_table: '새 표',
  create_form: '설문 만들기',
  add_rows: '행 추가',
  mark_notifications: '알림 정리',
  list_menus: '메뉴 확인',
  list_shares: '공유 링크 확인',
  open_screen: '화면 열기',
  create_menu: '메뉴 만들기',
  update_menu: '메뉴 변경',
  delete_menu: '메뉴 삭제',
  create_share: '공유 링크 만들기',
  edit_file: '파일 고치기',
  remember: '기억하기',
  forget: '기억 지우기',
};
