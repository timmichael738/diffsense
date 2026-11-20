import { describe, expect, it, vi } from 'vitest';
import type { Review, ReviewEvent } from '../../shared/review.js';
import { buildApp } from '../src/app.js';
import {
  assertReviewableDiff,
  diffStats,
  MAX_DIFF_BYTES,
  parsePullRequestUrl,
} from '../src/diff.js';
import { toUsage } from '../src/pricing.js';
import { reviewJsonSchema, ReviewError, type Reviewer } from '../src/reviewer.js';
import { reviewSchema } from '../../shared/review.js';

const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
-const x = 1;
+const x = 2;
+const y = 3;
 export {};
`;

const REVIEW: Review = {
  verdict: 'request_changes',
  summary: 'Changes a constant.',
  findings: [
    {
      severity: 'major',
      category: 'bug',
      file: 'a.ts',
      line: 1,
      title: 'Magic number changed',
      explanation: 'Callers depend on x being 1.',
      suggestion: 'const x = 1;',
    },
  ],
  strengths: ['Small change'],
};

const fakeReviewer = (impl?: Reviewer['review']): Reviewer => ({
  review:
    impl ??
    (async (_diff, onThinking) => {
      onThinking('Looking at a.ts… ');
      onThinking('x changed.');
      return {
        review: REVIEW,
        usage: toUsage('claude-opus-5-5', { input_tokens: 1000, output_tokens: 500 }),
      };
    }),
});

const parseEvents = (body: string): ReviewEvent[] =>
  body
    .split('\n\n')
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice(6)));

describe('diff helpers', () => {
  it('counts files, additions and deletions', () => {
    expect(diffStats(DIFF)).toEqual({ files: 1, additions: 2, deletions: 1 });
  });

  it('rejects empty, non-diff and oversized input without truncating', () => {
    expect(() => assertReviewableDiff('  ')).toThrow(/empty/);
    expect(() => assertReviewableDiff('hello world')).toThrow(/unified diff/);
    expect(() => assertReviewableDiff(`diff --git a b\n${'+x\n'.repeat(MAX_DIFF_BYTES)}`)).toThrow(
      /limit/,
    );
  });

  it('parses GitHub PR URLs', () => {
    expect(parsePullRequestUrl('https://github.com/vercel/next.js/pull/123/files')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
      number: 123,
    });
    expect(() => parsePullRequestUrl('https://gitlab.com/a/b/-/merge_requests/1')).toThrow();
  });
});

describe('pricing', () => {
  it('prices input, output and cache tokens', () => {
    const usage = toUsage('claude-opus-5-5', {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
    });
    expect(usage.costUsd).toBeCloseTo(4 + 2 + 0.2);
  });
});

describe('structured output schema', () => {
  it('requires every property and closes every object', () => {
    const schema = reviewJsonSchema() as {
      required: string[];
      additionalProperties: boolean;
      properties: { findings: { items: { required: string[]; properties: object } } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual(Object.keys(reviewSchema.shape).sort());
    const finding = schema.properties.findings.items;
    expect(finding.required.sort()).toEqual(Object.keys(finding.properties).sort());
  });
});

describe('POST /api/review', () => {
  it('streams stats, thinking and the structured result', async () => {
    const app = await buildApp({ reviewer: fakeReviewer(), logger: false });
    const res = await app.inject({ method: 'POST', url: '/api/review', payload: { diff: DIFF } });
    expect(res.headers['content-type']).toContain('text/event-stream');

    const events = parseEvents(res.body);
    expect(events.map((e) => e.type)).toEqual(['diff', 'status', 'thinking', 'thinking', 'result']);
    const result = events.at(-1) as Extract<ReviewEvent, { type: 'result' }>;
    expect(result.review).toEqual(REVIEW);
    expect(result.usage.costUsd).toBeCloseTo(0.014);
    await app.close();
  });

  it('fetches pull requests from GitHub with the token', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(DIFF));
    const app = await buildApp({
      reviewer: fakeReviewer(),
      githubToken: 'ghp_test',
      fetcher,
      logger: false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/review',
      payload: { prUrl: 'https://github.com/acme/api/pull/42' },
    });
    expect(parseEvents(res.body)[0]).toMatchObject({ type: 'diff', source: 'acme/api#42' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/api/pulls/42',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer ghp_test' }),
      }),
    );
    await app.close();
  });

  it('returns a JSON 4xx for invalid input before streaming', async () => {
    const app = await buildApp({ reviewer: fakeReviewer(), logger: false });
    expect((await app.inject({ method: 'POST', url: '/api/review', payload: {} })).statusCode).toBe(
      400,
    );
    const notDiff = await app.inject({
      method: 'POST',
      url: '/api/review',
      payload: { diff: 'hi' },
    });
    expect(notDiff.statusCode).toBe(400);
    expect(notDiff.json().error).toMatch(/unified diff/);
    await app.close();
  });

  it('keeps the review running while the client stays connected (real HTTP)', async () => {
    // Regression: the request stream's 'close' event fires once the body is read, which used
    // to abort every review. inject() can't reproduce that, so use a real socket.
    const app = await buildApp({
      reviewer: fakeReviewer(async (_diff, _onThinking, signal) => {
        await new Promise((r) => setTimeout(r, 50));
        if (signal.aborted) throw new Error('aborted');
        return {
          review: REVIEW,
          usage: toUsage('claude-opus-5-5', { input_tokens: 1, output_tokens: 1 }),
        };
      }),
      logger: false,
    });
    const url = await app.listen({ port: 0, host: '127.0.0.1' });
    const res = await fetch(`${url}/api/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diff: DIFF }),
    });
    expect(parseEvents(await res.text()).at(-1)?.type).toBe('result');
    await app.close();
  });

  it('reports reviewer failures as an error event', async () => {
    const app = await buildApp({
      reviewer: fakeReviewer(async () => {
        throw new ReviewError('The model declined to review this diff.', 422);
      }),
      logger: false,
    });
    const res = await app.inject({ method: 'POST', url: '/api/review', payload: { diff: DIFF } });
    expect(parseEvents(res.body).at(-1)).toEqual({
      type: 'error',
      message: 'The model declined to review this diff.',
    });
    await app.close();
  });
});
