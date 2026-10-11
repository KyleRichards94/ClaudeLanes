import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type KeyDownEvent, type StyleProp, type ViewStyle } from 'react-native';
import { color, minTarget, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Icon, Switch, Text, TextField, type TextFieldHandle } from '@agent-lanes/ui';
import { useApplyModelNow } from '@/entities/agent-ticket';
import { useInterruptTurn, useSessionCommands, useSessionStatus, useSkills, useWorktreeFiles } from '@/shared/api';
import { toast, useComposerDraft, useUiPrefs } from '@/shared/model';
import { AGENT_MESSAGE_LIMIT, usePauseResume, useRunSkill, useSendMessage } from '../api/composer';
import { listenForFiles, pickFiles, type PickedFile } from '../lib/files';
import { attachmentRefusal, formatBytes, toAttachment, type PendingAttachment } from '../model/attachments';
import { applyCompletion, completionQuery, filterCommands, filterFiles, isSendKey, type CommandItem, type CompletionQuery } from '../model/completion';
import { composerControls, type ComposerControls } from '../model/composer';
import { pushHistory, recall, useComposerHistory } from '../model/history';
import { CompletionMenu, type CompletionEntry } from './CompletionMenu';

export interface ComposerProps {
  ticketId: string;
  /** The repo's main checkout: its skills fill the `/` menu (AL-259). */
  repo?: string;
  /** The ticket's skills (record `skills`, picked on artboard 2), shown as `/skill-name` chips. */
  skills: readonly string[];
  /** A model or effort change waits for the next turn, so "Apply model now" has something to apply. */
  switching: boolean;
  /** Controls the page adds to the footer's left (the model and effort pickers, AL-259). */
  tools?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const COMPOSER_PLACEHOLDER = 'Message the agent — Enter sends, Shift+Enter for a new line';

/** How long after the last keystroke a draft is saved (AL-259). */
const DRAFT_SAVE_MS = 400;

/**
 * The Output card's footer (artboard 3, AL-176, AL-259): skill chips, the message box with `/` and
 * `@` completions, attachments, Stop, Pause / Resume and Send. Enter sends; Shift+Enter adds a line;
 * Up recalls earlier messages. "Steer now" sends the next message with `priority: 'now'`, so it
 * reaches the agent at the next tool call instead of after the turn. Messages sent while paused are
 * held by the session and delivered on Resume (AL-105); the composer counts them. The draft is kept
 * per ticket in the UI prefs.
 */
export function Composer({ ticketId, repo, skills, switching, tools, style }: ComposerProps) {
  const status = useSessionStatus(ticketId);
  const send = useSendMessage(ticketId);
  const runSkill = useRunSkill(ticketId);
  const { pause, resume } = usePauseResume(ticketId);
  const interrupt = useInterruptTurn(ticketId);
  const applyModel = useApplyModelNow();
  const draft = useComposerDraft(ticketId);
  const setDraft = useUiPrefs((state) => state.setComposerDraft);
  const [text, setText] = useState(draft);
  const [steerNow, setSteerNow] = useState(false);
  const [held, setHeld] = useState(0);
  const [attachments, setAttachments] = useState<readonly PendingAttachment[]>([]);
  // The `@` word being typed, looked up in the worktree (AL-259); null while no file menu is open.
  const [fileQuery, setFileQuery] = useState<string | null>(null);

  const controls = composerControls({ state: status.data?.state, switching, held });
  const live = controls.live;
  const files = useWorktreeFiles(ticketId, fileQuery ?? '', fileQuery !== null);
  const repoSkills = useSkills(live ? (repo ?? null) : null);
  const sessionCommands = useSessionCommands(ticketId, live);
  const commandItems = useMemo<CommandItem[]>(
    () => [
      ...(repoSkills.data?.skills ?? []).map((skill) => ({ name: skill.name, description: skill.description ?? '', argumentHint: '', source: 'skill' as const })),
      ...skills.filter((name) => !(repoSkills.data?.skills ?? []).some((skill) => skill.name === name)).map((name) => ({ name, description: '', argumentHint: '', source: 'skill' as const })),
      ...(sessionCommands.data?.commands ?? []).map((command) => ({ ...command, source: 'command' as const })),
    ],
    [repoSkills.data, sessionCommands.data, skills],
  );

  // Held messages were delivered on Resume (or went with the session) once it is no longer paused.
  if (!controls.paused && held > 0) setHeld(0);

  // The draft follows the text, a little after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setDraft(ticketId, text), DRAFT_SAVE_MS);
    return () => clearTimeout(timer);
  }, [text, ticketId, setDraft]);

  const addFiles = (files: PickedFile[]) => {
    setAttachments((current) => {
      let next = current;
      for (const file of files) {
        const refusal = attachmentRefusal(next, file);
        if (refusal) {
          toast({ id: `attach:${ticketId}:${file.name}`, tone: 'warning', title: "Couldn't attach the file", body: refusal });
          continue;
        }
        next = [...next, toAttachment(file, file.data)];
      }
      return next;
    });
  };

  const onSend = () => {
    const message = text;
    const files = attachments;
    send.mutate(
      { text: message, now: steerNow, attachments: files },
      {
        onSuccess: ({ held: wasHeld }) => {
          pushHistory(ticketId, message);
          setText((current) => (current === message ? '' : current));
          setAttachments((current) => (current === files ? [] : current));
          setDraft(ticketId, '');
          setSteerNow(false);
          if (wasHeld) setHeld((count) => count + 1);
        },
      },
    );
  };

  const failed = [send, runSkill, pause, resume, applyModel, interrupt].find((call) => call.isError)?.error;

  return (
    <ComposerView
      ticketId={ticketId}
      skills={skills}
      controls={controls}
      text={text}
      onChangeText={setText}
      commands={commandItems}
      files={{ paths: files.data?.files ?? [], pending: fileQuery !== null && files.isPending }}
      onFileQuery={setFileQuery}
      attachments={attachments}
      onAddFiles={addFiles}
      onRemoveAttachment={(name) => setAttachments((current) => current.filter((file) => file.name !== name))}
      steerNow={steerNow}
      onSteerNowChange={setSteerNow}
      onSend={onSend}
      onPauseResume={() => (controls.paused ? resume.mutate() : pause.mutate())}
      onStop={() => interrupt.mutate()}
      // A skill sent while paused waits for Resume like any message (AL-254).
      onRunSkill={(skill) => runSkill.mutate(skill, { onSuccess: ({ held: wasHeld }) => wasHeld && setHeld((count) => count + 1) })}
      onApplyModel={() => applyModel.mutate({ ticketId })}
      tools={tools}
      pending={{
        send: send.isPending,
        pause: pause.isPending || resume.isPending,
        stop: interrupt.isPending,
        skill: runSkill.isPending,
        applyModel: applyModel.isPending,
      }}
      error={failed ? (failed instanceof Error ? failed.message : String(failed)) : null}
      style={style}
    />
  );
}

export interface ComposerViewProps {
  ticketId: string;
  skills: readonly string[];
  controls: ComposerControls;
  text: string;
  onChangeText(text: string): void;
  /** What the `/` menu offers (AL-259). */
  commands?: readonly CommandItem[];
  /** Worktree files for the `@` menu, looked up by the container for the word `onFileQuery` reports. */
  files?: { paths: readonly string[]; pending: boolean };
  onFileQuery?(word: string | null): void;
  attachments?: readonly PendingAttachment[];
  onAddFiles?(files: PickedFile[]): void;
  onRemoveAttachment?(name: string): void;
  steerNow: boolean;
  onSteerNowChange(on: boolean): void;
  onSend(): void;
  onPauseResume(): void;
  /** Stop turn (AL-253): ends the running turn; the session stays live. */
  onStop?(): void;
  onRunSkill(skill: string): void;
  onApplyModel(): void;
  tools?: ReactNode;
  /** Calls in flight, so a second press does nothing before the first one returns. */
  pending?: { send?: boolean; pause?: boolean; stop?: boolean; skill?: boolean; applyModel?: boolean };
  /** Why the last call failed; shown in place of the note. */
  error?: string | null;
  style?: StyleProp<ViewStyle>;
}

/** The composer without its calls, for the component gallery's states. */
export function ComposerView({
  ticketId,
  skills,
  controls,
  text,
  onChangeText,
  commands = [],
  files = { paths: [], pending: false },
  onFileQuery,
  attachments = [],
  onAddFiles,
  onRemoveAttachment,
  steerNow,
  onSteerNowChange,
  onSend,
  onPauseResume,
  onStop,
  onRunSkill,
  onApplyModel,
  tools,
  pending = {},
  error = null,
  style,
}: ComposerViewProps) {
  const field = useRef<TextFieldHandle>(null);
  const frame = useRef<ComponentRef<typeof View>>(null);
  const [caret, setCaret] = useState(text.length);
  const [active, setActive] = useState(0);
  const [menuClosed, setMenuClosed] = useState<string | null>(null);
  const [recallIndex, setRecallIndex] = useState<number | null>(null);
  const history = useComposerHistory(ticketId);

  const query: CompletionQuery | null = useMemo(() => completionQuery(text, Math.min(caret, text.length)), [text, caret]);
  const menuOpen = query !== null && menuClosed !== `${query.kind}:${query.start}`;
  const fileWord = menuOpen && query?.kind === 'file' ? query.word : null;
  const entries: CompletionEntry[] = useMemo(() => {
    if (!menuOpen || !query) return [];
    if (query.kind === 'command') return filterCommands(commands, query.word).map((item) => ({ kind: 'command', item }));
    return filterFiles(files.paths, query.word).map((path) => ({ kind: 'file', path }));
  }, [menuOpen, query, commands, files.paths]);

  // The container looks the `@` word up in the worktree.
  useEffect(() => {
    onFileQuery?.(fileWord);
  }, [fileWord, onFileQuery]);

  useEffect(() => {
    if (!onAddFiles) return;
    return listenForFiles(frame, onAddFiles);
  }, [onAddFiles]);

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !pending.send;
  const submit = () => {
    if (canSend) onSend();
  };
  const change = (next: string) => {
    onChangeText(next);
    setCaret(next.length);
    setMenuClosed(null);
    setRecallIndex(null);
    setActive(0);
  };
  const pick = (index: number) => {
    const entry = entries[index];
    if (!entry || !query) return;
    const applied = applyCompletion(text, query, entry.kind === 'command' ? entry.item.name : entry.path);
    onChangeText(applied.text);
    setCaret(applied.caret);
    setMenuClosed(`${query.kind}:${query.start}`);
    field.current?.focus();
  };

  const onKeyDown = (event: KeyDownEvent) => {
    const key = event.nativeEvent;
    if (menuOpen) {
      if (key.key === 'ArrowDown') {
        event.preventDefault();
        setActive((current) => Math.min(current + 1, Math.max(entries.length - 1, 0)));
        return;
      }
      if (key.key === 'ArrowUp') {
        event.preventDefault();
        setActive((current) => Math.max(current - 1, 0));
        return;
      }
      if ((key.key === 'Enter' || key.key === 'Tab') && entries.length > 0) {
        event.preventDefault();
        pick(active);
        return;
      }
      if (key.key === 'Escape' && query) {
        event.preventDefault();
        setMenuClosed(`${query.kind}:${query.start}`);
        return;
      }
    }
    // Up recalls earlier messages while the box is empty or shows a recalled one (AL-259).
    if ((key.key === 'ArrowUp' || key.key === 'ArrowDown') && (text === '' || recallIndex !== null) && history.length > 0) {
      event.preventDefault();
      const next = recall(history, recallIndex, key.key === 'ArrowUp' ? 'up' : 'down');
      setRecallIndex(next);
      const recalled = next === null ? '' : (history[next] ?? '');
      onChangeText(recalled);
      setCaret(recalled.length);
      return;
    }
    if (!isSendKey(key)) return;
    event.preventDefault();
    submit();
  };

  return (
    <View ref={frame} style={[styles.footer, style]} testID="composer">
      {menuOpen ? (
        <CompletionMenu
          entries={entries}
          active={Math.min(active, Math.max(entries.length - 1, 0))}
          onPick={pick}
          onHover={setActive}
          empty={query?.kind === 'command' ? 'No skill or command matches.' : files.pending ? 'Looking for files…' : 'No file matches.'}
        />
      ) : null}
      <View style={styles.chips}>
        {skills.map((skill) => (
          <Chip key={skill} label={`/${skill}`} accessibilityLabel={`Run /${skill}`} disabled={controls.skillsDisabled || Boolean(pending.skill)} onPress={() => onRunSkill(skill)} testID={`composer-skill-${skill}`} />
        ))}
        {controls.applyModel.disabled ? null : (
          <Button size="sm" variant="soft" label="Apply model now" onPress={onApplyModel} loading={pending.applyModel} testID="composer-apply-model" />
        )}
        <View style={styles.spacer} />
        <Switch
          label="Steer now"
          value={steerNow}
          onValueChange={onSteerNowChange}
          stateText={{ on: 'next tool call', off: 'after the turn' }}
          disabled={controls.sendBlocked || controls.paused}
          testID="composer-steer-now"
        />
      </View>
      {attachments.length > 0 ? (
        <View style={styles.attachments} role="list" aria-label="Attachments" testID="composer-attachments">
          {attachments.map((file) => (
            <View key={file.name} role="listitem" style={styles.attachment}>
              <Icon name={file.kind === 'image' ? 'file' : 'attach'} size={12} color={color.muted} />
              <Text variant="meta" size="xs" numberOfLines={1}>
                {`${file.name} · ${formatBytes(file.bytes)}`}
              </Text>
              <Pressable role="button" aria-label={`Remove ${file.name}`} onPress={() => onRemoveAttachment?.(file.name)} hitSlop={6} testID="composer-attachment-remove">
                <Icon name="close" size={12} color={color.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.inputRow}>
        {/* Capture: the text input stops key events from bubbling (react-native-web #612). */}
        <View style={styles.field} onKeyDownCapture={onKeyDown}>
          <TextField
            ref={field}
            variant="multiline"
            rows={1}
            aria-label="Message the agent"
            placeholder={COMPOSER_PLACEHOLDER}
            value={text}
            onChangeText={change}
            maxLength={AGENT_MESSAGE_LIMIT}
            testID="composer-input"
          />
        </View>
        {onAddFiles ? (
          <Button label="Attach a file" icon="attach" iconOnly onPress={() => void pickFiles().then(onAddFiles)} disabled={controls.sendBlocked} style={styles.square} testID="composer-attach" />
        ) : null}
        {controls.stop.visible ? <Button label="Stop" icon="stop" variant="danger" onPress={() => onStop?.()} loading={pending.stop} testID="composer-stop" /> : null}
        <Button
          label={controls.pause.label}
          icon={controls.pause.icon}
          iconOnly
          onPress={onPauseResume}
          disabled={controls.pause.disabled}
          loading={pending.pause}
          style={styles.square}
          testID="composer-pause"
        />
        <Button variant="primary" label="Send" icon="send" onPress={submit} disabled={!canSend} loading={pending.send} style={styles.send} testID="composer-send" />
      </View>
      <View style={styles.toolsRow}>
        {tools ? <View style={styles.tools}>{tools}</View> : null}
        <View style={styles.spacer} />
        {error ? (
          <Text variant="meta" size="md" color={tone.danger.text} role="alert" testID="composer-error">
            {error}
          </Text>
        ) : controls.note ? (
          <Text variant="meta" size="md" color={controls.paused ? tone.attention.text : undefined} testID="composer-note">
            {controls.note}
          </Text>
        ) : (
          <Text variant="meta" size="xs" color={color.muted} testID="composer-hint">
            / skills and commands · @ files · paste or drop images
          </Text>
        )}
      </View>
    </View>
  );
}

interface ChipProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

/** Artboard 3's skill chips: mono, 34 px, a 1 px line border. Actions and toggles are not chips (AL-259). */
function Chip({ label, onPress, disabled = false, accessibilityLabel, testID }: ChipProps) {
  return (
    <Pressable
      role="button"
      aria-label={accessibilityLabel}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      // The target is 44 px tall (AL-033); the chip drawn inside it is 34 px, as on the artboard.
      style={styles.chipTarget}
      testID={testID}
    >
      {({ pressed }) => (
        <View style={[styles.chip, disabled && styles.chipDisabled, pressed && styles.chipPressed]}>
          <Text variant="mono" size="sm" color={color.ink}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/** Read off artboard 3: a pale band under the stream, chips 8 px apart, a one-line box beside a square pause and Send. */
const styles = StyleSheet.create({
  footer: {
    position: 'relative',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: color.line,
    backgroundColor: color.bg,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  spacer: {
    flexGrow: 1,
  },
  chipTarget: {
    minHeight: minTarget,
    justifyContent: 'center',
    borderRadius: radius.chip,
  },
  chip: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipPressed: {
    opacity: 0.8,
  },
  attachments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
  },
  field: {
    flex: 1,
    minWidth: 0,
  },
  square: {
    width: 48,
  },
  send: {
    minWidth: 96,
  },
  toolsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
  },
  tools: {
    flexShrink: 1,
  },
});
