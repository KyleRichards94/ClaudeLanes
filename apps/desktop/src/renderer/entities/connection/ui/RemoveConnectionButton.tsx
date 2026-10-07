import { useState } from 'react';
import { Button } from '@agent-lanes/ui';

interface RemoveConnectionButtonProps {
  /** The row's name, for the buttons' accessible names ("Remove CompanionSystems"). */
  name: string;
  /** Deletes the connection and its token. */
  onRemove: () => void;
  busy?: boolean;
  testID?: string;
}

/**
 * Remove (artboard 5) with a second step: the first press asks, the second removes, Keep backs out.
 * Removing deletes the saved token, which can't be shown or brought back.
 */
export function RemoveConnectionButton({ name, onRemove, busy = false, testID }: RemoveConnectionButtonProps) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return <Button label="Remove" variant="danger" size="sm" onPress={() => setConfirming(true)} testID={testID} />;
  }
  return (
    <>
      <Button label="Keep" variant="secondary" size="sm" onPress={() => setConfirming(false)} testID={testID ? `${testID}-keep` : undefined} />
      <Button
        label={`Remove ${name}`}
        variant="danger"
        size="sm"
        loading={busy}
        onPress={onRemove}
        testID={testID ? `${testID}-confirm` : undefined}
      />
    </>
  );
}
