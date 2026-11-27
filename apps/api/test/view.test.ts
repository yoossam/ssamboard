import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VIEW_GUIDE } from '../src/ai/ai.service';
import { embeddedFontCss, frameCsp, frameDocument, newNonce, VIEW_ATTRS, VIEW_COLOR_VARS, VIEW_DROP_TAGS, VIEW_ERROR_KINDS, VIEW_EXTRA_HEADERS, VIEW_NODE_MAX, VIEW_OUTPUT_MAX, VIEW_TAGS, viewCsp, viewDocument } from '../src/boards/view-frame';

const ORIGIN = 'https://board.example.test';
const ID = '11111111-2222-4333-8444-555555555555';
const NONCE = 'testnonce123';

describe('AI 화면 블록의 틀', () => {
  it('안쪽 틀은 격리되고, 실행되는 스크립트는 nonce 를 단 하나뿐이고, 바깥으로 나가는 길이 막혀 있다', () => {
    const csp = viewCsp(ORIGIN, NONCE).split('; ');
    assert.equal(csp[0], 'sandbox allow-scripts');
    for (const need of ["default-src 'none'", `script-src 'nonce-${NONCE}'`, "script-src-attr 'none'", 'worker-src blob:', "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'", "object-src 'none'"])
      assert.ok(csp.includes(need), need);
    assert.ok(csp.includes('img-src data: blob:'));
    assert.ok(csp.includes('font-src data:'));
    assert.ok(csp.includes(`frame-ancestors ${ORIGIN}`));
    // 격리를 푸는 값, 아무 스크립트나 허용하는 값, 바깥 주소를 허용하는 값이 끼어들면 안 된다.
    const all = viewCsp(ORIGIN, NONCE).split(ORIGIN).join('');
    const scriptSrc = csp.find((d) => d.startsWith('script-src '))!;
    assert.ok(!scriptSrc.includes('unsafe-inline') && !scriptSrc.includes('blob:') && !scriptSrc.includes('data:'));
    for (const bad of ['allow-same-origin', 'allow-top-navigation', 'allow-popups', 'allow-forms', 'allow-modals', "'unsafe-eval'", 'https:', ' *']) assert.ok(!all.includes(bad), bad);
    assert.equal(VIEW_EXTRA_HEADERS['X-DNS-Prefetch-Control'], 'off');
    assert.equal(VIEW_EXTRA_HEADERS['Connection-Allowlist'], '()');
  });

  it('nonce 는 부를 때마다 다르다', () => {
    assert.notEqual(newNonce(), newNonce());
    assert.match(newNonce(), /^[A-Za-z0-9+/]{24}$/);
  });

  it('바깥 틀은 스크립트가 없고 이 서버의 틀만 품는다', () => {
    const csp = frameCsp(ORIGIN);
    assert.ok(csp.includes("default-src 'none'"));
    assert.ok(csp.includes(`frame-src ${ORIGIN};`));
    assert.ok(!csp.includes('script-src'));
    const doc = frameDocument(ID, '1abx9z');
    assert.ok(!/<script/i.test(doc));
    assert.ok(doc.includes(`<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="AI 화면" src="/api/blocks/${ID}/view?rev=1abx9z">`));
  });

  it('rev 에 이상한 글자가 오면 붙이지 않는다', () => {
    for (const rev of ['"><script>alert(1)</script>', 'a b', '../x', 'A'.repeat(40), '']) {
      const doc = frameDocument(ID, rev);
      assert.ok(doc.includes(`src="/api/blocks/${ID}/view"`), rev);
      assert.ok(!doc.includes('alert(1)'));
    }
  });

  it('AI 코드는 문서에 실행되는 꼴로 놓이지 않고, 스크립트는 nonce 를 단 하나뿐이다', () => {
    const hostile = '</script><script>window.pwned=1</script><!-- <img src=x onerror=alert(1)> function render(){return ""}';
    const doc = viewDocument({ code: hostile, css: '</style><script>window.pwned=2</script>' }, NONCE);
    const scripts = doc.match(/<script\b[^>]*>/gi) ?? [];
    assert.deepEqual(scripts, [`<script nonce="${NONCE}">`]);
    assert.equal((doc.match(/<\/script>/gi) ?? []).length, 1);
    assert.ok(!doc.includes('<img'));
    assert.ok(doc.includes('\\u003c/script>\\u003cscript>window.pwned=1'));
    // 자료는 맨 위 창(보드)이 보낸 것만 받는다.
    assert.ok(doc.includes('if(e.source!==window.top)return'));
    // 문서가 망으로 부르는 주소가 하나도 없다(글꼴도 문서 안에 넣는다).
    assert.ok(!/https?:\/\//.test(doc.replace(/\\u003c[^"]*/g, '')));
  });

  it('속성 값이 바깥 주소를 가리키는지 가려내는 식은 문서 안의 #이름 만 통과시킨다', () => {
    const doc = viewDocument({ code: '', css: '' }, NONCE);
    const source = /var EXT=(\/.+?\/i);/.exec(doc)?.[1];
    assert.ok(source, '준비 코드에 EXT 식이 있어야 한다');
    const EXT = new Function(`return ${source}`)() as RegExp;
    for (const inside of ['url(#g)', "url('#g')", 'url( "#clip" )', 'fill:url(#a);stroke:red', 'red', 'translate(3 4)']) assert.ok(!EXT.test(inside), inside);
    for (const outside of ['url(https://example.com/a.png)', "background:url('//example.com/x')", 'URL( "http://a" )', 'url(data:image/png;base64,AAAA)', 'url(x.svg#g)']) assert.ok(EXT.test(outside), outside);
  });

  it('AI 코드 안에 틀의 자리표 글자가 들어 있어도 글자 값 밖으로 새지 않는다', () => {
    // 자리표를 차례로 채우면 먼저 넣은 코드 속의 __CSS__ 가 다음 차례에 바뀌어 따옴표가 끊긴다. 한 번에 채우는지 본다.
    const doc = viewDocument({ code: 'var a="__CSS__ __TAIL__ __KEEP__ __OUTMAX__";function render(){return ""}', css: '";window.pwned=3;//' }, NONCE);
    const script = doc.slice(doc.indexOf(`<script nonce="${NONCE}">`) + `<script nonce="${NONCE}">`.length, doc.lastIndexOf('</script>'));
    assert.doesNotThrow(() => new Function(script), '준비 코드가 문법에 맞아야 한다');
    assert.ok(script.includes('var CODE="var a=\\"__CSS__ __TAIL__ __KEEP__ __OUTMAX__\\";function render(){return \\"\\"}",CSS="\\";window.pwned=3;//",TAIL='));
  });

  it('주소를 부를 수 있는 요소와 속성은 남기는 목록에 없다', () => {
    for (const tag of ['script', 'style', 'link', 'meta', 'base', 'img', 'image', 'use', 'iframe', 'object', 'embed', 'input', 'foreignobject', 'animate', 'set', 'audio', 'video', 'canvas']) {
      assert.ok(!VIEW_TAGS.includes(tag), `${tag} 는 남기면 안 된다`);
      assert.ok(VIEW_DROP_TAGS.includes(tag), `${tag} 는 통째로 지워야 한다`);
    }
    // 링크·단추·양식은 껍데기만 벗긴다(남기는 목록에는 없어야 한다).
    for (const tag of ['a', 'button', 'form']) assert.ok(!VIEW_TAGS.includes(tag) && !VIEW_DROP_TAGS.includes(tag), tag);
    for (const attr of VIEW_ATTRS) {
      assert.ok(!/^on/.test(attr), attr);
      assert.ok(!['href', 'xlink:href', 'src', 'srcset', 'action', 'formaction', 'poster', 'background', 'ping', 'data', 'srcdoc', 'rel', 'http-equiv', 'content', 'name', 'target', 'nonce', 'is'].includes(attr), attr);
    }
    assert.equal(new Set(VIEW_TAGS).size, VIEW_TAGS.length);
    assert.ok(VIEW_TAGS.every((t) => t === t.toLowerCase()) && VIEW_DROP_TAGS.every((t) => t === t.toLowerCase()) && VIEW_ATTRS.every((t) => t === t.toLowerCase()));
    assert.ok(VIEW_TAGS.every((t) => !VIEW_DROP_TAGS.includes(t)));
  });

  it('AI 안내에 적힌 약속은 틀에 준비돼 있다', () => {
    const doc = viewDocument({ code: '', css: '' }, NONCE);
    for (const name of VIEW_COLOR_VARS) assert.ok(doc.includes(`${name}:`), name);
    const mentioned = [...VIEW_GUIDE.matchAll(/--[a-z][a-z0-9]*/g)].map((m) => m[0]);
    assert.ok(mentioned.length >= 10);
    for (const name of mentioned) assert.ok(VIEW_COLOR_VARS.includes(name), `${name} 은 안내에만 있고 틀에 없다`);
    assert.ok(VIEW_GUIDE.includes('render(data, size)') && doc.includes('render(m.data,m.size)'));
    assert.ok(VIEW_GUIDE.includes('esc(') && doc.includes('function esc(v)'));
    // 안내에서 쓸 수 있다고 한 요소는 남기는 목록에 있어야 한다.
    for (const tag of ['div', 'span', 'table', 'progress', 'meter', 'details', 'svg', 'rect', 'circle', 'path', 'text', 'tspan', 'title', 'lineargradient', 'clippath']) assert.ok(VIEW_TAGS.includes(tag), tag);
  });

  it('준비 코드는 일꾼을 믿지 않는다: 길이·요소 수를 다시 재고, 한 번 그릴 때 답을 하나만 받는다', () => {
    const doc = viewDocument({ code: 'function render(){return ""}', css: '' }, NONCE);
    assert.ok(doc.includes(`OUTMAX=${VIEW_OUTPUT_MAX}`) && doc.includes(`NODEMAX=${VIEW_NODE_MAX}`));
    assert.ok(doc.includes('m.html.length>OUTMAX'));
    assert.ok(doc.includes(".length>NODEMAX"));
    // 답을 받자마자 일꾼을 끄고(stop), 지난 요청의 답은 버린다.
    assert.ok(/if\(m\.seq!==mine\|\|mine!==seq\)return;\s*stop\(\);/.test(doc));
    for (const kind of VIEW_ERROR_KINDS) assert.ok(doc.includes(`'${kind}'`), kind);
  });

  it('글꼴은 파일이 있으면 문서 안에 넣고, 없으면 비워 둔다', () => {
    assert.equal(embeddedFontCss('/no/such/dir'), '');
    const css = embeddedFontCss(new URL('../../web/public/fonts', import.meta.url).pathname);
    assert.ok(css.startsWith("@font-face{font-family:'A2Z'") && css.includes('src:url(data:font/woff2;base64,') && !css.includes('http'));
    assert.equal((css.match(/@font-face/g) ?? []).length, 2);
  });
});
