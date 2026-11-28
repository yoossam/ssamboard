// 제공자 어댑터 인터페이스(LLM-10). Claude(anthropic.adapter)와 GPT(openai.adapter, 2026-11-28).
// 대화·표·블록은 이 형식과 무관하게 저장하므로, 제공자를 더해도 데이터는 그대로 쓴다.

export interface LlmTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** 제공자 고유의 콘텐츠 블록. 도구 호출을 이어 갈 때 받은 그대로 되돌려 보낸다. */
export type LlmBlock = { type: string; [key: string]: unknown };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | LlmBlock[];
}

export interface LlmUsage {
  /** 캐시를 거치지 않은 입력 토큰(OpenAI 는 전체 입력에서 캐시 읽기를 뺀 값으로 맞춘다) */
  input_tokens: number;
  output_tokens: number;
  /** 캐시에서 읽은 입력(싸다) — 2026-11-28 비용 추정 정확도 */
  cache_read_tokens?: number;
  /** 캐시에 저장한 입력(Claude 5분 캐시, 조금 비싸다) */
  cache_write_tokens?: number;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface LlmTurn {
  /** 다음 요청에 assistant 메시지로 그대로 넣을 블록들. */
  content: LlmBlock[];
  text: string;
  toolCalls: LlmToolCall[];
  stopReason: string;
  usage: LlmUsage;
}

export interface LlmStreamRequest {
  apiKey: string;
  model: string;
  system: string;
  /** 매번 바뀌는 안내(지금 시각 등). system 은 캐시해 두고(같은 앞부분은 할인) 이것은 그 뒤에 붙인다. */
  systemTail?: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  maxTokens?: number;
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface LlmJsonRequest {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** JSON Schema. 모든 object에 additionalProperties: false가 있어야 한다. */
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface LlmToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

export interface LlmAdapter {
  readonly provider: string;
  /** 한 번의 응답을 스트리밍으로 받는다. 글자는 onText로 흘려보내고, 끝나면 전체 결과를 돌려준다. */
  stream(req: LlmStreamRequest): Promise<LlmTurn>;
  /** 정해진 JSON 모양으로 답을 받는다(구조화 출력). */
  json<T>(req: LlmJsonRequest): Promise<{ data: T; usage: LlmUsage }>;
  /** 도구 실행 결과를 다음 요청에 넣을 메시지로 만든다. */
  toolResults(results: LlmToolResult[]): LlmMessage;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}
