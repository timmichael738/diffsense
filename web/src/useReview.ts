import { useCallback, useRef, useState } from 'react';
import type { DiffStats, Review, Usage } from '../../shared/review';
import { streamReview } from './sse';

export interface ReviewState {
  phase: 'idle' | 'running' | 'done' | 'error';
  status: string;
  thinking: string;
  stats: DiffStats | null;
  source: string | null;
  review: Review | null;
  usage: Usage | null;
  durationMs: number | null;
  error: string | null;
}

const INITIAL: ReviewState = {
  phase: 'idle',
  status: '',
  thinking: '',
  stats: null,
  source: null,
  review: null,
  usage: null,
  durationMs: null,
  error: null,
};

export function useReview() {
  const [state, setState] = useState<ReviewState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(async (body: { diff: string } | { prUrl: string }) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ ...INITIAL, phase: 'running', status: 'Preparing…' });

    try {
      for await (const event of streamReview(body, controller.signal)) {
        setState((s) => {
          switch (event.type) {
            case 'status':
              return { ...s, status: event.message };
            case 'diff':
              return { ...s, stats: event.stats, source: event.source };
            case 'thinking':
              return { ...s, thinking: s.thinking + event.text };
            case 'result':
              return {
                ...s,
                phase: 'done',
                review: event.review,
                usage: event.usage,
                durationMs: event.durationMs,
              };
            case 'error':
              return { ...s, phase: 'error', error: event.message };
          }
        });
      }
      setState((s) =>
        s.phase === 'running' ? { ...s, phase: 'error', error: 'The connection closed early.' } : s,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setState((s) => ({ ...s, phase: 'error', error: (error as Error).message }));
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setState((s) => ({ ...s, phase: 'idle', status: '' }));
  }, []);

  return { state, start, cancel };
}
