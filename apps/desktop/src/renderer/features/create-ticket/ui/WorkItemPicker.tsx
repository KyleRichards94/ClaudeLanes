import type { Lane, Sprint, WorkItem } from '@agent-lanes/contracts';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Pill, Text, TextField } from '@agent-lanes/ui';
import { workItemSummary } from '@/entities/ado-work-item';
import { useWorkItemLanes } from '@/entities/agent-ticket';
import { useWorkItemSearch, useWorkItems } from '@/shared/api';
import { LANE_LABELS } from '@/shared/config';
import type { PickedWorkItem } from '../model/form';
import { WORK_ITEM_SEARCH_DEBOUNCE_MS, filterWorkItems, pickedWorkItem, useDebouncedValue } from '../model/work-item-picker';

export interface WorkItemPickerProps {
  /** The sprint's items, or Azure DevOps search results. */
  source: 'sprint' | 'search';
  /** The board's sprint (AL-142); null while it loads or when the team has none. */
  sprint: Sprint | null;
  sprintState: 'loading' | 'error' | 'ready';
  picked: PickedWorkItem | null;
  onPick(item: PickedWorkItem): void;
}

/**
 * The New agent ticket work item list (artboard 2 left column, AL-161): "Search by ID or title"
 * over a radio list of rows (#id, title, "Story · Active"). On Sprint the box filters the sprint's
 * items as you type; on Search it asks Azure DevOps once typing pauses. A work item an agent ticket
 * is already working on shows its lane instead of a radio and can't be picked again.
 */
export function WorkItemPicker({ source, sprint, sprintState, picked, onPick }: WorkItemPickerProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, WORK_ITEM_SEARCH_DEBOUNCE_MS);
  const sprintItems = useWorkItems(source === 'sprint' ? sprint : null);
  const search = useWorkItemSearch(source === 'search' ? debounced : '');
  const lanes = useWorkItemLanes();

  const items = source === 'sprint' ? filterWorkItems(sprintItems.data ?? [], query) : (search.data ?? []);

  let status: { text: string; busy?: boolean; retry?: () => void } | null = null;
  if (source === 'sprint') {
    if (sprintState === 'loading') status = { text: 'Loading the sprint…', busy: true };
    else if (sprintState === 'error') status = { text: "Couldn't load the sprints. Search for the work item, or check the Azure DevOps connection." };
    else if (!sprint) status = { text: 'The team has no sprints. Search for the work item instead.' };
    else if (sprintItems.isPending) status = { text: `Loading ${sprint.name}…`, busy: true };
    else if (sprintItems.isError) status = { text: `Couldn't load ${sprint.name}: ${sprintItems.error.message}`, retry: () => void sprintItems.refetch() };
    else if (items.length === 0) status = { text: query.trim() ? `Nothing in ${sprint.name} matches "${query.trim()}".` : `No work items in ${sprint.name}.` };
  } else if (!debounced.trim()) {
    status = { text: 'Type a work item id or part of its title to search Azure DevOps.' };
  } else if (search.isError) {
    status = { text: `Search failed: ${search.error.message}`, retry: () => void search.refetch() };
  } else if (search.isPending) {
    status = { text: 'Searching…', busy: true };
  } else if (items.length === 0) {
    status = { text: `No work items match "${debounced.trim()}".` };
  }

  return (
    <View style={styles.picker} testID="work-item-picker">
      <TextField
        variant="search"
        aria-label="Search by ID or title"
        placeholder="Search by ID or title"
        value={query}
        onChangeText={setQuery}
        testID="work-item-search"
      />
      {status ? (
        <View style={styles.status} aria-busy={status.busy} testID="work-item-status">
          {status.busy ? <ActivityIndicator size="small" color={color.muted} /> : null}
          <Text variant="meta" size="sm" style={styles.statusText}>
            {status.text}
          </Text>
          {status.retry ? <Button size="sm" label="Retry" onPress={status.retry} /> : null}
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.rows}>
          <View role="radiogroup" aria-label="Work items" style={styles.rows}>
            {items.map((item) => (
              <WorkItemRow
                key={item.id}
                item={item}
                lane={lanes[String(item.id)]}
                selected={picked?.id === item.id}
                onPick={() => onPick(pickedWorkItem(item))}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

interface WorkItemRowProps {
  item: WorkItem;
  /** The lane of the agent ticket already working on it, if any. */
  lane: Lane | undefined;
  selected: boolean;
  onPick(): void;
}

/** One row: radio, `#71273`, the title, and "Story · Active"; or the lane when it is already running. */
function WorkItemRow({ item, lane, selected, onPick }: WorkItemRowProps) {
  const summary = workItemSummary(item);
  const content = (
    <>
      {lane ? null : (
        <View aria-hidden style={[styles.radio, selected && styles.radioOn]}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
      )}
      <Text variant="mono" color={color.ado} style={styles.id}>
        {`#${item.id}`}
      </Text>
      <Text variant="title" numberOfLines={2} style={styles.title}>
        {item.title}
      </Text>
      {lane ? (
        <Pill tone="claude" dot label={LANE_LABELS[lane]} testID={`work-item-${item.id}-lane`} />
      ) : (
        <Pill tone="neutral" label={summary} />
      )}
    </>
  );

  if (lane) {
    return (
      <View
        style={[styles.row, styles.rowRunning]}
        aria-label={`#${item.id} ${item.title}, ${summary}, already running in ${LANE_LABELS[lane]}`}
        testID={`work-item-${item.id}`}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      role="radio"
      aria-checked={selected}
      aria-label={`#${item.id} ${item.title}, ${summary}`}
      onPress={onPick}
      style={[styles.row, selected && styles.rowSelected]}
      testID={`work-item-${item.id}`}
    >
      {content}
    </Pressable>
  );
}

const radioSize = 20;

/** Read off artboard 2: 50 px rows 8 px apart, 12 px corners, a violet border and wash on the picked one. */
const styles = StyleSheet.create({
  picker: {
    gap: space.sm,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 64,
    paddingHorizontal: space.lg,
    borderRadius: radius.control,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.line,
  },
  statusText: {
    flex: 1,
  },
  list: {
    maxHeight: 248,
  },
  rows: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 50,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  rowSelected: {
    borderColor: tone.claude.border,
    backgroundColor: tone.claude.wash,
  },
  rowRunning: {
    backgroundColor: tone.neutral.band,
  },
  radio: {
    width: radioSize,
    height: radioSize,
    borderRadius: radioSize / 2,
    borderWidth: 2,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    borderColor: color.claude,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: color.claude,
  },
  id: {
    width: 64,
  },
  title: {
    flex: 1,
  },
});
