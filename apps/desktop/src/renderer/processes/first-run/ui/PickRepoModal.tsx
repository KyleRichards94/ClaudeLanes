import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { RepoSettings } from '@agent-lanes/contracts';
import { space, tone } from '@agent-lanes/tokens';
import { Button, Modal, Text } from '@agent-lanes/ui';
import { useAddRepo } from '@/shared/api';

interface PickRepoModalProps {
  visible: boolean;
  /** Repos already registered (a returning user whose last repo went away picks one of these). */
  repos: readonly RepoSettings[];
  /** The repo the board opens on. */
  onPick: (repo: RepoSettings) => void;
}

/**
 * First run's second step (AL-047): pick the git repo the board works in, with the native folder
 * dialog (AL-081). Blocking: the board opens once a repo is chosen.
 */
export function PickRepoModal({ visible, repos, onPick }: PickRepoModalProps) {
  const addRepo = useAddRepo();
  const [problem, setProblem] = useState<string | null>(null);

  async function choose() {
    setProblem(null);
    try {
      const outcome = await addRepo.mutateAsync();
      // `cancelled`: the dialog was closed; `rejected`: main already said why the folder can't be used.
      if (outcome.status === 'added' || outcome.status === 'existing') onPick(outcome.repo);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The folder could not be added.');
    }
  }

  return (
    <Modal
      visible={visible}
      blocking
      title="Pick a repo"
      subtitle="Agent Lanes works in one git repository at a time; each agent gets its own worktree of it."
      icon="branch"
      width={640}
      testID="pick-repo-modal"
      footer={
        <Button
          label="Choose a folder…"
          variant="primary"
          icon="plus"
          loading={addRepo.isPending}
          onPress={() => void choose()}
          testID="pick-repo-choose"
        />
      }
    >
      <View style={styles.body}>
        <Text variant="body">Choose the main checkout of a repository, for example OnSite Companion. You can add more repos later.</Text>
        {repos.length > 0 ? (
          <View style={styles.list} role="list" aria-label="Registered repos">
            {repos.map((repo) => (
              <View key={repo.path} role="listitem">
                <Button
                  label={`${repo.name} · ${repo.path}`}
                  variant="secondary"
                  justify="between"
                  trailingIcon="arrow-right"
                  onPress={() => onPick(repo)}
                  testID={`pick-repo-${repo.name}`}
                />
              </View>
            ))}
          </View>
        ) : null}
        {problem ? (
          <Text variant="meta" color={tone.danger.text} role="alert">
            {problem}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.lg,
  },
  list: {
    gap: space.sm,
  },
});
