import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import type { ReviewEvent } from '../../shared/review.js';
import {
  assertReviewableDiff,
  diffStats,
  fetchPullRequestDiff,
  InputError,
  parsePullRequestUrl,
} from './diff.js';
import { ReviewError, type Reviewer } from './reviewer.js';

const WEB_DIR = fileURLToPath(new URL('../../web/', import.meta.url));

const requestSchema = z.union([z.object({ diff: z.string() }), z.object({ prUrl: z.url() })]);

export interface AppOptions {
  reviewer: Reviewer;
  githubToken?: string;
  fetcher?: typeof fetch;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({ reviewer, githubToken, fetcher, logger = true }: AppOptions) {
  const app = Fastify({ logger, bodyLimit: 1_000_000 });

  app.get('/api/health', async () => ({ status: 'ok' }));

  /**
   * Streams progress as Server-Sent Events: status → diff stats → live thinking → result.
   * Input errors are returned as normal JSON responses before the stream opens.
   */
  app.post('/api/review', async (request, reply) => {
    const body = requestSchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Send either { "diff": "..." } or { "prUrl": "https://github.com/..." }' });
    }

    let diff: string;
    let source: string;
    try {
      if ('prUrl' in body.data) {
        const ref = parsePullRequestUrl(body.data.prUrl);
        diff = await fetchPullRequestDiff(ref, githubToken, fetcher);
        source = `${ref.owner}/${ref.repo}#${ref.number}`;
      } else {
        diff = body.data.diff;
        source = 'pasted diff';
      }
      assertReviewableDiff(diff);
    } catch (error) {
      if (error instanceof InputError)
        return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }

    const controller = new AbortController();
    // The *response* closing before we finished means the client went away: stop paying for
    // tokens. (The request stream's 'close' fires as soon as the body is read, so it can't be used.)
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: ReviewEvent) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);

    const started = Date.now();
    try {
      send({ type: 'diff', stats: diffStats(diff), source });
      send({ type: 'status', message: 'Reviewing…' });
      const { review, usage } = await reviewer.review(
        diff,
        (text) => send({ type: 'thinking', text }),
        controller.signal,
      );
      send({ type: 'result', review, usage, durationMs: Date.now() - started });
    } catch (error) {
      if (!controller.signal.aborted) {
        request.log.error({ err: error }, 'review failed');
        send({ type: 'error', message: describeError(error) });
      }
    } finally {
      reply.raw.end();
    }
  });

  // Serve the built UI in production (the dev UI is served by Vite on :5173).
  if (existsSync(new URL('../../web/assets/', import.meta.url))) {
    await app.register(fastifyStatic, { root: WEB_DIR });
  }

  return app;
}

/** Maps failures to messages a user can act on, using the SDK's typed errors. */
export function describeError(error: unknown): string {
  if (error instanceof ReviewError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) {
    return 'The server has no valid Anthropic credentials. Set ANTHROPIC_API_KEY.';
  }
  if (error instanceof Anthropic.RateLimitError)
    return 'Rate limited by the model API. Try again shortly.';
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the model API.';
  if (error instanceof Anthropic.APIError) return `Model API error (${error.status}).`;
  return 'Unexpected error while reviewing.';
}
