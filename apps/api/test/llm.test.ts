import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnthropicAdapter, sseEvents, StreamAccumulator } from '../src/llm/anthropic.adapter';
import { costUsd } from '../src/llm/pricing';
import { OpenAiAdapter, ResponsesAccumulator, toInput } from '../src/llm/openai.adapter';

// 문서(build-with-claude/streaming)의 예시 스트림을 줄여 쓴 것이다.
const TOOL_STREAM = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5","stop_sequence":null,"usage":{"input_tokens":472,"output_tokens":2},"content":[],"stop_reason":null}}',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  'event: ping\ndata: {"type": "ping"}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"날씨를"}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" 확인할게요."}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
  'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"get_weather","input":{}}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\":"}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":" \\"서울\\"}"}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}',
  'event: future_event\ndata: {"type":"future_event","anything":1}',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":89}}',
  'event: message_stop\ndata: {"type":"message_stop"}',
].join('\n\n');

const THINKING_STREAM = [
  'event: message_start\r\ndata: {"type": "message_start", "message": {"id": "msg_2", "type": "message", "role": "assistant", "content": [], "model": "claude-opus-5-5", "stop_reason": null}}',
  'event: content_block_start\r\ndata: {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": "", "signature": ""}}',
  'event: content_block_delta\r\ndata: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "1071 = 2 × 462 + 147"}}',
  'event: content_block_delta\r\ndata: {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "EqQBCgIYAhIM"}}',
  'event: content_block_stop\r\ndata: {"type": "content_block_stop", "index": 0}',
  'event: content_block_start\r\ndata: {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}',
  'event: content_block_delta\r\ndata: {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "21입니다."}}',
  'event: content_block_stop\r\ndata: {"type": "content_block_stop", "index": 1}',
  'event: message_delta\r\ndata: {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": null}}',
  'event: message_stop\r\ndata: {"type": "message_stop"}',
].join('\r\n\r\n');

/** 글자 중간(한글 바이트 포함)에서 잘리도록 작은 조각으로 나눠 흘려보낸다. */
async function* chunks(text: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(text + '\n\n');
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}

async function collect(text: string, size: number) {
  const acc = new StreamAccumulator();
  const seen: string[] = [];
  for await (const event of sseEvents(chunks(text, size))) acc.push(event, (d) => seen.push(d));
  return { turn: acc.result(), seen };
}

describe('Claude 스트림 해석', () => {
  it('글자와 도구 호출을 모은다', async () => {
    for (const size of [7, 64, 100_000]) {
      const { turn, seen } = await collect(TOOL_STREAM, size);
      assert.equal(turn.text, '날씨를 확인할게요.');
      assert.deepEqual(seen, ['날씨를', ' 확인할게요.']);
      assert.deepEqual(turn.toolCalls, [{ id: 'toolu_01', name: 'get_weather', input: { location: '서울' } }]);
      assert.equal(turn.stopReason, 'tool_use');
      assert.deepEqual(turn.usage, { input_tokens: 472, output_tokens: 89, cache_read_tokens: 0, cache_write_tokens: 0 });
      assert.deepEqual(turn.content[1], { type: 'tool_use', id: 'toolu_01', name: 'get_weather', input: { location: '서울' } });
    }
  });
  it('생각 블록은 서명과 함께 그대로 보존한다', async () => {
    const { turn } = await collect(THINKING_STREAM, 11);
    assert.deepEqual(turn.content[0], { type: 'thinking', thinking: '1071 = 2 × 462 + 147', signature: 'EqQBCgIYAhIM' });
    assert.equal(turn.text, '21입니다.');
    assert.equal(turn.stopReason, 'end_turn');
    assert.deepEqual(turn.toolCalls, []);
  });
  it('스트림 안의 오류 이벤트는 예외로 바꾼다', async () => {
    const acc = new StreamAccumulator();
    assert.throws(() => acc.push({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), /바쁩니다/);
  });
  it('도구 결과 메시지는 tool_result 블록으로 만든다', () => {
    const message = new AnthropicAdapter().toolResults([
      { id: 'toolu_01', content: '{"ok":true}' },
      { id: 'toolu_02', content: '없는 표입니다.', isError: true },
    ]);
    assert.deepEqual(message, {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_01', content: '{"ok":true}' },
        { type: 'tool_result', tool_use_id: 'toolu_02', content: '없는 표입니다.', is_error: true },
      ],
    });
  });
  it('토큰 수로 예상 비용을 계산한다', () => {
    assert.equal(costUsd('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 }), 3);
    assert.equal(costUsd('claude-opus-5-5', { input_tokens: 500_000, output_tokens: 0 }), 2);
    assert.equal(costUsd('unknown-model', { input_tokens: 1000, output_tokens: 1000 }), 0);
  });
  it('캐시 읽기·저장도 가격에 넣는다(2026-11-28 문서 값)', () => {
    // Sonnet 5.5: 캐시 읽기 $0.10, 5분 저장 $2.50 / 백만
    assert.equal(costUsd('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_read_tokens: 1_000_000, cache_write_tokens: 0 }), 0.1);
    assert.equal(costUsd('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 1_000_000 }), 2.5);
    assert.equal(costUsd('gpt-6.2-sol', { input_tokens: 0, output_tokens: 0, cache_read_tokens: 1_000_000 }), 0.1);
  });
  it('스트림에서 캐시 토큰을 읽는다', () => {
    const acc = new StreamAccumulator();
    acc.push({ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 } } });
    acc.push({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } });
    assert.deepEqual(acc.result().usage, { input_tokens: 10, output_tokens: 20, cache_read_tokens: 900, cache_write_tokens: 50 });
  });
});

// GPT(OpenAI Responses API) — 문서의 이벤트 이름으로 만든 스트림
const GPT_STREAM = [
  'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","status":"in_progress","output":[]}}',
  'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"id":"rs_1","type":"reasoning","summary":[]}}',
  'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"id":"rs_1","type":"reasoning","summary":[],"encrypted_content":"gAAA"}}',
  'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":1,"content_index":0,"delta":"날씨를"}',
  'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":1,"content_index":0,"delta":" 볼게요."}',
  'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","output_index":2,"delta":"{\\"location\\":"}',
  'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":300,"output_tokens":40},"output":[{"id":"rs_1","type":"reasoning","summary":[],"encrypted_content":"gAAA"},{"id":"msg_1","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"날씨를 볼게요.","annotations":[]}]},{"id":"fc_1","type":"function_call","call_id":"call_9","name":"get_weather","arguments":"{\\"location\\":\\"서울\\"}","status":"completed"}]}}',
].join('\n\n');

describe('GPT(Responses API) 연결', () => {
  it('글자·도구 호출·사용량을 모은다', async () => {
    for (const size of [5, 100_000]) {
      const acc = new ResponsesAccumulator();
      const seen: string[] = [];
      for await (const event of sseEvents(chunks(GPT_STREAM, size))) acc.push(event, (d) => seen.push(d));
      const turn = acc.result();
      assert.deepEqual(seen, ['날씨를', ' 볼게요.']);
      assert.equal(turn.text, '날씨를 볼게요.');
      assert.deepEqual(turn.toolCalls, [{ id: 'call_9', name: 'get_weather', input: { location: '서울' } }]);
      assert.equal(turn.stopReason, 'tool_use');
      assert.deepEqual(turn.usage, { input_tokens: 300, output_tokens: 40, cache_read_tokens: 0, cache_write_tokens: 0 });
      assert.equal(turn.content.length, 3);
    }
  });
  it('다음 요청 입력: 추론 항목은 그대로, 나머지는 id 를 떼고, 도구 결과·이미지·PDF 는 Responses 모양으로', async () => {
    const acc = new ResponsesAccumulator();
    for await (const event of sseEvents(chunks(GPT_STREAM, 64))) acc.push(event);
    const turn = acc.result();
    const input = toInput([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
          { type: 'document', title: 'a.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'BBB' } },
          { type: 'text', text: '봐 줘' },
        ],
      },
      { role: 'assistant', content: turn.content },
      new OpenAiAdapter().toolResults([
        { id: 'call_9', content: '{"temp":3}' },
        { id: 'call_8', content: '없음', isError: true },
      ]),
      { role: 'assistant', content: '옛 답' },
    ]);
    assert.deepEqual(input[0], {
      role: 'user',
      content: [
        { type: 'input_image', image_url: 'data:image/png;base64,AAA' },
        { type: 'input_file', filename: 'a.pdf', file_data: 'data:application/pdf;base64,BBB' },
        { type: 'input_text', text: '봐 줘' },
      ],
    });
    assert.deepEqual(input[1], { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'gAAA' });
    assert.equal(input[2].id, undefined);
    assert.equal(input[2].type, 'message');
    assert.deepEqual(input[3], { type: 'function_call', call_id: 'call_9', name: 'get_weather', arguments: '{"location":"서울"}', status: 'completed' });
    assert.deepEqual(input[4], { type: 'function_call_output', call_id: 'call_9', output: '{"temp":3}' });
    assert.deepEqual(input[5], { type: 'function_call_output', call_id: 'call_8', output: '오류: 없음' });
    assert.deepEqual(input[6], { role: 'assistant', content: '옛 답' });
  });
  it('도구 없이 끝나면 end_turn, 실패 이벤트는 예외', () => {
    const acc = new ResponsesAccumulator();
    acc.push({
      type: 'response.completed',
      response: { status: 'completed', usage: { input_tokens: 1, output_tokens: 2 }, output: [{ type: 'message', content: [{ type: 'output_text', text: '네' }] }] },
    });
    assert.equal(acc.result().stopReason, 'end_turn');
    assert.equal(acc.result().text, '네');
    assert.throws(() => new ResponsesAccumulator().push({ type: 'response.failed', response: { error: { message: 'boom' } } }), /GPT 요청이 실패/);
  });
  it('요청 모양: 도구·지시문·store false, 키는 Bearer', async () => {
    const seen: any[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: any) => {
      seen.push({ url, init });
      return new Response(GPT_STREAM + '\n\n', { status: 200 });
    }) as typeof fetch;
    try {
      const turn = await new OpenAiAdapter().stream({
        apiKey: 'sk-test',
        model: 'gpt-6.2-sol',
        system: '지시',
        messages: [{ role: 'user', content: '안녕' }],
        tools: [{ name: 'get_weather', description: 'd', input_schema: { type: 'object', properties: {} } }],
      });
      assert.equal(turn.toolCalls[0].name, 'get_weather');
    } finally {
      globalThis.fetch = orig;
    }
    const body = JSON.parse(seen[0].init.body);
    assert.match(seen[0].url, /\/v1\/responses$/);
    assert.equal(seen[0].init.headers.authorization, 'Bearer sk-test');
    assert.equal(body.instructions, '지시');
    assert.equal(body.store, false);
    assert.deepEqual(body.include, ['reasoning.encrypted_content']);
    assert.deepEqual(body.tools[0], { type: 'function', name: 'get_weather', description: 'd', parameters: { type: 'object', properties: {} }, strict: false });
    assert.deepEqual(body.input, [{ role: 'user', content: '안녕' }]);
  });
  it('GPT 모델 값도 비용에 들어간다', () => {
    assert.equal(costUsd('gpt-6.2-sol', { input_tokens: 1_000_000, output_tokens: 100_000 }), 3);
  });
  it('GPT 의 캐시 읽기는 입력에서 떼어 센다', () => {
    const acc = new ResponsesAccumulator();
    acc.push({ type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 1000, output_tokens: 5, input_tokens_details: { cached_tokens: 800 } } } });
    assert.deepEqual(acc.result().usage, { input_tokens: 200, output_tokens: 5, cache_read_tokens: 800, cache_write_tokens: 0 });
  });
});
