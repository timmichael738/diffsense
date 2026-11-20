import Anthropic from '@anthropic-ai/sdk';
import { reviewSchema, type Review, type Usage } from '../../shared/review.js';
import { toUsage } from './pricing.js';

export const MODEL = 'claude-opus-5-5';

export interface ReviewOutput {
  review: Review;
  usage: Usage;
}

export interface Reviewer {
  review(
    diff: string,
    onThinking: (text: string) => void,
    signal: AbortSignal,
  ): Promise<ReviewOutput>;
}

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
  }
}

export const SYSTEM_PROMPT = `You are a senior software engineer doing a code review of a unified diff.

Review only what the diff changes, using the surrounding context lines to understand it. Look for, in priority order:
1. Bugs and incorrect behaviour (logic errors, edge cases, off-by-one, null handling, race conditions, broken error handling).
2. Security problems (injection, auth/authorization gaps, secrets, unsafe deserialization, SSRF, XSS).
3. Performance problems that matter at realistic scale.
4. Missing or inadequate tests for the risky parts of the change.
5. Maintainability issues that will cost the team later.

Severity guide:
- critical: will cause data loss, a security breach or an outage; must block the merge.
- major: a real bug or risk that should be fixed before merging.
- minor: worth fixing, but not blocking.
- nit: style or taste; mention sparingly.

Be specific and evidence-based: cite the file and the new-file line number, explain the concrete consequence, and propose a fix. Do not invent problems to seem thorough; an excellent change can have zero findings. Do not comment on formatting a formatter would fix. Order findings from most to least severe.

Choose the verdict: "request_changes" if there is any critical or major finding, "approve" if there are none of any severity above nit, otherwise "comment".`;

/**
 * Reviews a diff with Claude, streaming summarized thinking for live progress and returning a
 * structured, schema-validated review.
 */
export class ClaudeReviewer implements Reviewer {
  constructor(private readonly client = new Anthropic()) {}

  async review(diff: string, onThinking: (text: string) => void, signal: AbortSignal) {
    const stream = this.client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64_000,
        // If a safety classifier declines, the API re-runs the request on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: reviewJsonSchema() },
        },
        cache_control: { type: 'ephemeral' },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Review this diff:\n\n<diff>\n${diff}\n</diff>` }],
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
        onThinking(event.delta.thinking);
      }
    }
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      throw new ReviewError('The model declined to review this diff.', 422);
    }
    if (message.stop_reason === 'max_tokens') {
      throw new ReviewError(
        'The review was cut off because it was too long. Try a smaller diff.',
        422,
      );
    }

    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    const parsed = reviewSchema.safeParse(safeJson(text));
    if (!parsed.success)
      throw new ReviewError('The model returned a malformed review. Please retry.');

    return { review: parsed.data, usage: toUsage(message.model, message.usage) };
  }
}

/** JSON Schema for structured outputs: closed objects, every property required (nullable where optional). */
export function reviewJsonSchema(): Record<string, unknown> {
  const finding = {
    type: 'object',
    additionalProperties: false,
    required: ['severity', 'category', 'file', 'line', 'title', 'explanation', 'suggestion'],
    properties: {
      severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
      category: {
        type: 'string',
        enum: ['bug', 'security', 'performance', 'maintainability', 'tests', 'style'],
      },
      file: { type: 'string', description: 'Path of the file as it appears in the diff' },
      line: {
        type: ['integer', 'null'],
        description: 'Line number in the new version of the file, or null if not line-specific',
      },
      title: { type: 'string', description: 'One-line summary of the problem' },
      explanation: { type: 'string', description: 'Why this matters, with concrete consequences' },
      suggestion: { type: ['string', 'null'], description: 'A concrete fix, or null' },
    },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'summary', 'findings', 'strengths'],
    properties: {
      verdict: { type: 'string', enum: ['approve', 'comment', 'request_changes'] },
      summary: { type: 'string' },
      findings: { type: 'array', items: finding },
      strengths: { type: 'array', items: { type: 'string' } },
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
