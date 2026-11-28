import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AiService } from './ai/ai.service';
import { CommandsService } from './ai/commands.service';
import { AuthController, SessionsController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { GoogleService } from './auth/google.service';
import { SessionGuard } from './auth/session.guard';
import { BoardsController, ItemsController } from './boards/boards.controller';
import { BoardsService } from './boards/boards.service';
import { Audit } from './common/audit.service';
import { ConnectorsController, WebhooksController } from './connectors/connectors.controller';
import { ConnectorsService } from './connectors/connectors.service';
import { Db } from './db/db.service';
import { ItemsService } from './items/items.service';
import { LlmService } from './llm/llm.service';
import { AiController, HealthController, NotificationsController, SettingsController, TrashController, UploadsController } from './misc.controllers';
import { NotificationsService } from './notifications/notifications.service';
import { DataController } from './data/data.controller';
import { MenusController } from './menus/menus.controller';
import { MenusService } from './menus/menus.service';
import { TablesController } from './tables/tables.controller';
import { TablesService } from './tables/tables.service';
import { UploadsService } from './uploads/uploads.service';
import { WorkerService } from './worker/worker.service';

/** 1인용 MVP라 모듈은 하나로 둔다. 모든 경로는 SessionGuard(세션·CSRF·잠금)를 거친다. */
@Module({
  controllers: [
    HealthController,
    DataController,
    AuthController,
    SessionsController,
    SettingsController,
    BoardsController,
    ItemsController,
    TablesController,
    UploadsController,
    NotificationsController,
    ConnectorsController,
    WebhooksController,
    AiController,
    TrashController,
    MenusController,
  ],
  providers: [
    Db,
    Audit,
    AuthService,
    GoogleService,
    BoardsService,
    ItemsService,
    NotificationsService,
    TablesService,
    UploadsService,
    ConnectorsService,
    LlmService,
    CommandsService,
    AiService,
    MenusService,
    WorkerService,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AppModule {}
