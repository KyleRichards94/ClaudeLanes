/**
 * Child process for record-store.kill.test.ts: rewrites ticket records as fast as it can until the
 * test kills it. Run with Node's type stripping and ./strip-types-hooks.mjs:
 *
 *   node --import ./strip-types-hooks.mjs crash-writer.ts <rootDir> <baseDir> <ticketCount>
 *
 * Prints `ready` once every ticket has a record on disk, then never stops writing.
 */
import { STAGES } from '@agent-lanes/contracts';
import { createTicketRecordStore } from '../record-store';
import { newTicketInput } from './index';

const [rootDir, baseDir, countArg] = process.argv.slice(2);
if (!rootDir || !baseDir) throw new Error('usage: crash-writer.ts <rootDir> <baseDir> <ticketCount>');

const store = createTicketRecordStore({ rootDir, debounceMs: 0, maxWaitMs: 0, warn: () => undefined });
const ids = Array.from({ length: Number(countArg ?? 8) }, (_, i) => String(71_000 + i));

for (const id of ids) {
  if (await store.get(id)) continue;
  const created = await store.create(newTicketInput(baseDir, { id }));
  if (!created.ok) throw new Error(created.message);
}
process.stdout.write('ready\n');

// Big records (about 30 KB: 64 sub-branches with long paths, a long stage history) make each write
// take a while, so a kill usually lands while one is under way.
const longPath = `${baseDir}/.agent-lanes/${'deep-folder/'.repeat(12)}`;
for (let n = 0; ; n += 1) {
  const id = ids[n % ids.length] ?? '71000';
  const result = await store.update(id, (record) => ({
    ...record,
    title: `write ${n} `.padEnd(1_000, '.'),
    stage: STAGES[n % STAGES.length] ?? 'planning',
    sessionId: `cc-${id}-${n}`,
    subBranches: Array.from({ length: 64 }, (_, i) => ({
      name: `agent-${i}`,
      branch: `sub/${id}-agent-${i}`,
      worktreePath: `${longPath}${id}--agent-${i}`,
      createdAt: record.createdAt,
      mergedAt: n % 2 === 0 ? null : record.createdAt + n,
    })),
  }));
  if (!result.ok) throw new Error(result.message);
  await store.flush(id);
}
