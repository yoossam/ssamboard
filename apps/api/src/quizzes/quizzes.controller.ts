import { Body, Controller, Delete, Get, Param, Post, Req, Res } from '@nestjs/common';
import { cleanAnswers, type QuizDto, type QuizStats } from '@jarvis/shared';
import type { Request, Response } from 'express';
import { Auth, Public, type AuthCtx } from '../auth/auth.types';
import { uuid } from '../common/http';
import { config } from '../config';
import { renderQuizDone, renderQuizMessage, renderQuizPage } from './quiz-page';
import { QuizzesService } from './quizzes.service';

/** 교사가 보는 퀴즈(로그인) — 집계·마감·다시 열기·링크 바꾸기·응답 숨기기·비우기 */
@Controller('quizzes')
export class QuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Get()
  list(@Auth() ctx: AuthCtx): Promise<QuizDto[]> {
    return this.quizzes.list(ctx.user.id);
  }

  @Get(':id/stats')
  stats(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<QuizStats> {
    return this.quizzes.stats(ctx.user.id, uuid(id));
  }

  @Post(':id/close')
  close(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<QuizDto> {
    return this.quizzes.setStatus(ctx.user.id, uuid(id), 'closed');
  }

  @Post(':id/open')
  open(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<QuizDto> {
    return this.quizzes.setStatus(ctx.user.id, uuid(id), 'open');
  }

  /** 구글 설문 퀴즈의 응답 읽기 */
  @Post(':id/sync')
  sync(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ added: number; quiz: QuizDto }> {
    return this.quizzes.sync(ctx.user.id, uuid(id));
  }

  @Post(':id/rotate')
  rotate(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<QuizDto> {
    return this.quizzes.rotate(ctx.user.id, uuid(id));
  }

  @Post(':id/responses/:rid/hide')
  async hide(@Auth() ctx: AuthCtx, @Param('id') id: string, @Param('rid') rid: string, @Body() body: any): Promise<{ ok: true }> {
    await this.quizzes.hideResponse(ctx.user.id, uuid(id), uuid(rid, 'rid'), body?.hidden !== false);
    return { ok: true };
  }

  @Delete(':id/responses')
  async clear(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ deleted: number }> {
    return { deleted: await this.quizzes.clearResponses(ctx.user.id, uuid(id)) };
  }
}

/** 이 퀴즈 주소에서 이미 냈다는 표시(알려 주기만 — 태블릿을 돌려 쓰는 반이 있어 막지 않는다) */
const doneCookie = (token: string) => `qd_${token.slice(0, 12)}`;

function send(res: Response, status: number, html: string): void {
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  // same-origin: 바깥으로는 주소를 흘리지 않고, 우리 폼의 POST 에는 Origin 이 제대로 붙는다(no-referrer 면 Origin: null 이 와서 바깥 제출과 가릴 수 없다 — 코덱스 재검토)
  res.setHeader('Referrer-Policy', 'same-origin');
  res.status(status).type('html').send(html);
}

/** 학생이 여는 퀴즈(로그인 없음): GET /q/<열쇠> 폼, POST 로 내기. /api 밖(main.ts 의 접두사 예외). 서버 판에만 있다. */
@Controller('q')
export class PublicQuizController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Public()
  @Get(':token')
  async page(@Param('token') token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const quiz = await this.quizzes.byToken(token);
    if (!quiz) return send(res, 404, renderQuizMessage('퀴즈', '없는 퀴즈입니다. 주소를 다시 확인하세요.'));
    if (!quiz.open) return send(res, 410, renderQuizMessage(quiz.title, '이 퀴즈는 마감됐습니다.'));
    send(res, 200, renderQuizPage(quiz.spec, { already: req.cookies?.[doneCookie(token)] === '1' }));
  }

  @Public()
  @Post(':token')
  async submit(@Param('token') token: string, @Body() body: any, @Req() req: Request, @Res() res: Response): Promise<void> {
    const form = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    // 다른 사이트가 몰래 내게 하는 폼을 막는다(브라우저가 보낸 Origin 이 있으면 우리 주소여야 한다 — 제미나이 검토)
    const origin = req.headers.origin;
    if (origin && origin !== new URL(config.publicUrl).origin) return send(res, 403, renderQuizMessage('퀴즈', '이 주소에서 낸 답만 받습니다.'));
    const r = await this.quizzes.submit(token, String(req.ip ?? ''), form);
    const quiz = await this.quizzes.byToken(token);
    const title = quiz?.title ?? '퀴즈';
    if (r.ok) {
      res.cookie(doneCookie(token), '1', { path: `/q/${token}`, maxAge: 6 * 3600_000, httpOnly: true, sameSite: 'lax', secure: config.cookieSecure });
      return send(res, 200, renderQuizDone(title));
    }
    // 적은 것이 사라지지 않게, 고칠 수 있는 오류(이름·답 없음)는 폼을 다시 보여 준다
    if (r.status === 400 && quiz?.open)
      return send(res, 400, renderQuizPage(quiz.spec, { error: r.message, name: typeof form.name === 'string' ? form.name.slice(0, 20) : '', answers: cleanAnswers(quiz.spec, form) }));
    send(res, r.status, renderQuizMessage(title, r.message));
  }
}
