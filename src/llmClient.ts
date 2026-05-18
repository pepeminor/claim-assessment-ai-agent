export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatCompletionResult {
  message: ChatMessage;
}

export interface CreateChatCompletionParams {
  messages: ChatMessage[];
  tools: ChatTool[];
  requireJson?: boolean;
}

export class LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    const provider = process.env.LLM_PROVIDER ?? "openai";

    if (provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "OPENAI_API_KEY is required when LLM_PROVIDER=openai.",
        );
      }
      this.apiKey = apiKey;
      this.baseUrl = "https://api.openai.com/v1";
      this.model = process.env.LLM_MODEL ?? "gpt-4.1-mini";
      return;
    }

    if (provider === "groq") {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error("GROQ_API_KEY is required when LLM_PROVIDER=groq.");
      }
      this.apiKey = apiKey;
      this.baseUrl = "https://api.groq.com/openai/v1";
      this.model = process.env.LLM_MODEL ?? "openai/gpt-oss-120b";
      return;
    }

    if (provider === "gemini") {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is required when LLM_PROVIDER=gemini.");
      }
      this.apiKey = apiKey;
      this.baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
      this.model = process.env.LLM_MODEL ?? "gemini-2.5-flash-lite";
      return;
    }

    throw new Error(
      `Unsupported LLM_PROVIDER '${provider}'. Use 'openai', 'groq', or 'gemini'.`,
    );
  }

  async createChatCompletion(
    params: CreateChatCompletionParams,
  ): Promise<ChatCompletionResult> {
    const response = await this.fetchWithRetry(params);

    const body = (await response.json()) as {
      choices?: Array<{ message?: ChatMessage }>;
    };
    const message = body.choices?.[0]?.message;
    if (!message) {
      throw new Error("LLM response did not include a message.");
    }

    return { message };
  }

  private async fetchWithRetry(
    params: CreateChatCompletionParams,
  ): Promise<Response> {
    const maxAttempts = Number(process.env.LLM_MAX_RETRIES ?? 5);
    let lastErrorBody = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: params.messages,
          tools: params.tools.length > 0 ? params.tools : undefined,
          tool_choice: params.tools.length > 0 ? "auto" : undefined,
          temperature: 0,
          response_format:
            params.requireJson && params.tools.length === 0
              ? {
                  type: "json_object",
                }
              : undefined,
        }),
      });

      if (response.ok) {
        return response;
      }

      lastErrorBody = await response.text();
      if (response.status === 429 && isNonRetryableQuotaError(lastErrorBody)) {
        throw new Error(buildQuotaErrorMessage(lastErrorBody));
      }

      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        throw new Error(
          `LLM chat completion request failed: ${response.status} ${lastErrorBody}`,
        );
      }

      const retryAfterSeconds = parseRetryAfterSeconds(
        response.headers.get("retry-after"),
        lastErrorBody,
      );
      const waitMs = Math.ceil(retryAfterSeconds * 1000) + 500;
      console.warn(
        `LLM request failed with ${response.status}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts}).`,
      );
      await sleep(waitMs);
    }

    throw new Error(`LLM chat completion request failed: ${lastErrorBody}`);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function parseRetryAfterSeconds(
  retryAfterHeader: string | null,
  responseBody: string,
): number {
  if (retryAfterHeader) {
    const parsed = Number(retryAfterHeader);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const retryInfoMatch = responseBody.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
  if (retryInfoMatch?.[1]) {
    const parsed = Number(retryInfoMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const match = responseBody.match(/(?:try again|retry) in ([\d.]+)s/i);
  if (match?.[1]) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 5;
}

function isNonRetryableQuotaError(responseBody: string): boolean {
  return (
    responseBody.includes("GenerateRequestsPerDayPerProjectPerModel-FreeTier") ||
    responseBody.includes("generate_content_free_tier_requests")
  );
}

function buildQuotaErrorMessage(responseBody: string): string {
  const retrySeconds = parseRetryAfterSeconds(null, responseBody);
  return [
    "Gemini quota exhausted for the current project/model.",
    "The API response says this key is hitting the FreeTier daily request quota.",
    `Suggested wait from API: ${retrySeconds}s, but daily FreeTier quota may require waiting for quota reset.`,
    "Check that billing is enabled on the same Google Cloud project that owns this GEMINI_API_KEY.",
    "Check active quota at https://ai.dev/rate-limit.",
    "If billing is correct, try a different Gemini model with separate quota, for example LLM_MODEL=gemini-2.5-flash-lite or LLM_MODEL=gemini-2.0-flash-lite.",
    `Raw quota response: ${responseBody}`,
  ].join("\n");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
