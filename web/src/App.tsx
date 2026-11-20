import { useState, type FormEvent } from 'react';
import { ReviewResult } from './components/ReviewResult';
import { SAMPLE_DIFF } from './sample';
import { useReview } from './useReview';

type Mode = 'diff' | 'pr';

export default function App() {
  const [mode, setMode] = useState<Mode>('diff');
  const [diff, setDiff] = useState('');
  const [prUrl, setPrUrl] = useState('');
  const { state, start, cancel } = useReview();
  const running = state.phase === 'running';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void start(mode === 'diff' ? { diff } : { prUrl });
  };

  const canSubmit = mode === 'diff' ? diff.trim().length > 0 : prUrl.trim().length > 0;

  return (
    <div className="page">
      <header className="masthead">
        <h1>
          <span aria-hidden="true">◆</span> Diffsense
        </h1>
        <p className="muted">
          AI code review for diffs and pull requests, with findings ranked by severity.
        </p>
      </header>

      <form className="input-card" onSubmit={submit}>
        <div className="tabs" role="tablist" aria-label="Input type">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'diff'}
            onClick={() => setMode('diff')}
          >
            Paste a diff
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'pr'}
            onClick={() => setMode('pr')}
          >
            GitHub pull request
          </button>
        </div>

        {mode === 'diff' ? (
          <>
            <label htmlFor="diff" className="sr-only">
              Unified diff
            </label>
            <textarea
              id="diff"
              value={diff}
              onChange={(e) => setDiff(e.target.value)}
              placeholder="Paste the output of `git diff` here…"
              spellCheck={false}
              rows={14}
            />
          </>
        ) : (
          <>
            <label htmlFor="pr" className="sr-only">
              Pull request URL
            </label>
            <input
              id="pr"
              type="url"
              value={prUrl}
              onChange={(e) => setPrUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
            />
          </>
        )}

        <div className="actions">
          {mode === 'diff' && (
            <button type="button" onClick={() => setDiff(SAMPLE_DIFF)} disabled={running}>
              Load sample diff
            </button>
          )}
          <span className="spacer" />
          {running ? (
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!canSubmit}>
              Review
            </button>
          )}
        </div>
      </form>

      {state.phase === 'error' && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      {running && (
        <section className="progress" aria-live="polite">
          <p>
            <span className="spinner" aria-hidden="true" /> {state.status}
            {state.stats &&
              ` · ${state.stats.files} files, +${state.stats.additions} −${state.stats.deletions}`}
          </p>
          {state.thinking && (
            <details open>
              <summary>Reasoning (live)</summary>
              <p className="thinking">{state.thinking}</p>
            </details>
          )}
        </section>
      )}

      {state.phase === 'done' && state.review && (
        <ReviewResult
          review={state.review}
          usage={state.usage}
          stats={state.stats}
          source={state.source}
          durationMs={state.durationMs}
        />
      )}
    </div>
  );
}
