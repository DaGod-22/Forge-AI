export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelRequest {
  purpose: 'reasoning' | 'coding' | 'vision' | 'asset' | 'qa';
  messages: ModelMessage[];
  temperature?: number;
}

export interface ModelResponse {
  provider: string;
  model: string;
  content: string;
  usage?: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number };
}

export interface AiModelProvider {
  id: string;
  label: string;
  supports: ModelRequest['purpose'][];
  configured: boolean;
  limitation?: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export class NoConfiguredModelError extends Error {
  constructor(public readonly purpose: ModelRequest['purpose'], public readonly providerStatus: ReturnType<typeof availableProviders>) {
    super(
      `No real AI model provider is available for ${purpose}. Forge no longer uses deterministic/local fake AI. ` +
        `This Arena sandbox exposes the chat coding agent to the conversation, but not as an HTTP model API callable by the app. ` +
        `Configure ARENA_AGENT_ENDPOINT, OPENAI_API_KEY, or ANTHROPIC_API_KEY to enable in-app autonomous AI.`
    );
    this.name = 'NoConfiguredModelError';
  }
}

export class ArenaNativeProvider implements AiModelProvider {
  id = 'arena-native-agent';
  label = 'Arena native agent endpoint';
  supports: ModelRequest['purpose'][] = ['reasoning', 'coding', 'qa', 'vision', 'asset'];
  configured = Boolean(process.env.ARENA_AGENT_ENDPOINT || process.env.ARENA_AI_ENDPOINT);
  limitation = this.configured
    ? undefined
    : 'Arena Agent Mode is available in this chat, but this repository runtime does not expose a native Arena model endpoint environment variable.';

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const endpoint = process.env.ARENA_AGENT_ENDPOINT || process.env.ARENA_AI_ENDPOINT;
    if (!endpoint) throw new Error('ARENA_AGENT_ENDPOINT/ARENA_AI_ENDPOINT is not configured.');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.ARENA_AGENT_TOKEN ? { authorization: `Bearer ${process.env.ARENA_AGENT_TOKEN}` } : {})
      },
      body: JSON.stringify(request)
    });
    if (!response.ok) throw new Error(`Arena native provider failed: ${response.status} ${await response.text()}`);
    const json = (await response.json()) as Partial<ModelResponse> & { text?: string; output?: string };
    return {
      provider: this.id,
      model: json.model || 'arena-native',
      content: json.content || json.text || json.output || '',
      usage: json.usage
    };
  }
}

export class GitHubModelsProvider implements AiModelProvider {
  id = 'github-models';
  label = 'GitHub Models using existing GitHub auth';
  supports: ModelRequest['purpose'][] = ['reasoning', 'coding', 'qa', 'vision'];
  configured = Boolean((process.env.GITHUB_MODELS_ENABLE === '1' || process.env.GITHUB_MODELS_ENABLE === 'true') && (process.env.GITHUB_TOKEN || process.env.GH_TOKEN));
  limitation = this.configured
    ? undefined
    : process.env.GITHUB_TOKEN || process.env.GH_TOKEN
      ? 'GitHub auth exists, but GitHub Models is not enabled/reachable for this sandbox. Set GITHUB_MODELS_ENABLE=1 only after confirming https://models.github.ai is reachable.'
      : 'GITHUB_TOKEN/GH_TOKEN is not available to call GitHub Models.';

  constructor(private readonly token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN, private readonly model = process.env.GITHUB_MODELS_MODEL || 'openai/gpt-4.1-mini') {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (!this.token) throw new Error('GITHUB_TOKEN/GH_TOKEN is not configured');
    const response = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2026-03-10'
      },
      body: JSON.stringify({ model: this.model, messages: request.messages, temperature: request.temperature ?? 0.2, max_tokens: 8000 })
    });
    if (!response.ok) throw new Error(`GitHub Models failed: ${response.status} ${await response.text()}`);
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return {
      provider: this.id,
      model: this.model,
      content: json.choices?.[0]?.message?.content || '',
      usage: { inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens }
    };
  }
}

export class OpenAiCompatibleProvider implements AiModelProvider {
  id = 'openai-compatible';
  label = 'OpenAI-compatible API';
  supports: ModelRequest['purpose'][] = ['reasoning', 'coding', 'qa', 'vision'];
  configured = Boolean(process.env.OPENAI_API_KEY);
  limitation = this.configured ? undefined : 'OPENAI_API_KEY is not configured.';

  constructor(private readonly apiKey = process.env.OPENAI_API_KEY, private readonly model = process.env.OPENAI_MODEL || 'gpt-4.1') {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not configured');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: this.model, messages: request.messages, temperature: request.temperature ?? 0.2 })
    });
    if (!response.ok) throw new Error(`OpenAI-compatible provider failed: ${response.status} ${await response.text()}`);
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return {
      provider: this.id,
      model: this.model,
      content: json.choices?.[0]?.message?.content || '',
      usage: { inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens }
    };
  }
}

export class AnthropicProvider implements AiModelProvider {
  id = 'anthropic';
  label = 'Anthropic API';
  supports: ModelRequest['purpose'][] = ['reasoning', 'coding', 'qa', 'vision'];
  configured = Boolean(process.env.ANTHROPIC_API_KEY);
  limitation = this.configured ? undefined : 'ANTHROPIC_API_KEY is not configured.';

  constructor(private readonly apiKey = process.env.ANTHROPIC_API_KEY, private readonly model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514') {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
    const system = request.messages.find((message) => message.role === 'system')?.content || '';
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content }));
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: this.model, max_tokens: 8000, temperature: request.temperature ?? 0.2, system, messages })
    });
    if (!response.ok) throw new Error(`Anthropic provider failed: ${response.status} ${await response.text()}`);
    const json = (await response.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    return {
      provider: this.id,
      model: this.model,
      content: json.content?.map((part) => part.text || '').join('\n') || '',
      usage: { inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens }
    };
  }
}

const providers: AiModelProvider[] = [new ArenaNativeProvider(), new GitHubModelsProvider(), new AnthropicProvider(), new OpenAiCompatibleProvider()];

export function availableProviders() {
  return providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    supports: provider.supports,
    configured: provider.configured,
    limitation: provider.limitation
  }));
}

export function hasConfiguredProvider(purpose: ModelRequest['purpose']) {
  return providers.some((candidate) => candidate.supports.includes(purpose) && candidate.configured);
}

export function selectProvider(purpose: ModelRequest['purpose']) {
  const provider = providers.find((candidate) => candidate.supports.includes(purpose) && candidate.configured);
  if (!provider) throw new NoConfiguredModelError(purpose, availableProviders());
  return provider;
}
