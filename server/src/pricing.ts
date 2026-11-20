import type { Usage } from '../../shared/review.js';

/** USD per million tokens. Keep in sync with https://platform.claude.com/docs/en/about-claude/pricing */
const PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export interface RawUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function toUsage(model: string, raw: RawUsage): Usage {
  const price = PRICES[model];
  const cacheRead = raw.cache_read_input_tokens ?? 0;
  const cacheWrite = raw.cache_creation_input_tokens ?? 0;
  const costUsd = price
    ? (raw.input_tokens * price.input +
        raw.output_tokens * price.output +
        cacheRead * price.cacheRead +
        cacheWrite * price.cacheWrite) /
      1_000_000
    : 0;
  return {
    model,
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd: Math.round(costUsd * 10_000) / 10_000,
  };
}
