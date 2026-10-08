import { join } from 'node:path';
import { DesignSpecSchema, type DesignSpec } from '@agent-lanes/contracts';
import { nodeRecordFs, repoKey, writeFileAtomic, type RecordFs } from '../tickets';

/**
 * Shipped design specs on disk (AL-197, AL-198, Decision D8): app-written JSON in
 * `<userData>/design-specs/<repoKey>/<ticketId>/v<N>.json`, never in the worktree. A spec is written
 * once, atomically, and never changed; Sent / Used / Superseded live on the ticket record.
 */
export interface DesignSpecFiles {
  write(repo: string, spec: DesignSpec): Promise<void>;
  /** Undefined when the file is missing or not a valid spec. */
  read(repo: string, ticketId: string, version: number): Promise<DesignSpec | undefined>;
}

export const DESIGN_SPECS_DIR_NAME = 'design-specs';

export function designSpecsRootDir(appDataDir: string): string {
  return join(appDataDir, DESIGN_SPECS_DIR_NAME);
}

export function designSpecPath(rootDir: string, repo: string, ticketId: string, version: number): string {
  return join(rootDir, repoKey(repo), ticketId, `v${version}.json`);
}

export function createDesignSpecFiles(options: { rootDir: string; fs?: RecordFs; warn?: (message: string) => void }): DesignSpecFiles {
  const fs = options.fs ?? nodeRecordFs;
  return {
    async write(repo, spec) {
      await writeFileAtomic(fs, designSpecPath(options.rootDir, repo, spec.ticketId, spec.version), `${JSON.stringify(spec, null, 2)}\n`);
    },
    async read(repo, ticketId, version) {
      let text: string;
      try {
        text = await fs.readFile(designSpecPath(options.rootDir, repo, ticketId, version));
      } catch {
        return undefined;
      }
      try {
        const parsed = DesignSpecSchema.safeParse(JSON.parse(text));
        if (parsed.success) return parsed.data;
        options.warn?.(`Design spec v${version} of ticket ${ticketId} is not valid; it is ignored.`);
      } catch {
        options.warn?.(`Design spec v${version} of ticket ${ticketId} is not JSON; it is ignored.`);
      }
      return undefined;
    },
  };
}
