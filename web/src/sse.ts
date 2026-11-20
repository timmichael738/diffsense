import type { ReviewEvent } from '../../shared/review';

/**
 * Incremental Server-Sent Events parser for fetch() streams (EventSource can't POST).
 * Returns complete events and the unconsumed remainder to prepend to the next chunk.
 */
export function parseSSE(buffer: string): { events: ReviewEvent[]; rest: string } {
  const events: ReviewEvent[] = [];
  const normalized = buffer.replace(/\r\n/g, '\n');
  const frames = normalized.split('\n\n');
  const rest = frames.pop() ?? '';
  for (const frame of frames) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as ReviewEvent);
    } catch {
      /* ignore malformed frames */
    }
  }
  return { events, rest };
}

export async function* streamReview(
  body: { diff: string } | { prUrl: string },
  signal: AbortSignal,
): AsyncGenerator<ReviewEvent> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    yield { type: 'error', message: (error as { error?: string }).error ?? `HTTP ${res.status}` };
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const parsed = parseSSE(buffer + value);
    buffer = parsed.rest;
    yield* parsed.events;
  }
}
