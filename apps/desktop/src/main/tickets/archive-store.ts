import { join } from 'node:path';
import { ArchivedTicketSchema, type ArchivedTicket } from '@agent-lanes/contracts';
import { errnoCode, nodeRecordFs, writeFileAtomic, type RecordFs } from './atomic-file';
import { RECORD_EXTENSION, repoKey } from './paths';

/**
 * The archive list (AL-088): archived tickets as app-written JSON in
 * `<userData>/tickets-archive/<repoKey>/<ticketId>-<archivedAt>.json`, next to the live records (D8)
 * but in their own folder, so the record store never loads them and a new ticket for the same work
 * item can reuse the id.
 */
export interface TicketArchive {
  add(entry: ArchivedTicket): Promise<void>;
  /** Newest first. Files that can't be read or don't match the schema are skipped. */
  list(): Promise<ArchivedTicket[]>;
}

export const TICKETS_ARCHIVE_DIR_NAME = 'tickets-archive';

export function ticketsArchiveDir(appDataDir: string): string {
  return join(appDataDir, TICKETS_ARCHIVE_DIR_NAME);
}

export function createTicketArchive(options: { rootDir: string; fs?: RecordFs; warn?: (message: string) => void }): TicketArchive {
  const { rootDir } = options;
  const fs = options.fs ?? nodeRecordFs;
  const warn = options.warn ?? ((message: string) => console.warn(`[archive] ${message}`));

  async function entries(folder: string) {
    try {
      return await fs.readdir(folder);
    } catch (cause) {
      if (errnoCode(cause) !== 'ENOENT') warn(`Could not list ${folder} (${errnoCode(cause)}).`);
      return [];
    }
  }

  return {
    async add(entry) {
      const file = join(rootDir, repoKey(entry.record.repo), `${entry.record.id}-${entry.archivedAt}${RECORD_EXTENSION}`);
      await writeFileAtomic(fs, file, `${JSON.stringify(ArchivedTicketSchema.parse(entry), null, 2)}\n`);
    },

    async list() {
      const found: ArchivedTicket[] = [];
      for (const folder of await entries(rootDir)) {
        if (!folder.isDirectory) continue;
        const folderPath = join(rootDir, folder.name);
        for (const file of await entries(folderPath)) {
          if (!file.isFile || !file.name.endsWith(RECORD_EXTENSION)) continue;
          try {
            const parsed = ArchivedTicketSchema.safeParse(JSON.parse(await fs.readFile(join(folderPath, file.name))));
            if (parsed.success) found.push(parsed.data);
            else warn(`Skipped ${file.name} in the archive: it is not a valid archived ticket.`);
          } catch (cause) {
            warn(`Skipped ${file.name} in the archive: ${cause instanceof Error ? cause.message : String(cause)}`);
          }
        }
      }
      return found.sort((a, b) => b.archivedAt - a.archivedAt);
    },
  };
}
