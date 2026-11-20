# Diffsense

[![CI](https://github.com/timmichael738/diffsense/actions/workflows/ci.yml/badge.svg)](https://github.com/timmichael738/diffsense/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)

**AI code review for diffs and GitHub pull requests.** Paste a `git diff` or a PR link and get a
structured review: a verdict, severity-ranked findings with file and line references, suggested
fixes, and the cost of the review. You can watch the model's reasoning stream in while it works.

```text
⛔ critical · security · src/routes/users.ts:11
SQL injection in search
User input from req.query.q is interpolated directly into the SQL string…
▸ Suggested fix: db.query('SELECT … WHERE name LIKE $1', [`%${term}%`])
```

## How it works

```text
 browser ──POST /api/review──▶ Fastify ──(PR URL?)──▶ GitHub REST API (diff media type)
    ▲                            │
    │   Server-Sent Events       ▼
    └── diff stats · live ─── Claude (streaming, adaptive thinking,
        reasoning · result      JSON-schema structured output)
```

1. **Input validation.** The server checks that the input is a real unified diff and enforces a size limit. Oversized diffs
   are rejected with a clear message, **never silently truncated**, because a partial diff would produce a misleading review.
2. **Streaming review.** The model streams _summarized_ reasoning, which the UI shows live, so a long review never
   looks frozen.
3. **Structured output.** The response is constrained to a JSON Schema (verdict, summary, findings, strengths) and
   validated again with Zod on the server. The UI renders data, not free text.
4. **Cost tracking.** Token usage, including prompt-cache reads and writes, is priced per review and shown in the UI.

## Engineering highlights

- **Typed, shared contract.** One Zod schema in `shared/` defines the review. It powers server validation and UI types.
- **Server-Sent Events over `fetch`.** `EventSource` can't POST, so the client includes a small, tested incremental SSE parser.
- **Cancellation saves money.** If the browser disconnects, the server aborts the upstream model request.
- **Actionable errors.** The SDK's typed errors (auth, rate limit, connection) map to messages a user can act on.
  Refusals and `max_tokens` cut-offs are detected and reported instead of being parsed as broken JSON.
- **Resilience.** The request opts into server-side refusal fallbacks, so a safety-classifier decline is retried on a
  fallback model within the same call.
- **No SSRF surface.** PR URLs are parsed strictly, and the server only ever calls `api.github.com`.
- **Testable by design.** The model client sits behind a `Reviewer` interface. Tests inject a fake, so CI never spends tokens.

## Quick start

```bash
cp .env.example .env        # add ANTHROPIC_API_KEY (GITHUB_TOKEN optional)
npm install
npm run dev                 # API on :8787, UI on http://localhost:5173
```

Production:

```bash
docker compose up --build   # http://localhost:8787
```

## API

`POST /api/review` with `{ "diff": "<unified diff>" }` or `{ "prUrl": "https://github.com/o/r/pull/1" }`
returns `text/event-stream` with these events:

| event      | payload                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `diff`     | `{ stats: { files, additions, deletions }, source }`                                            |
| `status`   | `{ message }`                                                                                   |
| `thinking` | `{ text }` (incremental)                                                                        |
| `result`   | `{ review, usage: { inputTokens, outputTokens, cacheReadTokens, costUsd, model }, durationMs }` |
| `error`    | `{ message }`                                                                                   |

Invalid input returns a normal JSON `4xx` before the stream opens.

## Project structure

```text
shared/review.ts        Zod schema + event types shared by server and UI
server/src/
  app.ts                Routes, SSE streaming, error mapping
  reviewer.ts           Model client: prompt, structured output, streaming thinking
  diff.ts               Diff validation, stats, GitHub PR fetching
  pricing.ts            Token → USD
web/src/
  App.tsx, useReview.ts, sse.ts, components/ReviewResult.tsx
```

## Development

```bash
npm test             # server + UI tests (model calls are faked)
npm run lint && npm run typecheck
npm run build        # dist/server + dist/web
```

## License

[MIT](LICENSE) © Michael Timothy
