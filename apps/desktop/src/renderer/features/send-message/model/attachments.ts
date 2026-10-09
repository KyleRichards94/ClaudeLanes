import { ATTACHMENT_LIMITS, type AgentAttachment } from '@agent-lanes/contracts';

/** What the composer holds before Send (AL-259): the attachment as the contract takes it, plus its size for the chip. */
export interface PendingAttachment extends AgentAttachment {
  readonly bytes: number;
}

/** "1.2 MB", "840 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Whether a file is sent as an image block or as text. */
export function attachmentKind(mediaType: string): AgentAttachment['kind'] | null {
  if (IMAGE_TYPES.has(mediaType)) return 'image';
  if (mediaType === 'application/pdf') return 'document';
  if (mediaType.startsWith('text/') || /\+(json|xml)$/.test(mediaType) || mediaType === 'application/json') return 'text';
  return null;
}

/** Why a file cannot be added, or null when it can. */
export function attachmentRefusal(pending: readonly PendingAttachment[], candidate: { name: string; bytes: number; mediaType: string }): string | null {
  if (attachmentKind(candidate.mediaType) === null) return `${candidate.name}: only images (PNG, JPEG, GIF, WebP), PDFs and text files can be attached.`;
  if (candidate.bytes > ATTACHMENT_LIMITS.bytesEach) return `${candidate.name} is ${formatBytes(candidate.bytes)}; the limit is ${formatBytes(ATTACHMENT_LIMITS.bytesEach)} per file.`;
  if (pending.length >= ATTACHMENT_LIMITS.count) return `At most ${ATTACHMENT_LIMITS.count} files per message.`;
  const total = pending.reduce((sum, item) => sum + item.bytes, 0) + candidate.bytes;
  if (total > ATTACHMENT_LIMITS.bytesTotal) return `Together the files would be ${formatBytes(total)}; the limit is ${formatBytes(ATTACHMENT_LIMITS.bytesTotal)} per message.`;
  return null;
}

/** A pending attachment from a file's bytes, already checked with `attachmentRefusal`. */
export function toAttachment(file: { name: string; bytes: number; mediaType: string }, data: string): PendingAttachment {
  return { kind: attachmentKind(file.mediaType) ?? 'text', name: file.name.slice(0, 200) || 'file', mediaType: file.mediaType, data, bytes: file.bytes };
}
