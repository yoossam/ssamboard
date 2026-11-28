import { config } from '../config';
import { LlmError, type LlmAdapter, type LlmBlock, type LlmJsonRequest, type LlmMessage, type LlmStreamRequest, type LlmToolResult, type LlmTurn, type LlmUsage } from './adapter';
import { sseEvents } from './anthropic.adapter';

// OpenAI(GPT) Responses API 를 SDK 없이 HTTP 로 부른다(2026-11-28 developers.openai.com 문서 확인).
//  - POST /v1/responses, 도구는 { type: 'function', name, description, parameters }
//  - 도구 호출은 output 의 function_call 항목(call_id·arguments 글자), 결과는 { type: 'function_call_output', call_id, output }
//  - 추론 모델은 도구 결과와 함께 받은 reasoning 항목도 되돌려 보내야 한다 → store:false + include reasoning.encrypted_content 로
//    받은 output 항목을 그대로 다음 요청에 넣는다(서버 쪽에 대화를 남기지 않는다).
//  - 스트림: response.output_text.delta(글자), response.completed(전체 output·usage), response.failed / error
// 화면·대화 저장은 Claude 형식(text·image·document 블록)으로 오므로, 보낼 때 Responses 입력 모양으로 바꾼다.

type Item = Record<string, any>;

/** OpenAI 의 input_tokens 는 캐시 읽기를 포함한다 — 캐시 읽기를 따로 떼어 Claude 와 같은 모양으로 맞춘다 */
function openaiUsage(u: any): LlmUsage {
  const input = Number(u?.input_tokens ?? 0);
  const cached = Math.min(input, Number(u?.input_tokens_details?.cached_tokens ?? 0));
  return { input_tokens: input - cached, output_tokens: Number(u?.output_tokens ?? 0), cache_read_tokens: cached, cache_write_tokens: 0 };
}

/** Claude 형식 메시지 → Responses 입력 항목 */
export function toInput(messages: LlmMessage[]): Item[] {
  const out: Item[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      // 이 어댑터가 돌려준 output 항목(reasoning·function_call·message)을 그대로. store:false 라 서버에 없는 항목 id 는 떼고
      // (reasoning 은 암호화된 내용과 함께 그대로 보낸다 — 문서: 추론 항목은 도구 결과와 함께 되돌려 보낸다).
      for (const b of m.content) {
        if (b.type === 'reasoning') out.push(b);
        else {
          const { id: _id, ...rest } = b as Item;
          out.push(rest);
        }
      }
      continue;
    }
    const parts: Item[] = [];
    for (const b of m.content as LlmBlock[]) {
      if (b.type === 'function_call_output') {
        out.push(b);
      } else if (b.type === 'text') {
        parts.push({ type: 'input_text', text: String(b.text ?? '') });
      } else if (b.type === 'image') {
        const s = b.source as { media_type: string; data: string };
        parts.push({
          type: 'input_image',
          image_url: `data:${s.media_type};base64,${s.data}`,
        });
      } else if (b.type === 'document') {
        const s = b.source as { media_type: string; data: string };
        parts.push({
          type: 'input_file',
          filename: String(b.title ?? 'file.pdf'),
          file_data: `data:${s.media_type};base64,${s.data}`,
        });
      }
    }
    if (parts.length > 0) out.push({ role: 'user', content: parts });
  }
  return out;
}

function friendly(status: number, message: string | undefined): string {
  if (status === 401) return 'OpenAI API 키가 올바르지 않습니다. 설정에서 다시 등록하세요.';
  if (status === 403) return '이 OpenAI API 키로는 선택한 모델을 쓸 수 없습니다.';
  if (status === 404) return '선택한 GPT 모델을 찾을 수 없습니다. 설정에서 모델을 바꿔 보세요.';
  if (status === 429) return 'OpenAI 요청 한도를 넘었거나 잔액이 없습니다. 잠시 뒤 다시 하거나 OpenAI 결제를 확인하세요.';
  if (status >= 500) return 'OpenAI 서버가 바쁩니다. 잠시 뒤 다시 시도하세요.';
  return `GPT 요청이 실패했습니다${message ? `: ${message.slice(0, 200)}` : '.'}`;
}

/** 스트림 이벤트를 모아 최종 응답을 만든다. 모르는 이벤트는 무시한다. */
export class ResponsesAccumulator {
  private output: Item[] = [];
  private usage: LlmUsage = { input_tokens: 0, output_tokens: 0 };
  private status = '';
  private readonly done = new Map<number, Item>();
  /** 끝 이벤트(completed·incomplete)를 받았는지 — 못 받고 끊기면 일부만 온 답이라 오류로(코덱스·제미나이 검토) */
  private finished = false;

  push(event: any, onText?: (delta: string) => void): void {
    switch (event?.type) {
      case 'response.output_text.delta':
        if (typeof event.delta === 'string') onText?.(event.delta);
        break;
      case 'response.output_item.done':
        if (event.item) this.done.set(Number(event.output_index ?? this.done.size), event.item);
        break;
      case 'response.completed':
      case 'response.incomplete': {
        this.finished = true;
        const r = event.response ?? {};
        if (Array.isArray(r.output)) this.output = r.output;
        this.status = String(r.status ?? event.type.slice(9));
        this.usage = openaiUsage(r.usage);
        break;
      }
      case 'response.failed':
        throw new LlmError(friendly(0, event.response?.error?.message), 502);
      case 'error':
        throw new LlmError(friendly(0, event.message ?? event.error?.message), 502);
      default:
        break;
    }
  }

  result(): LlmTurn {
    if (!this.finished) throw new LlmError('GPT 응답이 중간에 끊겼습니다. 다시 시도해 주세요.');
    const output = this.output.length > 0 ? this.output : [...this.done.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    const content = output.map((o) => ({ ...o }) as LlmBlock);
    const text = output
      .filter((o) => o.type === 'message')
      .flatMap((o) => (Array.isArray(o.content) ? o.content : []))
      .filter((c: Item) => c.type === 'output_text')
      .map((c: Item) => String(c.text ?? ''))
      .join('');
    const toolCalls = output
      .filter((o) => o.type === 'function_call')
      .map((o) => {
        let input: Record<string, any> = {};
        try {
          input = o.arguments ? JSON.parse(String(o.arguments)) : {};
        } catch {
          input = {};
        }
        return { id: String(o.call_id), name: String(o.name), input };
      });
    // 대화 루프(ai.service)는 Claude 의 stop_reason 이름으로 이어 갈지 정한다.
    const stopReason = toolCalls.length > 0 ? 'tool_use' : this.status === 'incomplete' ? 'max_tokens' : 'end_turn';
    return { content, text, toolCalls, stopReason, usage: { ...this.usage } };
  }
}

export class OpenAiAdapter implements LlmAdapter {
  readonly provider = 'openai';

  private async post(apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${config.openaiBaseUrl}/v1/responses`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e: any) {
      throw new LlmError(`OpenAI 서버에 연결하지 못했습니다: ${String(e?.message ?? e).slice(0, 120)}`, 502);
    }
    if (!res.ok) {
      const error = await res
        .json()
        .then((j: any) => j?.error)
        .catch(() => null);
      throw new LlmError(friendly(res.status, error?.message), res.status === 401 || res.status === 403 ? 400 : 502);
    }
    return res;
  }

  async stream(req: LlmStreamRequest): Promise<LlmTurn> {
    const res = await this.post(
      req.apiKey,
      {
        model: req.model,
        // OpenAI 는 같은 앞부분을 저절로 캐시한다 — 바뀌는 안내는 맨 뒤에
        instructions: req.systemTail ? `${req.system}\n\n${req.systemTail}` : req.system,
        input: toInput(req.messages),
        max_output_tokens: req.maxTokens ?? 8000,
        ...(req.tools?.length
          ? {
              tools: req.tools.map((t) => ({
                type: 'function',
                name: t.name,
                description: t.description,
                parameters: t.input_schema,
                strict: false,
              })),
            }
          : {}),
        store: false,
        include: ['reasoning.encrypted_content'],
        stream: true,
      },
      req.signal,
    );
    if (!res.body) throw new LlmError('GPT 응답이 비어 있습니다.');
    const acc = new ResponsesAccumulator();
    for await (const event of sseEvents(res.body as unknown as AsyncIterable<Uint8Array>)) acc.push(event, req.onText);
    return acc.result();
  }

  async json<T>(req: LlmJsonRequest): Promise<{ data: T; usage: LlmUsage }> {
    const res = await this.post(req.apiKey, {
      model: req.model,
      instructions: req.system,
      input: [{ role: 'user', content: req.user }],
      max_output_tokens: req.maxTokens ?? 4000,
      text: {
        format: {
          type: 'json_schema',
          name: 'answer',
          schema: req.schema,
          strict: false,
        },
      },
      store: false,
    });
    const body: any = await res.json();
    const text = (body?.output ?? [])
      .filter((o: Item) => o.type === 'message')
      .flatMap((o: Item) => o.content ?? [])
      .find((c: Item) => c.type === 'output_text')?.text;
    if (typeof text !== 'string') throw new LlmError('GPT 가 정해진 형식으로 답하지 않았습니다.');
    try {
      return {
        data: JSON.parse(text) as T,
        usage: openaiUsage(body.usage),
      };
    } catch {
      throw new LlmError('GPT 의 답을 읽지 못했습니다.');
    }
  }

  toolResults(results: LlmToolResult[]): LlmMessage {
    return {
      role: 'user',
      content: results.map((r) => ({
        type: 'function_call_output',
        call_id: r.id,
        output: r.isError ? `오류: ${r.content}` : r.content,
      })),
    };
  }
}
