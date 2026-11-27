import { HttpException, Injectable } from '@nestjs/common';
import type { UserRow } from '../auth/auth.types';
import { decrypt, encrypt } from '../common/crypto';
import { bad } from '../common/http';
import { config } from '../config';
import { Db } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { LlmAdapter, LlmUsage } from './adapter';
import { AnthropicAdapter } from './anthropic.adapter';
import { costUsd } from './pricing';

export interface LlmContext {
  adapter: LlmAdapter;
  apiKey: string;
  model: string;
}

/** API 키 보관, 비용 한도(USR-5), 사용량 기록(LLM-9)을 맡는다. LLM 호출은 반드시 서버를 거친다. */
@Injectable()
export class LlmService {
  private readonly adapters = new Map<string, LlmAdapter>([['anthropic', new AnthropicAdapter()]]);

  constructor(
    private readonly db: Db,
    private readonly notifications: NotificationsService,
  ) {}

  /** 제공자 어댑터를 더하거나 바꿔 끼운다(Phase 1.5의 OpenAI·Gemini, 테스트용 가짜 어댑터). */
  register(adapter: LlmAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  /** 호출에 필요한 어댑터·키·모델을 준비한다. 키가 없거나 한도를 넘었으면 여기서 멈춘다. */
  async context(user: UserRow): Promise<LlmContext> {
    const adapter = this.adapters.get(user.llm_provider);
    if (!adapter) bad(`아직 지원하지 않는 제공자입니다: ${user.llm_provider}`);
    const row = await this.db.one<{ key_encrypted: string }>('select key_encrypted from api_keys where user_id = $1 and provider = $2', [user.id, user.llm_provider]);
    if (!row) bad('설정에서 LLM API 키를 먼저 등록하세요.');
    await this.assertBudget(user);
    return { adapter: adapter!, apiKey: decrypt(row!.key_encrypted, config.masterKey), model: user.llm_model };
  }

  async monthCost(user: Pick<UserRow, 'id' | 'timezone'>): Promise<number> {
    const row = await this.db.one<{ cost: number }>(
      `select coalesce(sum(cost_usd), 0)::float8 as cost from llm_runs
        where user_id = $1 and created_at >= date_trunc('month', now() at time zone $2::text) at time zone $2::text`,
      [user.id, user.timezone],
    );
    return row?.cost ?? 0;
  }

  /** 100%에서 AI 호출을 멈춘다. 서버가 강제한다(5장 비용). */
  async assertBudget(user: UserRow): Promise<void> {
    const budget = Number(user.monthly_budget);
    if ((await this.monthCost(user)) >= budget) {
      throw new HttpException({ message: `이번 달 비용 한도($${budget})에 도달해 AI 호출을 멈췄습니다. 설정에서 한도를 바꿀 수 있습니다.` }, 402);
    }
  }

  /** 호출마다 토큰과 예상 비용을 기록하고, 80%를 넘으면 알린다(NTF-1). */
  async record(user: UserRow, purpose: 'chat' | 'extract' | 'schedule', model: string, usage: LlmUsage): Promise<void> {
    await this.db.query('insert into llm_runs(user_id, provider, model, purpose, input_tokens, output_tokens, cost_usd) values ($1, $2, $3, $4, $5, $6, $7)', [
      user.id,
      user.llm_provider,
      model,
      purpose,
      usage.input_tokens,
      usage.output_tokens,
      costUsd(model, usage),
    ]);
    const budget = Number(user.monthly_budget);
    const spent = await this.monthCost(user);
    if (budget > 0 && spent >= budget * 0.8) {
      const month = new Intl.DateTimeFormat('sv-SE', { timeZone: user.timezone, year: 'numeric', month: '2-digit' }).format(new Date());
      const key = `budget80:${month}`;
      const exists = await this.db.one('select 1 as hit from notifications where user_id = $1 and dedupe_key = $2', [user.id, key]);
      if (!exists) {
        await this.notifications.notify(user.id, {
          source: 'system',
          title: '이번 달 AI 비용이 한도의 80%를 넘었습니다',
          body: `$${spent.toFixed(2)} / $${budget}. 100%가 되면 AI 호출이 멈춥니다.`,
          priority: 'urgent',
          dedupe_key: key,
        });
      }
    }
  }

  async saveKey(userId: string, provider: string, key: string): Promise<void> {
    if (!this.adapters.has(provider)) bad(`아직 지원하지 않는 제공자입니다: ${provider}`);
    const trimmed = key.trim();
    if (trimmed.length < 20 || /\s/.test(trimmed)) bad('API 키 형식이 올바르지 않습니다.');
    await this.db.query(
      `insert into api_keys(user_id, provider, key_encrypted, last4) values ($1, $2, $3, $4)
       on conflict (user_id, provider) do update set key_encrypted = excluded.key_encrypted, last4 = excluded.last4, updated_at = now()`,
      [userId, provider, encrypt(trimmed, config.masterKey), trimmed.slice(-4)],
    );
  }

  /** 화면에는 끝 4자리만 보여 준다(USR-2a). */
  keys(userId: string): Promise<{ provider: string; last4: string }[]> {
    return this.db.query('select provider, last4 from api_keys where user_id = $1 order by provider', [userId]);
  }

  /** 월별 토큰 사용량과 예상 비용(LLM-9). 최근 6개월. */
  usage(user: Pick<UserRow, 'id' | 'timezone'>): Promise<{ month: string; cost_usd: number; input_tokens: number; output_tokens: number }[]> {
    return this.db.query(
      `select to_char(date_trunc('month', created_at at time zone $2::text), 'YYYY-MM') as month,
              sum(cost_usd)::float8 as cost_usd, sum(input_tokens)::int as input_tokens, sum(output_tokens)::int as output_tokens
         from llm_runs where user_id = $1 and created_at >= now() - interval '6 months'
        group by 1 order by 1 desc`,
      [user.id, user.timezone],
    );
  }
}
