/**
 * The main-process test kit (AL-221, design §12 "Main process" row), in one import:
 *
 * - `createTempRepo()`: a temp git repo with a bare `origin`, isolated from the machine's git config,
 *   plus ticket worktrees (`addWorktree`) and a teammate's clone (`clone`).
 * - `createFakeClaude()`: the Agent SDK's `query()` replaying scripted `SDKMessage` streams and
 *   recording what the app sent and called (`setModel`, `applyFlagSettings`, `interrupt`, user
 *   messages with their priority), in order, on `call.log`.
 * - `createFakeSafeStorage()`: Electron's `safeStorage` with real encryption and a per-instance key.
 *
 * Never imported by production code.
 */
export * from '../agent/testing';
export * from '../git/testing';
export * from '../secrets/testing';
