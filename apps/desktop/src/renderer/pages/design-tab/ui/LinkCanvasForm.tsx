import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { parseDesignCanvasUrl } from '@agent-lanes/contracts';
import { space } from '@agent-lanes/tokens';
import { Button, Text, TextField } from '@agent-lanes/ui';
import { useLinkCanvas, useUnlinkCanvas } from '@/shared/api';

export const NOT_A_CANVAS = "That isn't a Claude Design canvas link. Paste a claude.ai/design/p/… or claude.ai/artifact/… link.";

export interface LinkCanvasFormProps {
  ticketId: string;
  /** The canvas linked now, when the user is changing it; undefined when none is linked. */
  current?: string;
  /** Linked, unlinked or cancelled. */
  onDone?: () => void;
}

/**
 * "Link canvas" (AL-193): a pasted claude.ai Design link (a design project or a Design artifact),
 * checked with `parseDesignCanvasUrl` before it is sent; main checks it again and saves it on the
 * ticket record. When a canvas is linked already, it can be replaced or unlinked here.
 */
export function LinkCanvasForm({ ticketId, current, onDone }: LinkCanvasFormProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const link = useLinkCanvas(ticketId);
  const unlink = useUnlinkCanvas(ticketId);

  const submit = () => {
    if (!parseDesignCanvasUrl(url)) {
      setError(NOT_A_CANVAS);
      return;
    }
    setError(null);
    link.mutate(url, {
      onSuccess: () => onDone?.(),
      onError: (cause) => setError(cause.message),
    });
  };

  return (
    <View style={styles.form} testID="link-canvas-form">
      <Text variant="title" size="lg" role="heading" aria-level={2}>
        {current ? 'Change the canvas' : 'Link a Claude Design canvas'}
      </Text>
      <Text variant="meta" size="md" style={styles.centre}>
        Paste the canvas link from claude.ai. It opens here beside the agent, in every stage.
      </Text>
      <TextField
        label="Canvas link"
        placeholder="https://claude.ai/design/p/…"
        value={url}
        onChangeText={(text) => {
          setUrl(text);
          if (error) setError(null);
        }}
        onSubmitEditing={submit}
        error={error}
        maxLength={2048}
        style={styles.field}
        testID="link-canvas-url"
      />
      <View style={styles.actions}>
        {current ? <Button label="Cancel" onPress={onDone} /> : null}
        {current ? (
          <Button
            label="Unlink canvas"
            variant="danger"
            loading={unlink.isPending}
            onPress={() => unlink.mutate(undefined, { onSuccess: () => onDone?.(), onError: (cause) => setError(cause.message) })}
          />
        ) : null}
        <Button label="Link canvas" variant="primary" icon="link" loading={link.isPending} onPress={submit} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
  },
  centre: {
    textAlign: 'center',
  },
  field: {
    width: '100%',
    maxWidth: 520,
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
  },
});
