import { Fragment } from 'react';

// AI 출력과 메모를 그리는 곳(ONE-12).
// HTML로 해석하지 않고 글자로만 그린다. 이미지·iframe·스크립트는 만들지 않는다.
// 링크는 주소가 그대로 보이는 일반 링크로만 표시하고, 미리 불러오지 않는다.

const URL_RE = /(https?:\/\/[^\s<>"'`)\]]+)/g;
const BOLD_RE = /(\*\*[^*\n]+\*\*)/g;

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent underline">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part.split(BOLD_RE).map((p, j) => (j % 2 === 1 ? <strong key={j}>{p.slice(2, -2)}</strong> : <Fragment key={j}>{p}</Fragment>))}</Fragment>
        ),
      )}
    </>
  );
}

export function SafeText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`text-sm leading-relaxed break-words whitespace-pre-wrap ${className ?? ''}`}>
      <Inline text={text} />
    </div>
  );
}

/**
 * 진행 기록처럼 마크다운 꼴로 적힌 글을 읽기 좋게(2026-11-28 담당 사업 크게 보기).
 * 제목(#~###)·목록(-·*·1.)·들여쓰기·가로줄(---)·굵게·링크만. HTML 로 해석하지 않는다(SafeText 와 같은 원칙).
 */
export function NoteText({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return (
    <div className={`text-[15px] leading-relaxed break-words ${className ?? ''}`}>
      {lines.map((raw, i) => {
        const line = raw.replace(/\t/g, '    ');
        const indent = Math.min(4, Math.floor((line.match(/^ */)?.[0].length ?? 0) / 2));
        const t = line.trim();
        if (!t) return <div key={i} className="h-2" />;
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return <hr key={i} className="my-3 border-rule" />;
        const h = t.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
          const level = h[1]!.length;
          const cls = level === 1 ? 'mt-4 text-xl font-bold' : level === 2 ? 'mt-3 text-lg font-bold' : 'mt-2 text-base font-bold text-accent';
          return (
            <p key={i} className={cls}>
              <Inline text={h[2]!} />
            </p>
          );
        }
        const li = t.match(/^([-*•]|\d+[.)])\s+(.*)$/);
        if (li)
          return (
            <div key={i} className="flex gap-2" style={{ paddingLeft: `${indent * 1.25}rem` }}>
              <span className="shrink-0 text-sub">{/\d/.test(li[1]!) ? li[1] : '•'}</span>
              <span className="min-w-0">
                <Inline text={li[2]!} />
              </span>
            </div>
          );
        return (
          <p key={i} style={{ paddingLeft: `${indent * 1.25}rem` }}>
            <Inline text={t} />
          </p>
        );
      })}
    </div>
  );
}
