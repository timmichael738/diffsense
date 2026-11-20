// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewEvent } from '../../shared/review';
import App from './App';
import { parseSSE } from './sse';

const sse = (events: ReviewEvent[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('parseSSE', () => {
  it('returns complete events and keeps partial frames', () => {
    const { events, rest } = parseSSE(
      'data: {"type":"status","message":"a"}\n\ndata: {"type":"sta',
    );
    expect(events).toEqual([{ type: 'status', message: 'a' }]);
    expect(rest).toBe('data: {"type":"sta');
  });

  it('handles CRLF line endings', () => {
    expect(parseSSE('data: {"type":"status","message":"x"}\r\n\r\n').events).toHaveLength(1);
  });
});

describe('<App />', () => {
  it('reviews the sample diff and renders ranked findings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sse([
        { type: 'diff', stats: { files: 1, additions: 16, deletions: 4 }, source: 'pasted diff' },
        { type: 'thinking', text: 'Checking the search query…' },
        {
          type: 'result',
          durationMs: 4200,
          usage: {
            model: 'claude-opus-5-5',
            inputTokens: 1200,
            outputTokens: 800,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0.0208,
          },
          review: {
            verdict: 'request_changes',
            summary: 'Adds search and invites but introduces SQL injection.',
            strengths: ['Parameterised delete query'],
            findings: [
              {
                severity: 'minor',
                category: 'maintainability',
                file: 'src/routes/users.ts',
                line: 3,
                title: 'Unused import',
                explanation: 'x',
                suggestion: null,
              },
              {
                severity: 'critical',
                category: 'security',
                file: 'src/routes/users.ts',
                line: 11,
                title: 'SQL injection in search',
                explanation: 'User input is interpolated into SQL.',
                suggestion: "db.query('... LIKE $1', [`%${term}%`])",
              },
            ],
          },
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Load sample diff' }));
    await user.click(screen.getByRole('button', { name: 'Review' }));

    expect(await screen.findByText('Request changes')).toBeInTheDocument();
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles.slice(0, 2)).toEqual(['SQL injection in search', 'Unused import']); // critical first
    expect(screen.getByText(/\$0\.0208/)).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).diff).toContain('/users/search');
  });

  it('filters findings by severity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sse([
          {
            type: 'result',
            durationMs: 1,
            usage: null as never,
            review: {
              verdict: 'comment',
              summary: 's',
              strengths: [],
              findings: [
                {
                  severity: 'nit',
                  category: 'style',
                  file: 'a',
                  line: null,
                  title: 'Nit one',
                  explanation: '',
                  suggestion: null,
                },
                {
                  severity: 'minor',
                  category: 'bug',
                  file: 'a',
                  line: 2,
                  title: 'Minor one',
                  explanation: '',
                  suggestion: null,
                },
              ],
            },
          },
        ]),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Unified diff'), 'diff --git a b');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByText('Minor one');
    await user.click(screen.getByRole('button', { name: /nit 1/ }));
    expect(screen.queryByText('Minor one')).not.toBeInTheDocument();
    expect(screen.getByText('Nit one')).toBeInTheDocument();
  });

  it('shows server errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'The diff is empty.' }), { status: 400 }),
        ),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Unified diff'), 'x');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The diff is empty.');
  });
});
