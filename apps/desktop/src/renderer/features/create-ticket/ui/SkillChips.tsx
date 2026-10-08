import { Pressable, StyleSheet, View } from 'react-native';
import type { SkillInfo } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Text } from '@agent-lanes/ui';

export interface SkillChipsProps {
  /** The repo's skills (AL-114); undefined while they load or when they could not be listed. */
  skills: readonly SkillInfo[] | undefined;
  /** Selected skill names without the slash; the agent defaults to begin with. */
  selected: readonly string[];
  onToggle: (skill: string, selected: boolean) => void;
  state: 'loading' | 'ready' | 'error' | 'no-repo';
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * Skills (artboard 2): one mono chip per skill, "/code-review", violet when selected. Chips toggle
 * with a click, Space or Enter and are checkboxes to assistive tech. Selected skills that the repo
 * does not list (a default from settings) still show, so they can be turned off.
 */
export function SkillChips({ skills, selected, onToggle, state, onRefresh, refreshing = false }: SkillChipsProps) {
  const names = [...(skills ?? []).map((skill) => skill.name)];
  for (const name of selected) if (!names.includes(name)) names.push(name);
  const note =
    state === 'loading'
      ? 'Listing the skills in this repo…'
      : state === 'error'
        ? "This repo's skills couldn't be listed."
        : state === 'no-repo'
          ? 'Add a repo to choose from its skills.'
          : names.length === 0
            ? 'No skills in this repo or your Claude Code setup.'
            : null;

  return (
    <View style={styles.section} testID="skill-chips">
      <View style={styles.head}>
        <Text variant="title" size="md" role="heading" aria-level={3}>
          Skills
        </Text>
        {onRefresh && state !== 'no-repo' ? (
          <Button variant="secondary" size="sm" label="Refresh" onPress={onRefresh} loading={refreshing} testID="skills-refresh" />
        ) : null}
      </View>
      {names.length > 0 ? (
        <View style={styles.chips} role="group" aria-label="Skills">
          {names.map((name) => {
            const on = selected.includes(name);
            return (
              <Pressable
                key={name}
                role="checkbox"
                aria-checked={on}
                aria-label={`/${name}`}
                onPress={() => onToggle(name, !on)}
                style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.chipPressed]}
                testID={`skill-chip-${name}`}
              >
                <Text variant="mono" size="sm" color={on ? tone.claude.text : color.ink}>
                  {`/${name}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {note ? (
        <Text variant="meta" size="sm" testID="skill-chips-note">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** Read off artboard 2: 36 px chips, 8 px apart, a 1 px line border; selected chips are violet-tinted. */
const styles = StyleSheet.create({
  section: {
    gap: space.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  chipOn: {
    borderColor: tone.claude.band,
    backgroundColor: tone.claude.band,
  },
  chipPressed: {
    opacity: 0.8,
  },
});
