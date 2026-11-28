#!/usr/bin/env node
/*
 * 사용 안내(apps/web/public/guide.html)가 코드의 기능 목록과 맞는지 본다 — npm test 가 맨 먼저 돌린다.
 * 기능 목록: AI 도구(apps/api/src/ai/tools.ts), 블록 종류(packages/shared BLOCK_TYPES), 설정 탭(store.ts SettingsTab).
 * 새 기능이 안내에 없거나(data-feature 표시 없음), 없어진 기능이 안내에 남아 있으면 실패한다.
 * 고치는 법: guide.html 에서 그 기능을 설명하고 그 자리에 data-feature="tool:이름" 처럼 표시를 단다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');

const tools = [...read('apps/api/src/ai/tools.ts').matchAll(/^\s*name: '([a-z_]+)'/gm)].map((m) => `tool:${m[1]}`);
const blockList = /BLOCK_TYPES:[^=]*=\s*\[([^\]]+)\]/.exec(read('packages/shared/src/types.ts'))?.[1] ?? '';
const blocks = [...blockList.matchAll(/'([a-z_]+)'/g)].map((m) => `block:${m[1]}`);
const tabUnion = /type SettingsTab\s*=([^;]+);/.exec(read('apps/web/src/lib/store.ts'))?.[1] ?? '';
const tabs = [...tabUnion.matchAll(/'([a-z_]+)'/g)].map((m) => `tab:${m[1]}`);

const code = new Set([...tools, ...blocks, ...tabs]);
if (tools.length === 0 || blocks.length === 0 || tabs.length === 0) {
  console.error('[안내 검사] 코드에서 기능 목록을 읽지 못했습니다 — scripts/check-guide.mjs 의 읽는 규칙을 고치세요.', { tools: tools.length, blocks: blocks.length, tabs: tabs.length });
  process.exit(1);
}
const guide = new Set([...read('apps/web/public/guide.html').matchAll(/data-feature="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));

const missing = [...code].filter((f) => !guide.has(f));
const stale = [...guide].filter((f) => !code.has(f));
if (missing.length || stale.length) {
  if (missing.length) console.error(`[안내 검사] 사용 안내에 없는 기능: ${missing.join(', ')}`);
  if (stale.length) console.error(`[안내 검사] 코드에 없는데 안내에 남은 기능: ${stale.join(', ')}`);
  console.error('apps/web/public/guide.html 을 기능에 맞게 고치고 data-feature 표시를 맞추세요.');
  process.exit(1);
}
console.log(`[안내 검사] 통과 — 기능 ${code.size}개(AI 도구 ${tools.length}·블록 ${blocks.length}·설정 탭 ${tabs.length})가 모두 안내에 있습니다.`);
