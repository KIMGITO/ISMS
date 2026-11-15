// The AI providers the server's ai-runner can call, and the models offered for each.
// Keep the ids in step with AI_PROVIDERS / DEFAULT_MODELS in
// supabase/functions/shared/ai-runner.ts. Hugging Face is the default and the only
// provider that works without a key here (it uses the HF_TOKEN_A..E rotation).

export type AIProviderId =
  | 'huggingface'
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'groq'
  | 'openrouter';

export interface AIProviderInfo {
  id: AIProviderId;
  label: string;
  needsKey: boolean;
  keyPrefix?: string; // what a real key starts with, for a gentle check
  keyHelp: string;
  defaultModel: string;
  models: { id: string; label: string }[];
}

export const AI_PROVIDERS: AIProviderInfo[] = [
  {
    id: 'huggingface',
    label: 'Hugging Face (default, recommended)',
    needsKey: false,
    keyPrefix: 'hf_',
    keyHelp:
      'Optional. Without one, the server rotates through the HF_TOKEN_A to HF_TOKEN_E secrets.',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    models: [
      { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B (default)' },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
      { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B' },
      { id: 'deepseek-ai/DeepSeek-V3-0324', label: 'DeepSeek V3' },
      { id: 'meta-llama/Llama-3.1-8B-Instruct', label: 'Llama 3.1 8B (fast)' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    needsKey: true,
    keyPrefix: 'AIza',
    keyHelp: 'Required. Create one free at aistudio.google.com (no card needed).',
    defaultModel: 'gemini-3.8-flash',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (free tier)' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (free tier)' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (free tier, fastest)' },
      { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (free tier)' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    needsKey: true,
    keyPrefix: 'sk-',
    keyHelp: 'Required. Create one at platform.openai.com.',
    defaultModel: 'gpt-6-luna',
    models: [
      { id: 'gpt-6-luna', label: 'GPT-6 Luna (cheapest)' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    needsKey: true,
    keyPrefix: 'sk-ant-',
    keyHelp: 'Required. Create one at console.anthropic.com.',
    defaultModel: 'claude-haiku-5-5',
    models: [
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    needsKey: true,
    keyPrefix: 'sk-',
    keyHelp: 'Required. Create one at platform.deepseek.com.',
    defaultModel: 'deepseek-flash',
    models: [
      { id: 'deepseek-flash', label: 'DeepSeek Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    needsKey: true,
    keyPrefix: 'gsk_',
    keyHelp: 'Required. Create one free at console.groq.com (no card needed).',
    defaultModel: 'openai/gpt-oss-120b',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (free tier)' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (free tier, fastest)' },
      { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (free tier)' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    needsKey: true,
    keyPrefix: 'sk-or-',
    keyHelp: 'Required. Create one at openrouter.ai.',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
      { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free)' },
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra (free)' },
    ],
  },
];

export function getAIProvider(id?: string | null): AIProviderInfo {
  return AI_PROVIDERS.find((p) => p.id === String(id || '').toLowerCase()) || AI_PROVIDERS[0];
}

export const isMaskedKey = (key?: string | null) => String(key ?? '').includes('•');

/**
 * Why the current form can't be tested or saved, or null when it can. Stops the
 * request before it reaches the server with a value the provider would refuse.
 */
export function aiConfigProblem(cfg: { provider?: string; api_key?: string; model?: string }): string | null {
  const p = getAIProvider(cfg.provider);
  const key = String(cfg.api_key || '').trim();
  const model = String(cfg.model || '').trim();
  if (!model) return 'Choose a model.';
  if (/\s/.test(model)) return "The model name can't contain spaces.";
  if (key && !isMaskedKey(key) && !/^[\x21-\x7e]+$/.test(key)) {
    return "The key has spaces or characters a key can't have. Paste it again.";
  }
  if (p.needsKey && !key) return `Enter your ${p.label} API key.`;
  return null;
}

/** A soft warning when a pasted key doesn't look like this provider's keys. */
export function aiKeyWarning(cfg: { provider?: string; api_key?: string }): string | null {
  const p = getAIProvider(cfg.provider);
  const key = String(cfg.api_key || '').trim();
  if (!key || isMaskedKey(key) || !p.keyPrefix) return null;
  return key.startsWith(p.keyPrefix)
    ? null
    : `${p.label.replace(/ \(.*\)$/, '')} keys usually start with "${p.keyPrefix}". Check you pasted the right key.`;
}
