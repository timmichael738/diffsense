import { z } from 'zod';

/** The structured review the model must return. Shared by the server (validation) and the UI (types). */
export const SEVERITIES = ['critical', 'major', 'minor', 'nit'] as const;
export const CATEGORIES = [
  'bug',
  'security',
  'performance',
  'maintainability',
  'tests',
  'style',
] as const;

export const findingSchema = z.object({
  severity: z.enum(SEVERITIES),
  category: z.enum(CATEGORIES),
  file: z.string().describe('Path of the file as it appears in the diff'),
  line: z
    .number()
    .int()
    .nullable()
    .describe('Line number in the new version of the file, or null if not line-specific'),
  title: z.string().describe('One-line summary of the problem'),
  explanation: z.string().describe('Why this matters, with concrete consequences'),
  suggestion: z.string().nullable().describe('A concrete fix, code if helpful, or null'),
});

export const reviewSchema = z.object({
  verdict: z.enum(['approve', 'comment', 'request_changes']),
  summary: z
    .string()
    .describe('Two or three sentences on what the change does and its overall quality'),
  findings: z.array(findingSchema),
  strengths: z.array(z.string()).describe('Things done well, if any'),
});

export type Finding = z.infer<typeof findingSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Severity = (typeof SEVERITIES)[number];

export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  model: string;
}

/** Server-Sent Events emitted by POST /api/review. */
export type ReviewEvent =
  | { type: 'status'; message: string }
  | { type: 'diff'; stats: DiffStats; source: string }
  | { type: 'thinking'; text: string }
  | { type: 'result'; review: Review; usage: Usage; durationMs: number }
  | { type: 'error'; message: string };
