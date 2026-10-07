import { useId, type ReactNode, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Icon, Text, textStyle } from '@agent-lanes/ui';

export interface WorkspacePreviewProps {
  /** The repo's display name; null when no repo is registered. */
  repoName: string | null;
  baseBranch: string | null;
  /** The branch name in the Worktree row: the user's edit, else the generated name. */
  branch: string;
  /** Shown in the Worktree row before there is a name (no work item picked yet). */
  branchPlaceholder: string;
  /** Where the worktree folder goes, read out with the row. */
  worktreePath: string | null;
  onChangeBranch: (name: string) => void;
  /** Why Launch would refuse the name; shown under the table and on the field. */
  error?: string | null;
  inputRef?: Ref<TextInputInstance>;
}

/**
 * The Workspace table on artboard 2: Repo, Base and the Worktree branch, which the user can edit.
 * An edited name that git, Windows or another branch would refuse is marked invalid with the reason,
 * and Launch is blocked until it is fixed (AL-164).
 */
export function WorkspacePreview({
  repoName,
  baseBranch,
  branch,
  branchPlaceholder,
  worktreePath,
  onChangeBranch,
  error,
  inputRef,
}: WorkspacePreviewProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const pathId = `${id}-path`;
  const editable = repoName !== null;
  const describedBy = [error ? errorId : null, worktreePath ? pathId : null].filter(Boolean).join(' ');

  return (
    <View style={styles.section} testID="workspace">
      <Text variant="title" size="md">
        Workspace
      </Text>
      <View style={styles.table}>
        <Row label="Repo">
          {repoName !== null ? (
            <Text variant="mono" numberOfLines={1} testID="workspace-repo">
              {repoName}
            </Text>
          ) : (
            <Text variant="meta" testID="workspace-repo">
              No repo registered yet
            </Text>
          )}
        </Row>
        <Row label="Base" divided>
          <Text variant="mono" numberOfLines={1} color={baseBranch ? undefined : color.muted} testID="workspace-base">
            {baseBranch ?? '—'}
          </Text>
        </Row>
        <Row label="Worktree" divided>
          {editable ? (
            <TextInput
              ref={inputRef}
              value={branch}
              onChangeText={onChangeBranch}
              placeholder={branchPlaceholder}
              placeholderTextColor={color.muted}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              aria-label="Worktree"
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy || undefined}
              testID="workspace-worktree"
              style={[styles.input, error ? styles.inputInvalid : null]}
            />
          ) : (
            <Text variant="meta" testID="workspace-worktree">
              Add a repo to name the worktree
            </Text>
          )}
        </Row>
      </View>
      {worktreePath ? (
        <Text id={pathId} variant="meta" size="xs" numberOfLines={1} style={styles.path}>
          {`Created in ${worktreePath}`}
        </Text>
      ) : null}
      {error ? (
        <View style={styles.error} role="alert" testID="workspace-error">
          <Icon name="alert" size={14} color={color.danger} />
          <Text id={errorId} variant="body" size="sm" color={tone.danger.text} style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Row({ label, divided = false, children }: { label: string; divided?: boolean; children: ReactNode }) {
  return (
    <View style={[styles.row, divided && styles.divided]}>
      <Text variant="meta" size="md" style={styles.label}>
        {label}
      </Text>
      <View style={styles.value}>{children}</View>
    </View>
  );
}


/** Read off artboard 2: a bordered 12 px table, 39 px rows, a 110 px label column, mono values. */
const styles = StyleSheet.create({
  section: {
    gap: space.md,
  },
  table: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.control,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 39,
    paddingHorizontal: 14,
  },
  divided: {
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  label: {
    width: 96,
  },
  value: {
    flex: 1,
    minWidth: 0,
  },
  input: {
    ...textStyle('mono'),
    color: color.claudeText,
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    marginHorizontal: -space.xs,
    borderRadius: radius.chip,
  },
  inputInvalid: {
    color: color.danger,
    backgroundColor: tone.danger.wash,
  },
  path: {
    marginTop: -space.xs,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  errorText: {
    flexShrink: 1,
  },
});
