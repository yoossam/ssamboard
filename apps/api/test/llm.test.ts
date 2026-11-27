import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnthropicAdapter, sseEvents, StreamAccumulator } from '../src/llm/anthropic.adapter';
import { costUsd } from '../src/llm/pricing';

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
      assert.deepEqual(turn.usage, { input_tokens: 472, output_tokens: 89 });
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
});
