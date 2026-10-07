import { useEffect, type ReactNode } from 'react';
import { useConnections, useRepos } from '@/shared/api';
import { endBlockingConnections, openConnections, useUiPrefs } from '@/shared/model';
import { firstRunStep, isFirstRunSkipped, type FirstRunStep } from '../model/first-run';
import { PickRepoModal } from './PickRepoModal';

interface FirstRunGateProps {
  /** The app's pages. Shown behind the blocking steps and once first run is done. */
  children: ReactNode;
  /** Defaults to the page's `?firstRun=skip` (e2e only); tests pass it. */
  skip?: boolean;
}

/**
 * First run (AL-047, design §8 "opens automatically on first run and blocks the board"): until an
 * Azure DevOps organisation and Claude are connected, the Connections modal stays open and can't be
 * dismissed; then a "Pick a repo" step opens the native folder dialog; then the board for that repo.
 * A returning user with both saved and a last repo goes straight to the board.
 */
export function FirstRunGate({ children, skip = isFirstRunSkipped() }: FirstRunGateProps) {
  const connections = useConnections();
  const repos = useRepos();
  const lastRepo = useUiPrefs((state) => state.lastRepo);
  const setLastRepo = useUiPrefs((state) => state.setLastRepo);

  const loading = !skip && (connections.isPending || repos.isPending);
  // If the main process can't list them, blocking the board would leave the user nowhere to go.
  const failed = connections.isError || repos.isError;
  const step: FirstRunStep =
    skip || loading || failed ? 'done' : firstRunStep({ connections: connections.data ?? [], repos: repos.data ?? [], lastRepo });

  useEffect(() => {
    if (step === 'connect') openConnections({ blocking: true });
    else endBlockingConnections();
  }, [step]);

  // Nothing until we know, so the board never shows (and takes clicks) before first run decides.
  if (loading) return null;

  return (
    <>
      {children}
      <PickRepoModal visible={step === 'repo'} repos={repos.data ?? []} onPick={(repo) => setLastRepo(repo.path)} />
    </>
  );
}
