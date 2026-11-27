// AI 화면 블록(type: view)을 그리는 틀. AI가 쓴 코드는 믿지 않는다(붙여넣은 자료나 설문 응답에 속아 쓴 코드일 수 있다).
//
//   보드(/)  ──  바깥 틀(/api/blocks/:id/frame)  ──  안쪽 틀(/api/blocks/:id/view)  ──  일꾼(Worker, AI 코드)
//
// 지키려는 것: AI 코드는 보드(쿠키·화면·API)에 닿지 못하고, 받은 자료를 바깥 어디로도 보내지 못한다.
//
// 1. AI 코드는 일꾼(Worker) 안에서만 돈다. 일꾼에는 화면(DOM)도 WebRTC 도 없다. 하는 일은 하나다:
//    render(data, size) 가 HTML·SVG 글자를 돌려준다.
// 2. 안쪽 틀에서 실행되는 스크립트는 이 파일의 준비 코드 하나뿐이다(script-src 는 nonce 하나, 인라인 처리기는 막힘).
//    준비 코드는 일꾼이 돌려준 글자를 허용 목록으로 걸러 붙인다. 주소를 가질 수 있는 요소·속성(link, a, img, href, src …)은
//    모두 지운다. 정책(CSP)이 막지 못하는 길(DNS 미리 찾기 같은)이 그런 요소에서 나오기 때문이다.
// 3. 안쪽 틀은 출처가 없는 격리 문서다(CSP sandbox). 요청·그림·양식·틀·새 창이 모두 막혀 있다. 글꼴도 문서 안에 넣어 보내서
//    (data: 주소) 이 문서가 망으로 부를 것이 하나도 없다. 글꼴을 서버에서 받게 두면 그 주소 뒤에 자료를 실어 보낼 수 있다.
// 4. 바깥 틀은 스크립트가 없는 빈 문서다. 안쪽 틀이 스스로 다른 주소로 옮겨 가는 것을 막는다. 틀이 어디로 옮겨 갈 수 있는지는
//    그 틀을 품은 문서의 frame-src 가 정하는데, 보드의 frame-src 에는 Google 주소(시트 고르기 창)가 들어 있기 때문이다.
// 5. 자료는 보드가 안쪽 틀에 postMessage 로 넣어 준다. AI 코드에는 자료를 적지 않는다.
//
// AI에게 주는 안내(ai.service.ts 의 VIEW_GUIDE)에 적힌 약속(render, size, esc, 색 이름, 쓸 수 있는 요소)은 여기와 같아야 한다.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 화면이 쓰는 색 이름. 보드(styles.css)의 값과 맞춘다. */
export const VIEW_COLOR_VARS = ['--ink', '--sub', '--line', '--rule', '--card', '--ground', '--accent', '--tint', '--danger', '--ok', '--c1', '--c2', '--c3', '--c4', '--c5', '--c6'];

/** 돌려준 글자에서 남기는 요소(소문자로 견준다). 여기 없는 요소는 껍데기만 벗기고 안의 글은 남긴다. */
export const VIEW_TAGS = [
  // 글과 묶음
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'mark', 'sub', 'sup', 'br', 'hr',
  'code', 'pre', 'blockquote', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'details', 'summary', 'time', 'progress', 'meter',
  // 표
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  // 그림(SVG)
  'svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'title', 'desc', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'marker',
];

/**
 * 통째로 지우는 요소. 주소를 부르거나, 코드를 담거나, 다른 문서를 품는 것들이다.
 * 링크(a)·단추(button)·양식(form)은 여기 없다: 껍데기만 벗겨져 안의 글은 남고, 주소나 처리기는 속성 목록에서 걸러진다.
 */
export const VIEW_DROP_TAGS = [
  'script', 'style', 'link', 'meta', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'template', 'noscript', 'img', 'picture', 'source', 'track', 'audio', 'video', 'canvas',
  'input', 'select', 'option', 'textarea', 'area', 'map', 'image', 'use', 'foreignobject', 'animate', 'animatemotion', 'animatetransform', 'set', 'feimage', 'filter', 'math', 'portal',
];

/** 남기는 속성(소문자). 주소를 담는 속성(href, src, action …)과 on* 처리기는 없다. aria-·data- 로 시작하는 것도 남긴다. */
export const VIEW_ATTRS = [
  'class', 'id', 'style', 'title', 'lang', 'dir', 'role', 'hidden', 'open', 'colspan', 'rowspan', 'scope', 'span', 'value', 'max', 'min', 'low', 'high', 'optimum', 'datetime',
  'width', 'height', 'viewbox', 'preserveaspectratio', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'dx', 'dy', 'rotate', 'textlength', 'lengthadjust', 'pathlength',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'transform',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform',
  'spreadmethod', 'fx', 'fy', 'clip-path', 'clip-rule', 'clippathunits', 'mask', 'maskunits', 'marker-start', 'marker-mid', 'marker-end', 'markerwidth', 'markerheight', 'refx', 'refy', 'orient',
  'vector-effect', 'shape-rendering', 'paint-order',
];

/** 일꾼이 한 번 그리는 데 쓸 수 있는 시간(ms). 넘으면 일꾼을 끄고 오류로 알린다. */
export const VIEW_RENDER_TIMEOUT_MS = 3000;
/** 돌려준 글자의 길이 한도. 일꾼 안의 코드는 믿지 않으므로 준비 코드가 다시 잰다. */
export const VIEW_OUTPUT_MAX = 400_000;
/** 붙일 수 있는 요소 수의 한도. */
export const VIEW_NODE_MAX = 20_000;
/** 오류의 종류. 준비 코드가 정한다(일꾼이 준 글자와 달리 믿을 수 있다). 화면의 board/view.tsx 가 이 이름으로 안내 글을 고른다. */
export const VIEW_ERROR_KINDS = ['no_render', 'threw', 'timeout', 'bad_output', 'start'] as const;

/** 보드와 같은 글꼴을 문서 안에 넣을 CSS. 글꼴 파일이 없으면(웹을 빌드하지 않은 개발 환경) 빈 글자를 돌려주고 기기 글꼴로 그린다. */
const fontCssCache = new Map<string, string>();
export function embeddedFontCss(fontDir: string): string {
  const cached = fontCssCache.get(fontDir);
  if (cached !== undefined) return cached;
  let css = '';
  try {
    const face = (file: string, weight: string) => `@font-face{font-family:'A2Z';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${readFileSync(join(fontDir, file)).toString('base64')}) format('woff2')}`;
    css = face('a2z-400.woff2', '1 500') + face('a2z-500.woff2', '501 1000');
  } catch {
    css = '';
  }
  fontCssCache.set(fontDir, css);
  return css;
}

const baseCss = (fontCss: string): string => `
${fontCss}
:root{--ink:#3e481d;--sub:#5a6b2a;--line:#dce3ce;--rule:#e9eddd;--card:#ffffff;--ground:#f0f0e0;--accent:#3e481d;--tint:rgb(62 72 29 / 0.08);--danger:#cc0000;--ok:#3d7a00;--c1:#5a6b2a;--c2:#0f9d8a;--c3:#e08a00;--c4:#b4338a;--c5:#6b4fd8;--c6:#8a94a6}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:'A2Z','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;font-size:14px;line-height:1.5;color:var(--ink);background:var(--card);overflow:auto;-webkit-font-smoothing:antialiased;font-synthesis-weight:none}
#root{min-height:100%}
`;

// 일꾼 안에서 AI 코드 뒤에 붙는 코드. esc() 는 자료를 글자에 끼워 넣을 때 쓰라고 준다.
// AI 코드가 render 를 선언하지 않았으면 그 사실을 알린다. 글자가 아닌 값을 돌려주면 글자로 바꾼다.
const WORKER_TAIL = `
;function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
self.onmessage=function(e){
var m=e.data||{};
function done(out){self.postMessage({seq:m.seq,html:out==null?'':String(out)})}
function oops(err,kind){self.postMessage({seq:m.seq,kind:kind||'threw',error:String((err&&err.message)||err)})}
try{
if(typeof render!=='function'){if(m.expect)oops('render(data, size) 함수가 없습니다.','no_render');else done('');return}
var out=render(m.data,m.size);
if(out&&typeof out.then==='function')out.then(done,oops);else done(out);
}catch(err){oops(err)}
};`;

// 안쪽 틀에서 실행되는 단 하나의 스크립트. 자리표(__CODE__ 등)는 viewDocument 가 채운다.
const BOOTSTRAP = `(function(){
var CODE=__CODE__,CSS=__CSS__,TAIL=__TAIL__;
var KEEP=__KEEP__,DROP=__DROP__,ATTR=__ATTR__,LIMIT=__LIMIT__,OUTMAX=__OUTMAX__,NODEMAX=__NODEMAX__;
var root=document.getElementById('root'),last=null,expect=false,worker=null,seq=0,watch=null,resizeTimer=null;
var EXT=/url\\s*\\((?!\\s*['\"]?\\s*#)/i;
// style 속성은 더 좁게 본다: 글자 바꿔 적기(\\)나 @규칙, 그림을 부르는 함수가 들어 있으면 통째로 지운다.
var STYLEBAD=/\\\\|@|image-set|image\\s*\\(|cross-fade|element\\s*\\(|paint\\s*\\(/i;
var keep={},drop={},attr={};KEEP.forEach(function(t){keep[t]=1});DROP.forEach(function(t){drop[t]=1});ATTR.forEach(function(t){attr[t]=1});
function say(m){try{window.top.postMessage(m,'*')}catch(e){}}
// kind 는 여기서 정한 종류, message 는 일꾼이 준 글자(믿지 않는다)다.
function fail(kind,m){say({type:'ssam:error',kind:kind,message:String(m==null?'':m).slice(0,300)})}
var sheet=document.createElement('style');sheet.textContent=CSS;document.head.appendChild(sheet);

// 허용 목록에 없는 요소는 껍데기를 벗기고, 위험한 요소는 통째로 지우고, 허용하지 않은 속성은 지운다.
function scrub(node){
var kids=Array.prototype.slice.call(node.childNodes);
for(var i=0;i<kids.length;i++){
var k=kids[i];
if(k.nodeType===3)continue;
if(k.nodeType!==1){node.removeChild(k);continue}
var name=k.localName.toLowerCase();
if(drop[name]){node.removeChild(k);continue}
scrub(k);
if(!keep[name]){while(k.firstChild)node.insertBefore(k.firstChild,k);node.removeChild(k);continue}
var names=[];for(var a=0;a<k.attributes.length;a++)names.push(k.attributes[a].name);
for(var n=0;n<names.length;n++){var an=names[n].toLowerCase();
// 남기는 속성이어도 값이 바깥 주소를 가리키면(url(…), 이 문서 안의 #이름 은 빼고) 지운다.
var val=k.getAttribute(names[n])||'';
if(!(attr[an]||an.indexOf('aria-')===0||an.indexOf('data-')===0)||EXT.test(val)||(an==='style'&&STYLEBAD.test(val)))k.removeAttribute(names[n])}
}
}
function show(html){
var doc=new DOMParser().parseFromString('<!doctype html><body>'+html,'text/html');
if(doc.body.getElementsByTagName('*').length>NODEMAX)throw new Error('too many nodes');
scrub(doc.body);
var frag=document.createDocumentFragment();
while(doc.body.firstChild)frag.appendChild(doc.body.firstChild);
root.replaceChildren(frag);
}

function stop(){if(worker){worker.terminate();worker=null}clearTimeout(watch)}
// 그릴 때마다 일꾼을 새로 띄우고, 첫 답을 받는 즉시 끈다. 한 번의 요청에 답은 하나뿐이고,
// 답을 보내 놓고 계속 도는 코드나 답을 여러 번 보내는 코드가 이 문서를 붙잡지 못한다.
function draw(){
if(last===null)return;
stop();
var mine=++seq;
try{worker=new Worker(URL.createObjectURL(new Blob([CODE,'\\n',TAIL],{type:'text/javascript'})))}catch(err){fail('start','');return}
worker.onmessage=function(e){
var m=e.data||{};if(m.seq!==mine||mine!==seq)return;
stop();
if(typeof m.error==='string'){fail(m.kind==='no_render'?'no_render':'threw',m.error);return}
if(typeof m.html!=='string'||m.html.length>OUTMAX){fail('bad_output','');return}
try{show(m.html);say({type:'ssam:drawn'})}catch(err){fail('bad_output','')}
};
worker.onerror=function(e){if(e&&e.preventDefault)e.preventDefault();if(mine!==seq)return;stop();fail('threw',(e&&e.message)||'')};
watch=setTimeout(function(){if(mine!==seq)return;stop();fail('timeout','')},LIMIT);
worker.postMessage({seq:mine,data:last,expect:expect,size:{width:document.documentElement.clientWidth,height:document.documentElement.clientHeight}});
}
window.addEventListener('message',function(e){
if(e.source!==window.top)return;
var m=e.data;if(!m||m.type!=='ssam:data')return;
last=m.data;expect=!!m.expect_render;draw();
});
window.addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(draw,120)});
say({type:'ssam:ready'});
})();`;

/** 글자를 스크립트 안의 값으로 안전하게 적는다(</script> 나 <!-- 로 스크립트를 끊지 못하게 한다). */
const lit = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** 응답마다 새로 만드는 스크립트 표(nonce). */
export const newNonce = (): string => randomBytes(18).toString('base64');

/** 안쪽 틀의 정책. 실행되는 스크립트는 nonce 를 단 준비 코드 하나이고, 망으로 나가는 길은 모두 막는다(글꼴도 문서 안의 data: 뿐). */
export function viewCsp(origin: string, nonce: string): string {
  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    "style-src 'unsafe-inline'",
    // 일꾼은 준비 코드가 만든 blob 주소에서만 뜬다(옛 Safari 는 child-src 를 본다).
    'worker-src blob:',
    'child-src blob:',
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    "frame-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "webrtc 'block'",
    `frame-ancestors ${origin}`,
  ].join('; ');
}

/** 안쪽 틀에 더 붙이는 헤더. 정책(CSP)이 다루지 않는 길(DNS 미리 찾기, 지원하는 브라우저에서는 모든 연결)을 닫는다. */
export const VIEW_EXTRA_HEADERS: Record<string, string> = {
  'X-DNS-Prefetch-Control': 'off',
  // Chrome 152 부터: 이 문서가 맺을 수 있는 연결을 하나도 두지 않는다(WebRTC 도 기본으로 막힌다). 모르는 브라우저는 무시한다.
  'Connection-Allowlist': '()',
};

/** 바깥 틀의 정책. 스크립트가 없고, 품을 수 있는 틀은 이 서버 주소뿐이다. */
export function frameCsp(origin: string): string {
  return ["default-src 'none'", "style-src 'unsafe-inline'", `frame-src ${origin}`, "frame-ancestors 'self'", "base-uri 'none'", "form-action 'none'"].join('; ');
}

/** 안쪽 틀 문서. AI가 쓴 code·css 는 실행되는 자리에 그대로 놓이지 않고, 준비 코드 안의 글자 값으로만 들어간다. */
export function viewDocument(view: { code: string; css: string }, nonce: string, fontCss = ''): string {
  // 자리표는 한 번에 채운다. 차례로 채우면, 먼저 넣은 AI 코드 안에 든 자리표 글자가 다음 차례에 바뀌어 글자 값 밖으로 새어 나온다.
  const values: Record<string, string> = {
    CODE: lit(view.code),
    CSS: lit(view.css),
    TAIL: lit(WORKER_TAIL),
    KEEP: lit(VIEW_TAGS),
    DROP: lit(VIEW_DROP_TAGS),
    ATTR: lit(VIEW_ATTRS),
    LIMIT: String(VIEW_RENDER_TIMEOUT_MS),
    OUTMAX: String(VIEW_OUTPUT_MAX),
    NODEMAX: String(VIEW_NODE_MAX),
  };
  const script = BOOTSTRAP.replace(/__(CODE|CSS|TAIL|KEEP|DROP|ATTR|LIMIT|OUTMAX|NODEMAX)__/g, (_m, key: string) => values[key]);
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${baseCss(fontCss)}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
}

const REV_RE = /^[a-z0-9]{1,32}$/;

/** 바깥 틀 문서. id는 UUID로 확인한 값만 받는다. rev는 화면 코드가 바뀌었을 때 안쪽 틀을 새로 읽게 하는 표시다. */
export function frameDocument(blockId: string, rev: string | undefined): string {
  const query = rev && REV_RE.test(rev) ? `?rev=${rev}` : '';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style>
</head>
<body>
<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="AI 화면" src="/api/blocks/${blockId}/view${query}"></iframe>
</body>
</html>`;
}
