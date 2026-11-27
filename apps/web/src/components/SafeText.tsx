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
