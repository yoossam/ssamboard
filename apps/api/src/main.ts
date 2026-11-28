import 'reflect-metadata';
import { Logger, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { assertConfig, config } from './config';
import { Db, runMigrations } from './db/db.service';

/**
 * 보안 헤더(5장). CSP로 외부 이미지·iframe·스크립트를 막고(ONE-12), Google Picker에 필요한 출처만 예외로 둔다.
 * img-src는 'self' data: 뿐이라 AI 출력이나 메모에 든 외부 이미지는 불러오지 않는다.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://apis.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://apis.google.com https://www.googleapis.com",
  // 'self' 는 AI 화면 블록의 바깥 틀(/api/blocks/:id/frame)이다. 그 안의 격리된 틀은 view-frame.ts 의 정책을 따른다.
  "frame-src 'self' https://docs.google.com https://drive.google.com https://content.googleapis.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // 다른 사이트가 이 보드를 새 창으로 열어도 그 창과 이어지지 않게 한다(window.opener 가 끊긴다).
  // AI 화면 블록의 격리된 코드가 보드를 연 바깥 창에 postMessage 로 자료를 건네는 길을 막는다.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

async function bootstrap(): Promise<void> {
  assertConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Cloudflare Tunnel이나 Caddy 뒤에서 돌기 때문에 프록시가 알려 준 주소를 믿는다(속도 제한·감사 로그의 IP).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cookieParser());
  // AI 창의 이미지 첨부(최대 4장, 화면에서 줄여 보냄) 때문에 2MB → 16MB(2026-11-27). 다른 요청은 각자 글자 수를 따로 막는다.
  app.useBodyParser('json', { limit: '16mb' });
  // 공유 페이지(/s/<열쇠>)는 /api 밖에서 로그인 없이 연다(shares.controller.ts)
  app.setGlobalPrefix('api', { exclude: ['health', { path: 's/:token', method: RequestMethod.GET }] });
  app.enableShutdownHooks();

  const applied = await runMigrations(app.get(Db).pool);
  if (applied.length > 0) Logger.log(`DB 마이그레이션 적용: ${applied.join(', ')}`, 'Bootstrap');

  // 빌드한 웹 앱을 같은 서버에서 내보낸다. 보드는 단일 URL(/)이므로 API가 아닌 GET은 모두 index.html로 보낸다(ONE-1).
  const index = join(config.webDist, 'index.html');
  if (existsSync(index)) {
    app.useStaticAssets(config.webDist, {
      index: false,
      setHeaders: (res, path) => {
        // 해시가 붙은 파일만 오래 캐시하고, index.html·서비스 워커·매니페스트는 매번 확인한다.
        res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/s/') || req.path === '/health' || /\.[a-z0-9]+$/i.test(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    });
  } else {
    Logger.warn(`웹 빌드가 없습니다(${config.webDist}). API만 엽니다.`, 'Bootstrap');
  }

  await app.listen(config.port, '0.0.0.0');
  Logger.log(`쌤보드가 ${config.publicUrl} (포트 ${config.port})에서 실행 중입니다.`, 'Bootstrap');
}

bootstrap().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
