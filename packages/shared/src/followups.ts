/*
 * 완료 뒤 남은 일(2026-11-28 세 모델 토론 1번): "앱에서 끝남"과 "업무가 끝남"이 다른 곳을 처리 결과마다 짚는다.
 * 화면(처리 결과 카드)과 AI 도구(list_followups)가 같은 규칙을 쓴다. 확인할 수 있는 것만 말한다(추측하지 않는다).
 */
import type { CommandDto } from './types';

export interface FollowUp {
  kind: 'approve' | 'download' | 'snapshot' | 'external' | 'retry';
  text: string;
  /** 파일 받기면 파일 id */
  file_id?: string;
  /** 못 한 것 다시 시키기면 AI 에게 보낼 말 */
  prompt?: string;
}

export function followUps(cmd: CommandDto, now = Date.now()): FollowUp[] {
  const out: FollowUp[] = [];
  if (cmd.status === 'proposed') return [{ kind: 'approve', text: '승인해야 보드에 반영돼요' }];
  if (cmd.status === 'cancelled') return out;
  const applied = cmd.status === 'applied' || cmd.status === 'applying';
  if (applied)
    for (const f of cmd.files ?? []) {
      if (f.gone || f.downloaded) continue;
      if (f.expires_at && Date.parse(f.expires_at) < now) continue;
      out.push({ kind: 'download', text: `"${f.name}" 아직 안 받음${f.expires_at ? ' — 하루 지나면 지워져요' : ''}`, file_id: f.id });
    }
  if (applied)
    for (const s of cmd.shares ?? []) {
      if (s.revoked || !s.snapshot) continue;
      out.push({ kind: 'snapshot', text: `공유 "${s.title}"는 만든 때의 사본 — 보드를 고쳤으면 다시 공유하세요` });
    }
  // 바깥(구글)에 만든 것은 쌤보드 되돌리기로 지워지지 않는다
  if (cmd.steps.some((s) => s.tool === 'create_form'))
    out.push({ kind: 'external', text: cmd.status === 'undone' ? '되돌렸지만 구글 설문지는 구글 드라이브에 남아 있어요' : '구글 설문 — 응답을 다 받았으면 구글 설문에서 응답 받기를 끄세요' });
  if (applied && (cmd.skipped?.length ?? 0) > 0)
    out.push({ kind: 'retry', text: `하지 못한 것 ${cmd.skipped!.length}건`, prompt: `방금 처리에서 하지 못한 것을 다시 해 줘: ${cmd.skipped!.join(' / ')}` });
  return out;
}
