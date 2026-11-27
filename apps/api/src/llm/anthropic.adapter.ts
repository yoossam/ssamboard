import { config } from '../config';
import { LlmError, type LlmAdapter, type LlmBlock, type LlmJsonRequest, type LlmMessage, type LlmStreamRequest, type LlmToolResult, type LlmTurn, type LlmUsage } from './adapter';

// Claude Messages API를 SDK 없이 HTTP로 직접 부른다(어댑터 뒤에 감춰 두어 제공자를 바꾸기 쉽게 한다).
// 요청·스트림 형식은 2026-11-25에 platform.claude.com 문서에서 확인했다:
//  - 헤더 anthropic-version: 2026-10-21
//  - 최신 모델은 도구 강제 호출(tool_choice any/tool)을 받지 않으므로 기본값(auto)만 쓴다.
//  - 정해진 JSON 모양은 output_config.format(json_schema)으로 받는다.

const API_VERSION = '2026-10-21';

/** SSE 본문을 이벤트(JSON) 단위로 잘라 준다. */
export async function* sseEvents(body: AsyncIterable<Uint8Array>): AsyncGenerator<any> {
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (chunk: string): any | null => {
    const data = chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  };
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    for (let cut = buffer.search(/\r?\n\r?\n/); cut >= 0; cut = buffer.search(/\r?\n\r?\n/)) {
      const event = parse(buffer.slice(0, cut));
      buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '');
      if (event) yield event;
    }
  }
  const last = parse(buffer);
  if (last) yield last;
}

/** 스트림 이벤트를 모아 최종 응답을 만든다. 모르는 이벤트·델타는 무시한다(문서의 권고). */
export class StreamAccumulator {
  private readonly blocks: LlmBlock[] = [];
  private readonly partialJson = new Map<number, string>();
  private stopReason = '';
  private readonly usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };

  push(event: any, onText?: (delta: string) => void): void {
    switch (event?.type) {
      case 'message_start':
        this.usage.input_tokens = event.message?.usage?.input_tokens ?? 0;
        this.usage.output_tokens = event.message?.usage?.output_tokens ?? 0;
        break;
      case 'content_block_start':
        this.blocks[event.index] = { ...event.content_block };
        if (event.content_block?.type === 'tool_use') this.partialJson.set(event.index, '');
        break;
      case 'content_block_delta': {
        const block = this.blocks[event.index];
        const delta = event.delta;
        if (!block || !delta) break;
        if (delta.type === 'text_delta') {
          block.text = String(block.text ?? '') + delta.text;
          onText?.(delta.text);
        } else if (delta.type === 'input_json_delta') {
          this.partialJson.set(event.index, (this.partialJson.get(event.index) ?? '') + delta.partial_json);
        } else if (delta.type === 'thinking_delta') {
          block.thinking = String(block.thinking ?? '') + delta.thinking;
        } else if (delta.type === 'signature_delta') {
          block.signature = delta.signature;
        }
        break;
      }
      case 'content_block_stop': {
        const block = this.blocks[event.index];
        if (block?.type === 'tool_use') {
          const raw = this.partialJson.get(event.index) ?? '';
          try {
            block.input = raw.trim() ? JSON.parse(raw) : {};
          } catch {
            block.input = {};
          }
        }
        break;
      }
      case 'message_delta':
        if (event.delta?.stop_reason) this.stopReason = event.delta.stop_reason;
        // usage의 토큰 수는 누적값이다.
        if (typeof event.usage?.output_tokens === 'number') this.usage.output_tokens = event.usage.output_tokens;
        if (typeof event.usage?.input_tokens === 'number') this.usage.input_tokens = event.usage.input_tokens;
        break;
      case 'error':
        throw new LlmError(friendly(event.error?.type, event.error?.message), 502);
      default:
        break;
    }
  }

  result(): LlmTurn {
    const content = this.blocks.filter(Boolean);
    return {
      content,
      text: content
        .filter((b) => b.type === 'text')
        .map((b) => String(b.text ?? ''))
        .join(''),
      toolCalls: content.filter((b) => b.type === 'tool_use').map((b) => ({ id: String(b.id), name: String(b.name), input: (b.input ?? {}) as Record<string, any> })),
      stopReason: this.stopReason,
      usage: { ...this.usage },
    };
  }
}

function friendly(type: string | undefined, message: string | undefined): string {
  switch (type) {
    case 'authentication_error':
      return 'API 키가 올바르지 않습니다. 설정에서 다시 등록하세요.';
    case 'permission_error':
      return '이 API 키로는 선택한 모델을 쓸 수 없습니다.';
    case 'rate_limit_error':
      return 'LLM 요청 한도를 넘었습니다. 잠시 뒤 다시 시도하세요.';
    case 'overloaded_error':
      return 'LLM 서버가 바쁩니다. 잠시 뒤 다시 시도하세요.';
    case 'not_found_error':
      return '선택한 모델을 찾을 수 없습니다. 설정에서 모델을 바꿔 보세요.';
    default:
      return `LLM 요청이 실패했습니다${message ? `: ${message.slice(0, 200)}` : '.'}`;
  }
}

export class AnthropicAdapter implements LlmAdapter {
  readonly provider = 'anthropic';

  private async post(apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${config.anthropicBaseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': API_VERSION, ...(config.anthropicBrowserAccess ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}) },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e: any) {
      throw new LlmError(`LLM 서버에 연결하지 못했습니다: ${String(e?.message ?? e).slice(0, 120)}`, 502);
    }
    if (!res.ok) {
      const error = await res
        .json()
        .then((j: any) => j?.error)
        .catch(() => null);
      throw new LlmError(friendly(error?.type, error?.message), res.status === 401 || res.status === 403 ? 400 : 502);
    }
    return res;
  }

  async stream(req: LlmStreamRequest): Promise<LlmTurn> {
    const res = await this.post(
      req.apiKey,
      {
        model: req.model,
        max_tokens: req.maxTokens ?? 8000,
        system: req.system,
        messages: req.messages,
        ...(req.tools?.length ? { tools: req.tools } : {}),
        stream: true,
      },
      req.signal,
    );
    if (!res.body) throw new LlmError('LLM 응답이 비어 있습니다.');
    const acc = new StreamAccumulator();
    for await (const event of sseEvents(res.body as unknown as AsyncIterable<Uint8Array>)) acc.push(event, req.onText);
    return acc.result();
  }

  async json<T>(req: LlmJsonRequest): Promise<{ data: T; usage: LlmUsage }> {
    const res = await this.post(req.apiKey, {
      model: req.model,
      max_tokens: req.maxTokens ?? 4000,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: { format: { type: 'json_schema', schema: req.schema } },
    });
    const body: any = await res.json();
    const text = (body?.content ?? []).find((b: any) => b.type === 'text')?.text;
    if (typeof text !== 'string') throw new LlmError('LLM이 정해진 형식으로 답하지 않았습니다.');
    try {
      return { data: JSON.parse(text) as T, usage: { input_tokens: body.usage?.input_tokens ?? 0, output_tokens: body.usage?.output_tokens ?? 0 } };
    } catch {
      throw new LlmError('LLM의 답을 읽지 못했습니다.');
    }
  }

  toolResults(results: LlmToolResult[]): LlmMessage {
    return {
      role: 'user',
      content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
    };
  }
}
