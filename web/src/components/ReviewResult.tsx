import { useState } from 'react';
import {
  SEVERITIES,
  type DiffStats,
  type Review,
  type Severity,
  type Usage,
} from '../../../shared/review';

const VERDICT = {
  approve: { label: 'Approve', icon: '✓', className: 'good' },
  comment: { label: 'Comment', icon: '💬', className: 'neutral' },
  request_changes: { label: 'Request changes', icon: '✕', className: 'critical' },
} as const;

const SEVERITY_ICON: Record<Severity, string> = {
  critical: '⛔',
  major: '⚠',
  minor: '●',
  nit: '·',
};

interface Props {
  review: Review;
  usage: Usage | null;
  stats: DiffStats | null;
  source: string | null;
  durationMs: number | null;
}

export function ReviewResult({ review, usage, stats, source, durationMs }: Props) {
  const [filter, setFilter] = useState<Severity | null>(null);
  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s, review.findings.filter((f) => f.severity === s).length]),
  ) as Record<Severity, number>;
  const findings = review.findings
    .filter((f) => !filter || f.severity === filter)
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const verdict = VERDICT[review.verdict];

  return (
    <section className="result" aria-labelledby="result-title">
      <header className="result-header">
        <h2 id="result-title">Review</h2>
        <span className={`verdict ${verdict.className}`}>
          <span aria-hidden="true">{verdict.icon}</span> {verdict.label}
        </span>
      </header>

      {stats && (
        <p className="muted">
          {source} · {stats.files} {stats.files === 1 ? 'file' : 'files'} ·{' '}
          <span className="add">+{stats.additions}</span>{' '}
          <span className="del">−{stats.deletions}</span>
        </p>
      )}

      <p className="summary">{review.summary}</p>

      <div className="severity-filter" role="group" aria-label="Filter by severity">
        <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)}>
          All {review.findings.length}
        </button>
        {SEVERITIES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={filter === s}
            disabled={counts[s] === 0}
            onClick={() => setFilter(filter === s ? null : s)}
          >
            <span className={`sev-dot sev-${s}`} aria-hidden="true" /> {s} {counts[s]}
          </button>
        ))}
      </div>

      {review.findings.length === 0 ? (
        <p className="empty">No issues found. 🎉</p>
      ) : (
        <ol className="findings">
          {findings.map((f, i) => (
            <li key={`${f.file}:${f.line}:${i}`} className={`finding sev-border-${f.severity}`}>
              <div className="finding-meta">
                <span className={`badge sev-${f.severity}`}>
                  <span aria-hidden="true">{SEVERITY_ICON[f.severity]}</span> {f.severity}
                </span>
                <span className="category">{f.category}</span>
                <code className="location">
                  {f.file}
                  {f.line !== null ? `:${f.line}` : ''}
                </code>
              </div>
              <h3>{f.title}</h3>
              <p>{f.explanation}</p>
              {f.suggestion && (
                <details open={f.severity === 'critical' || f.severity === 'major'}>
                  <summary>Suggested fix</summary>
                  <pre>{f.suggestion}</pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}

      {review.strengths.length > 0 && (
        <>
          <h3 className="strengths-title">What's good</h3>
          <ul className="strengths">
            {review.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}

      {usage && (
        <footer className="usage">
          {usage.model} · {usage.inputTokens.toLocaleString()} in /{' '}
          {usage.outputTokens.toLocaleString()} out tokens
          {usage.cacheReadTokens > 0 && ` · ${usage.cacheReadTokens.toLocaleString()} cached`} · $
          {usage.costUsd.toFixed(4)}
          {durationMs !== null && ` · ${(durationMs / 1000).toFixed(1)}s`}
        </footer>
      )}
    </section>
  );
}
