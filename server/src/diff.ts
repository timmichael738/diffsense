import type { DiffStats } from '../../shared/review.js';

export const MAX_DIFF_BYTES = 400_000;

export class InputError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

/** Counts files and changed lines in a unified diff (headers excluded). */
export function diffStats(diff: string): DiffStats {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) files++;
    else if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  // Plain "---/+++" patches without git headers still count as one file.
  if (files === 0 && /^\+\+\+ /m.test(diff)) files = (diff.match(/^\+\+\+ /gm) ?? []).length;
  return { files, additions, deletions };
}

export function assertReviewableDiff(diff: string): void {
  if (!diff.trim()) throw new InputError('The diff is empty.');
  if (!/^(diff --git |--- |\+\+\+ |@@ )/m.test(diff)) {
    throw new InputError('That does not look like a unified diff (try `git diff` output).');
  }
  // Never truncate silently: a partial diff would produce a misleading review.
  const bytes = Buffer.byteLength(diff, 'utf8');
  if (bytes > MAX_DIFF_BYTES) {
    throw new InputError(
      `The diff is ${Math.round(bytes / 1000)} KB; the limit is ${MAX_DIFF_BYTES / 1000} KB. Review it in smaller parts.`,
      413,
    );
  }
}

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export function parsePullRequestUrl(url: string): PullRequestRef {
  const match = url
    .trim()
    .match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/);
  if (!match) {
    throw new InputError(
      'Expected a GitHub pull request URL like https://github.com/owner/repo/pull/123',
    );
  }
  return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}

/** Downloads a PR as a unified diff from the GitHub REST API. Only github.com is ever contacted. */
export async function fetchPullRequestDiff(
  ref: PullRequestRef,
  token: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const res = await fetcher(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
    {
      headers: {
        accept: 'application/vnd.github.diff',
        'user-agent': 'diffsense',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (res.status === 404)
    throw new InputError('Pull request not found (private repos need GITHUB_TOKEN).', 404);
  if (res.status === 403 || res.status === 429) {
    throw new InputError('GitHub rate limit reached. Set GITHUB_TOKEN or try again later.', 429);
  }
  if (!res.ok) throw new InputError(`GitHub returned HTTP ${res.status}.`, 502);
  return res.text();
}
