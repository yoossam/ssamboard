#!/usr/bin/env node
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import { createInterface } from 'node:readline';
import { PASSWORD_MAX, PASSWORD_MIN, PIN_RE } from '../auth/auth.types';
import { config } from '../config';
import { runMigrations } from '../db/db.service';

// 서버 콘솔 명령. PIN 재설정은 웹이 아니라 여기서만 한다(AUTH-10).
//   jarvis migrate              DB 구조를 최신으로 맞춘다
//   jarvis reset-pin <email>    새 PIN을 콘솔에서 직접 입력해 바꾸고 모든 세션을 끝낸다
//   jarvis allow <email>        로그인 허용 목록에 이메일을 더한다
//   jarvis sessions <email>     살아 있는 세션(기기) 목록
//   jarvis set-password <email> 암호 로그인 계정을 만들거나 암호를 바꾸고 모든 세션을 끝낸다(암호를 잊었을 때, 설치 코드 없이 처음 계정 만들기)

/** 화면에 보이지 않게 한 줄을 입력받는다. 터미널이 아니면(파이프 등) 그대로 읽는다. */
function ask(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (hidden && process.stdin.isTTY) {
      const out = rl as unknown as { _writeToOutput: (s: string) => void };
      let prompted = false;
      out._writeToOutput = (s: string) => {
        if (!prompted) {
          process.stdout.write(s);
          prompted = true;
        } else if (s.includes('\n') || s.includes('\r')) {
          process.stdout.write('\n');
        }
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function resetPin(pool: Pool, email: string): Promise<void> {
  const user = (await pool.query('select id, email from users where lower(email) = lower($1)', [email])).rows[0];
  if (!user) throw new Error(`사용자를 찾을 수 없습니다: ${email} (한 번도 로그인하지 않았다면 먼저 로그인해 PIN을 등록하세요)`);
  const pin = await ask('새 PIN(숫자 6자리): ', true);
  if (!PIN_RE.test(pin)) throw new Error('PIN은 숫자 6자리여야 합니다.');
  const again = await ask('한 번 더 입력: ', true);
  if (pin !== again) throw new Error('두 번 입력한 PIN이 다릅니다.');
  const hash = await argon2.hash(pin, { type: argon2.argon2id });
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('update users set pin_hash = $2, pin_fail_count = 0, pin_locked_until = null where id = $1', [user.id, hash]);
    const revoked = await client.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [user.id]);
    await client.query(`insert into audit_logs(user_id, action, target, ip) values ($1, 'pin.reset.console', $2, 'console')`, [user.id, user.email]);
    await client.query('commit');
    console.log(`PIN을 변경했고, 세션 ${revoked.rowCount ?? 0}개를 모두 끝냈습니다. 다시 로그인한 뒤 새 PIN으로 잠금을 푸세요.`);
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** 암호 로그인 계정의 암호를 콘솔에서 정한다. 계정이 없으면 만든다. 바꾸면 모든 세션을 끝낸다. */
async function setPassword(pool: Pool, emailInput: string): Promise<void> {
  const email = emailInput.trim().toLowerCase();
  const first = await ask(`새 암호(${PASSWORD_MIN}자 이상): `, true);
  if ([...first].length < PASSWORD_MIN || [...first].length > PASSWORD_MAX) throw new Error(`암호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자입니다.`);
  const again = await ask('한 번 더: ', true);
  if (first !== again) throw new Error('두 암호가 다릅니다.');
  const hash = await argon2.hash(first, { type: argon2.argon2id });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const user = (
      await client.query(
        `insert into users(email, password_hash) values ($1, $2)
         on conflict (email) do update set password_hash = excluded.password_hash, password_fail_count = 0, password_locked_until = null
         returning id`,
        [email, hash],
      )
    ).rows[0];
    await client.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [user.id]);
    await client.query('commit');
    console.log(`${email} 의 암호를 정했습니다. 모든 기기에서 다시 로그인해야 합니다.`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });
  try {
    if (command === 'migrate') {
      const applied = await runMigrations(pool);
      console.log(applied.length > 0 ? `적용: ${applied.join(', ')}` : '이미 최신입니다.');
    } else if (command === 'reset-pin' && arg) {
      await resetPin(pool, arg);
    } else if (command === 'allow' && arg) {
      await pool.query('insert into allowed_emails(email) values (lower($1)) on conflict (email) do nothing', [arg]);
      console.log(`허용 목록에 더했습니다: ${arg.toLowerCase()}`);
    } else if (command === 'sessions' && arg) {
      const rows = (
        await pool.query(
          `select s.device_name, s.locked, s.last_active_at from sessions s join users u on u.id = s.user_id
            where lower(u.email) = lower($1) and s.revoked_at is null and s.expires_at > now() order by s.last_active_at desc`,
          [arg],
        )
      ).rows;
      if (rows.length === 0) console.log('살아 있는 세션이 없습니다.');
      for (const r of rows) console.log(`${r.device_name}\t${r.locked ? '잠김' : '열림'}\t${r.last_active_at.toISOString()}`);
    } else if (command === 'set-password' && arg) {
      await setPassword(pool, arg);
    } else {
      console.log('사용법:\n  jarvis migrate\n  jarvis reset-pin <email>\n  jarvis set-password <email>\n  jarvis allow <email>\n  jarvis sessions <email>');
      process.exitCode = command ? 1 : 0;
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`오류: ${e?.message ?? e}`);
  process.exit(1);
});
