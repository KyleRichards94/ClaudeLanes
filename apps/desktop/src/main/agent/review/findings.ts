import type { FindingSeverity, ReviewFinding, ReviewStatus } from '@agent-lanes/contracts';
import { actorOf, interleave, normaliseRelativePath, type TranscriptSource } from '../attribution/transcript-sources';

/**
 * Review findings (AL-277, handoff "Review status and findings"): the review agent ends each file it
 * reviewed with a fenced JSON block, and `review:findings` and `diff:files` read them back from the
 * ticket's transcripts, so nothing is stored. Pure: events in, findings and statuses out.
 */

/** What the reviewer is told; appended to the Code review prompts (stage protocol, Reviewer brief, review-only lane). */
export const REVIEW_FINDINGS_INSTRUCTION =
  'End the review of each file with one fenced JSON block, as the last thing you say about that file, in exactly this shape: ' +
  '```json {"file": "<path relative to the worktree>", "status": "passed" | "changesRequested", "findings": [{"line": <number>, "severity": "info" | "warn" | "error", "text": "<one or two sentences>"}]} ```. ' +
  'Use an empty "findings" list when the file passed. Agent Lanes reads these blocks to show each file\'s review status and notes.';

/** Longest finding text the contract allows. */
const FINDING_TEXT_LIMIT = 2_000;

export interface ParsedFinding {
  line: number | null;
  severity: FindingSeverity;
  text: string;
}

export interface ParsedReviewBlock {
  file: string;
  status: Exclude<ReviewStatus, 'notReviewed' | 'inReview'>;
  findings: ParsedFinding[];
}

const FENCE = /```[ \t]*(?:json|jsonc)?[ \t]*\r?\n?([\s\S]*?)```/gi;

function statusOf(value: unknown): ParsedReviewBlock['status'] | null {
  const word = typeof value === 'string' ? value.toLowerCase().replace(/[^a-z]/g, '') : '';
  return word === 'passed' ? 'passed' : word === 'changesrequested' ? 'changesRequested' : null;
}

function severityOf(value: unknown): FindingSeverity {
  const word = typeof value === 'string' ? value.toLowerCase().trim() : '';
  return word === 'error' ? 'error' : word === 'warn' || word === 'warning' ? 'warn' : 'info';
}

function findingOf(value: unknown): ParsedFinding | null {
  const data = value as { line?: unknown; severity?: unknown; text?: unknown } | null;
  const text = typeof data?.text === 'string' ? data.text.trim() : '';
  if (text === '') return null;
  const line = typeof data?.line === 'number' && Number.isInteger(data.line) && data.line > 0 ? data.line : null;
  return { line, severity: severityOf(data?.severity), text: text.length > FINDING_TEXT_LIMIT ? `${text.slice(0, FINDING_TEXT_LIMIT - 1)}…` : text };
}

function blockOf(value: unknown): ParsedReviewBlock | null {
  const data = value as { file?: unknown; status?: unknown; findings?: unknown } | null;
  const file = typeof data?.file === 'string' ? data.file.trim() : '';
  const status = statusOf(data?.status);
  if (file === '' || status === null) return null;
  const findings = Array.isArray(data?.findings) ? data.findings.map(findingOf).filter((finding): finding is ParsedFinding => finding !== null) : [];
  return { file, status, findings };
}

/** The review blocks in a piece of text, in order. A block that is not valid JSON or lacks a file and status is ignored. */
export function parseReviewBlocks(text: string): ParsedReviewBlock[] {
  if (!text.includes('"file"') || !text.includes('"status"')) return [];
  const blocks: ParsedReviewBlock[] = [];
  for (const match of text.matchAll(FENCE)) {
    let json: unknown;
    try {
      json = JSON.parse((match[1] ?? '').trim());
    } catch {
      continue;
    }
    for (const candidate of Array.isArray(json) ? json : [json]) {
      const block = blockOf(candidate);
      if (block) blocks.push(block);
    }
  }
  return blocks;
}

/** An agent's transcript for review: `reviewing` marks the agents whose file reads show a file in review. */
export interface ReviewSource extends TranscriptSource {
  reviewing: boolean;
}

/** The latest block for one file. */
export interface FileReview {
  status: ParsedReviewBlock['status'];
  findings: ReviewFinding[];
}

export interface ReviewReplay {
  /** File path → its latest review block; a later block for the same file replaces an earlier one. */
  files: ReadonlyMap<string, FileReview>;
  /** Files a reviewer is reading right now (its latest call is a read and its turn has not ended). */
  reading: ReadonlySet<string>;
}

export function findingId(agentId: string, filePath: string, line: number | null, index: number): string {
  return `${agentId}:${filePath}:${line ?? 0}:${index}`;
}

/** Reads every source's text for review blocks, and the reviewers' reads for the file in review. */
export function replayReview(sources: readonly ReviewSource[]): ReviewReplay {
  const files = new Map<string, FileReview>();
  /** Per source, the file each agent's latest tool call read; absent when its latest call was something else. */
  const reads = new Map<ReviewSource, Map<string, string>>();

  for (const { source, event } of interleave(sources)) {
    const item = event.item;
    if (item.kind === 'text') {
      const agentId = actorOf(source, item.parentToolUseId);
      for (const block of parseReviewBlocks(item.text)) {
        const filePath = normaliseRelativePath(block.file, source.cwd);
        if (filePath === null) continue;
        files.set(filePath, {
          status: block.status,
          findings: block.findings.map((finding, index) => ({ id: findingId(agentId, filePath, finding.line, index), filePath, line: finding.line, severity: finding.severity, text: finding.text, agentId })),
        });
      }
    } else if (item.kind === 'tool' && source.reviewing) {
      const agentReads = reads.get(source) ?? new Map<string, string>();
      reads.set(source, agentReads);
      const agentId = actorOf(source, item.parentToolUseId);
      const path = item.tool === 'read' ? normaliseRelativePath(item.detail, source.cwd) : null;
      if (path === null) agentReads.delete(agentId);
      else agentReads.set(agentId, path);
    } else if (item.kind === 'result') {
      // The turn ended: nothing is being read any more.
      reads.get(source)?.clear();
    }
  }

  const reading = new Set<string>();
  for (const agentReads of reads.values()) {
    for (const path of agentReads.values()) reading.add(path);
  }
  return { files, reading };
}

/** Every finding of the latest blocks, files in the order they were first reviewed. */
export function findingsOf(replay: ReviewReplay): ReviewFinding[] {
  return [...replay.files.values()].flatMap((review) => review.findings);
}

/**
 * `passed` or `changesRequested` from the file's latest block; `inReview` while a reviewer is reading
 * it and no block exists yet; else `notReviewed`. Paths compare case-insensitively (Windows).
 */
export function reviewStatusOf(replay: ReviewReplay, path: string): ReviewStatus {
  const folded = path.toLowerCase();
  const block = replay.files.get(path) ?? [...replay.files].find(([key]) => key.toLowerCase() === folded)?.[1];
  if (block) return block.status;
  return replay.reading.has(path) || [...replay.reading].some((key) => key.toLowerCase() === folded) ? 'inReview' : 'notReviewed';
}
