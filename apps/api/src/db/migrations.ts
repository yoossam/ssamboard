// 마이그레이션은 이름 순서대로 한 번씩만 실행된다(schema_migrations에 기록).
// 사용자 데이터를 담는 모든 테이블에 user_id를 직접 둔다. Phase 2에서 RLS를 켜도 다시 설계하지 않기 위해서다.

export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: '001_init',
    sql: /* sql */ `
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  role text not null default 'owner',
  pin_hash text,
  pin_fail_count int not null default 0,
  pin_locked_until timestamptz,
  lock_minutes int not null default 10,
  timezone text not null default 'Asia/Seoul',
  monthly_budget numeric(10,2) not null default 20,
  llm_provider text not null default 'anthropic',
  llm_model text not null default 'claude-sonnet-5-5',
  created_at timestamptz not null default now()
);

create table allowed_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  invited_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  device_name text not null default '',
  user_agent text not null default '',
  locked boolean not null default true,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user on sessions(user_id) where revoked_at is null;

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  key_encrypted text not null,
  last4 text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  name text not null default '',
  scopes text[] not null default '{}',
  token_encrypted text,
  status text not null default 'active',
  config jsonb not null default '{}',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index connectors_user on connectors(user_id);

create table boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null default '내 보드',
  created_at timestamptz not null default now()
);

create table ai_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  message_id uuid,
  plan jsonb not null default '[]',
  status text not null default 'proposed',
  applied_at timestamptz,
  changes jsonb not null default '[]',
  skipped jsonb not null default '[]',
  undone_at timestamptz,
  created_at timestamptz not null default now()
);
create index ai_commands_user on ai_commands(user_id, applied_at desc);

create table data_tables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  schema jsonb not null default '{"columns":[]}',
  origin text not null default 'manual',
  connector_id uuid references connectors(id) on delete set null,
  sheet_ref jsonb,
  sync_minutes int not null default 15,
  last_synced_at timestamptz,
  last_error text,
  llm_excluded boolean not null default false,
  command_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index data_tables_user on data_tables(user_id) where deleted_at is null;

create table data_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  table_id uuid not null references data_tables(id) on delete cascade,
  position bigint generated always as identity,
  data jsonb not null default '{}',
  raw jsonb,
  source_ref text,
  command_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index data_rows_table on data_rows(table_id, position) where deleted_at is null;
create index data_rows_command on data_rows(command_id) where command_id is not null;

create table blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  board_id uuid not null references boards(id) on delete cascade,
  type text not null,
  title text not null default '',
  layout_lg jsonb not null default '{"x":0,"y":0,"w":4,"h":4}',
  layout_sm jsonb,
  pinned boolean not null default false,
  config jsonb not null default '{}',
  source_table_id uuid references data_tables(id) on delete set null,
  command_id uuid,
  schedule jsonb,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index blocks_board on blocks(board_id) where deleted_at is null;

create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  due_at timestamptz,
  status text not null default 'open',
  external_id text,
  reminded_at timestamptz,
  command_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index tasks_user on tasks(user_id, due_at) where deleted_at is null;

create table events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  status text not null default 'confirmed',
  external_id text,
  reminded_at timestamptz,
  command_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index events_user on events(user_id, start_at) where deleted_at is null;

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source text not null,
  connector_id uuid references connectors(id) on delete set null,
  title text not null,
  body text not null default '',
  priority text not null default 'normal',
  status text not null default 'unread',
  ref jsonb,
  dedupe_key text,
  count int not null default 1,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index notifications_user on notifications(user_id, last_seen_at desc);
-- 같은 원인으로 반복되는 알림은 한 줄로 묶는다(NTF-6). 보관한 묶음은 닫힌 것으로 보고 새로 만든다.
create unique index notifications_dedupe on notifications(user_id, dedupe_key)
  where dedupe_key is not null and status <> 'archived';

create table uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  filename text not null,
  size int not null,
  mime text not null default '',
  storage_path text not null,
  table_id uuid references data_tables(id) on delete set null,
  created_at timestamptz not null default now()
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  content text not null default '',
  provider text,
  context_block_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index messages_conversation on messages(conversation_id, created_at);

create table audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid,
  session_id uuid,
  action text not null,
  target text not null default '',
  ip text not null default '',
  created_at timestamptz not null default now()
);
create index audit_logs_user on audit_logs(user_id, created_at desc);

create table llm_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  model text not null,
  purpose text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  web_searches int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
create index llm_runs_user on llm_runs(user_id, created_at);
`,
  },
  {
    // 기존 자비스의 프로젝트(설명·진행 기록)를 할 일로 옮기면서 본문을 담을 곳이 필요해 더한다.
    // 할 일 편집 창에서 보고 고칠 수 있고, AI도 할 일 목록을 읽을 때 함께 본다.
    name: '002_task_note',
    sql: /* sql */ `
alter table tasks add column note text not null default '';
`,
  },
  {
    // 보드 격자를 12칸에서 24칸으로(세로도 화면 8줄에서 16줄로) 나눠 블록·메모 크기를 절반 칸 단위로 정할 수 있게 한다.
    // 놓인 자리와 크기는 그대로 보이도록 모든 값을 두 배로 한다. 수정 시각은 건드리지 않는다(되돌리기 판단에 쓰인다).
    // 이 마이그레이션 뒤에 옛 이미지로 되돌리면 블록이 두 배로 보인다. 그때는 아래 식의 * 2 를 / 2 로 바꿔 한 번 돌린다.
    name: '003_finer_grid',
    sql: /* sql */ `
update blocks set layout_lg = jsonb_build_object(
  'x', (layout_lg->>'x')::int * 2,
  'y', (layout_lg->>'y')::int * 2,
  'w', (layout_lg->>'w')::int * 2,
  'h', least((layout_lg->>'h')::int * 2, 80)
);
alter table blocks alter column layout_lg set default '{"x":0,"y":0,"w":8,"h":8}';

-- AI 명령의 되돌리기 기록에 남은 옛 배치도 같은 단위로 맞춘다.
update ai_commands set changes = (
  select jsonb_agg(
    case when c->>'entity' = 'blocks' and jsonb_typeof(c#>'{before,layout_lg}') = 'object' then
      jsonb_set(c, '{before,layout_lg}', jsonb_build_object(
        'x', (c#>>'{before,layout_lg,x}')::int * 2,
        'y', (c#>>'{before,layout_lg,y}')::int * 2,
        'w', (c#>>'{before,layout_lg,w}')::int * 2,
        'h', least((c#>>'{before,layout_lg,h}')::int * 2, 80)
      ))
    else c end
    order by ord
  )
  from jsonb_array_elements(changes) with ordinality as t(c, ord)
)
where jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) > 0 and changes::text like '%layout_lg%';
`,
  },
  {
    // 암호 로그인(2026-11-27, 배포판): 처음 설치 때 주인 계정의 이메일·암호를 정한다. Google 로그인만 쓰면 비어 있다.
    // 틀린 횟수는 PIN과 따로 센다(5번 틀리면 15분 막힘).
    name: '004_password_login',
    sql: /* sql */ `
alter table users add column password_hash text;
alter table users add column password_fail_count int not null default 0;
alter table users add column password_locked_until timestamptz;

-- 서버가 기억해 두는 작은 값(지난번 로그인 방식 등). 로그인 방식이 바뀌면 시작할 때 모든 세션을 끝낸다(db.service.ts).
create table app_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
`,
  },
  {
    // 보드 꾸미기(2026-11-27): 바탕색 등. 블록의 바탕·제목 색은 blocks.config(bg, title_color)에 둔다.
    name: '005_board_theme',
    sql: /* sql */ `
alter table boards add column theme jsonb not null default '{}';
`,
  },
  {
    // 내 메뉴(2026-11-28): 위쪽 바로가기 줄. 동작은 정해진 몇 가지(@jarvis/shared menu.ts)만 — 서버가 검사한 뒤 넣는다.
    // 처음 접속 안내를 마쳤는지는 users.onboarded_at.
    name: '006_menus',
    sql: /* sql */ `
create table menu_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  position int not null default 0,
  label text not null,
  icon text not null default 'sparkle',
  description text not null default '',
  action jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index menu_items_user on menu_items(user_id, position);
alter table users add column onboarded_at timestamptz;
`,
  },
  {
    // 공유 링크(2026-11-28): 블록 하나를 로그인 없이 읽기 전용으로. token 은 링크 속 긴 무작위 값(보는 권한 그 자체).
    // block_id 는 가리키기 검사를 두지 않는다 — 자료 가져오기로 블록을 지웠다 다시 넣어도 링크가 남게(볼 때 확인한다).
    // external_* 는 구글 드라이브 트랙(구글 문서)의 주소·파일 id·공개 권한 id(끌 때 이 권한을 지운다 — 휴지통만으로는 계속 보인다).
    // options.show_columns 는 공유할 때 보이기로 한 칸 — 뒤에 더한 칸은 보이지 않는다(코덱스 검토).
    name: '007_shares',
    sql: /* sql */ `
create table shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  block_id uuid not null,
  token text not null unique,
  title text not null default '',
  options jsonb not null default '{}',
  external_url text,
  external_id text,
  external_perm text,
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count int not null default 0,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shares_user on shares(user_id, block_id);
`,
  },
  {
    // 기억(2026-11-28 선생님 "API 를 쓰더라도 그동안의 대화 내용을 기억하게"):
    // 대화는 이어서 열고(title·updated_at), 길어지면 앞부분을 요약해 둔다(summary·summary_until).
    // memories 는 사용자가 승인한 오래 가는 기억 — AI 를 부를 때마다 함께 보낸다.
    name: '008_memory',
    sql: /* sql */ `
alter table conversations add column title text not null default '';
alter table conversations add column summary text not null default '';
alter table conversations add column summary_until timestamptz;
alter table conversations add column updated_at timestamptz not null default now();
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_user on memories(user_id, created_at);
`,
  },
  {
    // 파일 고치기(2026-11-28): AI 창에 붙인 엑셀·한글 원본(edit_source)과 고친 결과(edit_result)도 uploads 에 — 하루 뒤 일꾼이 지운다.
    name: '009_file_edits',
    sql: /* sql */ `
alter table uploads add column kind text not null default 'table';
`,
  },
];
