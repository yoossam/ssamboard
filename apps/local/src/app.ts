/*
 * 구글 드라이브 트랙 앱 잇기 — 서버 판의 서비스·컨트롤러(apps/api/src)를 손으로 이어 붙인다(서버 판의 Nest 모듈 대신).
 * 서버에 컨트롤러를 더하면 여기에도 더한다(test/routes.test.ts 가 서버 판 주소와 견주어 빠진 것을 알려 준다).
 */
import { Audit } from '../../api/src/common/audit.service';
import { AiService } from '../../api/src/ai/ai.service';
import { CommandsService } from '../../api/src/ai/commands.service';
import { BoardsController, ItemsController } from '../../api/src/boards/boards.controller';
import { BoardsService } from '../../api/src/boards/boards.service';
import { ItemsService } from '../../api/src/items/items.service';
import { LlmService } from '../../api/src/llm/llm.service';
import { AiController, HealthController, NotificationsController, SettingsController, TrashController, UploadsController } from '../../api/src/misc.controllers';
import { UploadsService } from '../../api/src/uploads/uploads.service';
import { DataController } from '../../api/src/data/data.controller';
import { MenusController } from '../../api/src/menus/menus.controller';
import { MemoryController } from '../../api/src/memory/memory.controller';
import { MemoryService } from '../../api/src/memory/memory.service';
import { FilesController } from '../../api/src/files/files.controller';
import { FilesService } from '../../api/src/files/files.service';
import { MenusService } from '../../api/src/menus/menus.service';
import { SharesController } from '../../api/src/shares/shares.controller';
import { SharesService } from '../../api/src/shares/shares.service';
import { QuizzesController } from '../../api/src/quizzes/quizzes.controller';
import { QuizzesService } from '../../api/src/quizzes/quizzes.service';
import { TuildersController } from '../../api/src/tuilders/tuilders.controller';
import { TuildersService } from '../../api/src/tuilders/tuilders.service';
import { NotificationsService } from '../../api/src/notifications/notifications.service';
import { TablesController } from '../../api/src/tables/tables.controller';
import { TablesService } from '../../api/src/tables/tables.service';
import type { AuthCtx, SessionRow, UserRow } from '../../api/src/auth/auth.types';
import type { LocalDb } from './db';
import { LocalRouter } from './router';
import { Body, Controller, Delete, Get, Param, Post, BadRequestException } from './shim/nest-common';
import { ConnectorsController } from '../../api/src/connectors/connectors.controller';
import { ConnectorsService } from '../../api/src/connectors/connectors.service';
import { AuthService } from './stub/auth';
import { DRIVE_FILE_SCOPE, GoogleService, localGoogle } from './stub/google';

export interface LocalIdentity {
  email: string;
  name: string;
}

export interface LocalAppOptions {
  /** 구글 로그인을 끊고 처음 화면으로(트랙 껍데기가 준다). */
  onLogout?: () => void | Promise<void>;
  /** 자료가 바뀌었을 때(드라이브 맞춤이 듣는다). */
  onChange?: () => void;
}

const SESSION_TOKEN = 'local-device';

/** 이 브라우저의 사용자 한 명과 세션 한 줄을 준비한다(서버 판의 로그인·세션 표를 그대로 쓰려고). */
export async function ensureLocalUser(db: LocalDb, who: LocalIdentity): Promise<{ user: UserRow; session: SessionRow }> {
  let user = await db.one<UserRow>('select * from users order by created_at limit 1');
  if (!user) {
    // 자동 잠금은 끈다(0분) — 이 트랙의 문은 구글 로그인과 기기 자체 잠금이다.
    user = (await db.one<UserRow>("insert into users(email, name, lock_minutes, pin_hash) values ($1, $2, 0, 'local') returning *", [who.email.toLowerCase(), who.name]))!;
  } else if (who.email && user.email !== who.email.toLowerCase()) {
    user = (await db.one<UserRow>("update users set email = $2, name = coalesce(nullif($3, ''), name) where id = $1 returning *", [user.id, who.email.toLowerCase(), who.name]))!;
  }
  let session = await db.one<SessionRow>('select * from sessions where token_hash = $1', [SESSION_TOKEN]);
  if (!session) {
    session = (await db.one<SessionRow>("insert into sessions(token_hash, user_id, device_name, locked, expires_at) values ($1, $2, '이 브라우저', false, now() + interval '100 years') returning *", [
      SESSION_TOKEN,
      user.id,
    ]))!;
  }
  return { user, session };
}

export async function createLocalApp(db: LocalDb, who: LocalIdentity, opts: LocalAppOptions = {}): Promise<LocalRouter> {
  const { session } = await ensureLocalUser(db, who);
  const anyDb = db as any; // 서버 서비스는 Db 클래스를 받지만 쓰는 것은 query·one·tx 뿐이다.

  const audit = new Audit(anyDb);
  const notifications = new NotificationsService(anyDb);
  const boards = new BoardsService(anyDb);
  const items = new ItemsService(anyDb);
  const tables = new TablesService(anyDb);
  const llm = new LlmService(anyDb, notifications);
  // 시트·설문 연결은 서버 판 코드 그대로 — 구글 토큰만 브라우저 로그인 것(stub/google.ts)을 쓴다.
  const google = new GoogleService();
  const connectors = new ConnectorsService(anyDb, google as any, tables, notifications);
  const menus = new MenusService(anyDb, llm, tables);
  // 공유 링크: 서버가 없으니 구글 문서로(config.shareMode = 'drive')
  const shares = new SharesService(anyDb, items, tables, connectors);
  const memory = new MemoryService(anyDb);
  const files = new FilesService(anyDb);
  const quizzes = new QuizzesService(anyDb, connectors);
  const commands = new CommandsService(anyDb, boards, items, tables, notifications, connectors, menus, shares, memory, files, quizzes);
  const ai = new AiService(anyDb, llm, commands, boards, items, tables, notifications, menus, shares, memory, files, quizzes, new TuildersService());
  const auth = new AuthService();
  // 파일로 표 만들기: 올린 파일은 이 탭의 메모리(shim/node-fs.ts)에 표를 만들 때까지만 둔다.
  const uploads = new UploadsService(anyDb, llm, tables);

  /** 매 요청마다 세션이 가리키는 사용자를 새로 읽는다(설정 변경·자료 받기로 사용자가 바뀌어도 맞게). */
  const authCtx = async (): Promise<AuthCtx> => {
    const user =
      (await db.one<UserRow>('select u.* from users u join sessions s on s.user_id = u.id where s.id = $1', [session.id])) ??
      (await db.one<UserRow>('select * from users order by created_at limit 1'));
    if (!user) throw new BadRequestException('보드 자료가 비어 있습니다. 새로 고쳐 주세요.');
    return { user, session: { ...session, user_id: user.id }, locked: false, ip: 'local' };
  };

  @Controller()
  class LocalAuthController {
    @Get('auth/status')
    async status() {
      const { user } = await authCtx();
      return { authenticated: true, login_mode: 'google', locked: false, pin_set: true, lock_minutes: 0, seconds_left: null, user: { email: user.email, name: user.name, timezone: user.timezone } };
    }
    @Post('auth/activity')
    activity() {
      return { ok: true };
    }
    @Post('auth/lock')
    lock() {
      return { ok: true };
    }
    @Post('auth/unlock')
    unlock() {
      return { ok: true };
    }
    @Post('auth/pin/setup')
    pinSetup() {
      return { ok: true };
    }
    @Post('auth/logout')
    async logout() {
      try {
        await opts.onLogout?.();
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      return { ok: true };
    }
    @Get('sessions')
    async sessions() {
      return [
        {
          id: session.id,
          device_name: '이 브라우저',
          user_agent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
          last_active_at: new Date().toISOString(),
          created_at: session.created_at,
          current: true,
        },
      ];
    }
    @Delete('sessions/:id')
    revoke(@Param('id') _id: string) {
      throw new BadRequestException('이 트랙에는 다른 기기 세션이 없습니다. 기기에서 구글 로그아웃을 하면 됩니다.');
    }
    /**
     * 연결 추가 — 서버 판은 구글 동의 화면 주소를 주지만, 이 트랙은 브라우저 로그인에 시트·설문 권한(drive.file)을 더 받는다.
     * 웹훅은 받아 줄 서버가 없어 쓰지 않는다. (서버 판 POST /connectors 보다 먼저 등록돼 이것이 불린다.)
     */
    @Post('connectors')
    async addConnector(@Body() body: any) {
      if (body?.type !== 'google_sheets') throw new BadRequestException('구글 드라이브 트랙에서는 웹훅을 쓸 수 없습니다(받아 줄 서버가 없습니다).');
      const g = localGoogle();
      await g.connect([DRIVE_FILE_SCOPE]);
      const { user } = await authCtx();
      await connectors.saveGoogle(user.id, 'local', [DRIVE_FILE_SCOPE]);
      await db.pg.syncToFs(); // 화면이 곧 새로 고치므로 지금 써 넣는다
      return { url: `${typeof location === 'undefined' ? '/' : location.pathname}?connect=ok` };
    }
  }

  const router = new LocalRouter(
    [
      new LocalAuthController(),
      new HealthController(anyDb),
      new BoardsController(boards),
      new ItemsController(items as any),
      new TablesController(tables, uploads),
      new UploadsController(uploads),
      new DataController(anyDb, auth as any, audit),
      new NotificationsController(notifications),
      new SettingsController(anyDb, auth as any, llm, audit),
      new AiController(ai, commands, audit),
      new TrashController(anyDb),
      new ConnectorsController(connectors, google as any, auth as any, audit),
      new MenusController(menus),
      new MemoryController(memory),
      new FilesController(files),
      new SharesController(shares, audit),
      new QuizzesController(quizzes),
      new TuildersController(new TuildersService()),
    ],
    authCtx,
    opts.onChange,
  );
  return router;
}
