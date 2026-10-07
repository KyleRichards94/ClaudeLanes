import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  adoScopeChips,
  adoScopeRequirement,
  formatAdoConnectionDetails,
  type AdoConnectionSummary,
  type AdoScopeChipState,
  type ConnectionId,
} from '@agent-lanes/contracts';
import { space, tone } from '@agent-lanes/tokens';
import { Button, Pill, Text, TextField, type PillTone } from '@agent-lanes/ui';
import { ConnectionForm, ConnectionRow, RemoveConnectionButton, TestOutcome, connectionStatusView } from '@/entities/connection';
import { useRemoveConnection, useTestConnection } from '@/shared/api';
import type { AdoDraft } from '../model/use-ado-draft';

/** Help under the URL field for an on-premises server without TLS: allowed, but said out loud. */
export const PLAIN_HTTP_WARNING = 'Plain http: the token is sent unencrypted. Use it only on a trusted internal network.';

/** True when the typed organisation URL is plain http. The main process decides what it accepts. */
export function usesPlainHttp(orgUrl: string): boolean {
  return /^\s*http:\/\//i.test(orgUrl);
}

/** Help under the token field (artboard 5). */
export const PAT_HELP =
  'Needs Work Items (read & write), Code (read & write) and Build (read). Create one in Azure DevOps under User settings › Personal access tokens.';

const chipTone: Record<AdoScopeChipState, PillTone> = {
  untested: 'neutral',
  granted: 'ok',
  missing: 'danger',
  unverified: 'attention',
};

/** The chip's word, so a missing scope never rests on the red alone (design §11). */
const chipWord: Record<AdoScopeChipState, string> = {
  untested: '',
  granted: ' · ok',
  missing: ' · missing',
  unverified: ' · not checked',
};

interface AdoConnectionsPanelProps {
  draft: AdoDraft;
  rows: readonly AdoConnectionSummary[];
  /** The saved row a Reconnect landed on: its token is replaced, with the PAT field focused. */
  target: ConnectionId | null;
  /** Changes on every open of the modal, so the same target is focused again. */
  request: number;
  /** "Now", for the expiry wording; injectable for tests. */
  now?: Date;
}

/** The Azure DevOps tab (AL-046, artboard 5): one row per saved organisation, then the draft row. */
export function AdoConnectionsPanel({ draft, rows, target, request, now = new Date() }: AdoConnectionsPanelProps) {
  const testSaved = useTestConnection();
  const removeConnection = useRemoveConnection();
  const [testingId, setTestingId] = useState<ConnectionId | null>(null);
  const targetRow = rows.find((row) => row.id === target);
  const { startReplace, patRef } = draft;

  // A Reconnect lands on its row: replace that row's token, with the PAT field focused.
  useEffect(() => {
    if (!targetRow) return;
    startReplace(targetRow);
    const timer = setTimeout(() => patRef.current?.focus(), 0);
    return () => clearTimeout(timer);
    // Only when a new open asks for it; editing the row's data must not restart the replace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, targetRow?.id]);

  function retest(id: ConnectionId) {
    setTestingId(id);
    testSaved.mutate({ id }, { onSettled: () => setTestingId(null) });
  }

  const replacing = draft.mode.kind === 'replace' ? draft.mode.row : null;
  const chips = adoScopeChips(draft.test.result?.scopes ?? []);

  return (
    <View style={styles.panel} testID="connections-ado">
      {rows.map((row) => {
        const missing = row.missingScopes.length > 0 ? `Missing ${row.missingScopes.map(adoScopeRequirement).join(', ')}.` : null;
        return (
          <ConnectionRow
            key={row.id}
            name={row.name}
            status={connectionStatusView(row)}
            details={formatAdoConnectionDetails(row, now)}
            problem={row.status === 'error' ? (row.statusMessage ?? 'The last test failed.') : missing}
            highlighted={replacing?.id === row.id}
            testID={`connection-${row.id}`}
            actions={
              <>
                <Button label="Test" variant="secondary" size="sm" loading={testingId === row.id} onPress={() => retest(row.id)} testID={`connection-${row.id}-test`} />
                <Button label="Replace" variant="secondary" size="sm" onPress={() => startReplace(row)} testID={`connection-${row.id}-replace`} />
                <RemoveConnectionButton
                  name={row.name}
                  busy={removeConnection.isPending}
                  onRemove={() => removeConnection.mutate(row.id)}
                  testID={`connection-${row.id}-remove`}
                />
              </>
            }
          />
        );
      })}

      <ConnectionForm
        title={replacing ? `Replace the token for ${replacing.name}` : rows.length === 0 ? 'Add an organisation' : 'Add another organisation'}
        aside={replacing ? <Button label="Cancel replace" variant="secondary" size="sm" onPress={draft.cancelReplace} /> : undefined}
        testID="ado-draft"
      >
        <View style={styles.pair}>
          <TextField
            label="Organisation URL"
            placeholder="https://dev.azure.com/your-organisation"
            value={draft.orgUrl}
            onChangeText={draft.setOrgUrl}
            inputMode="url"
            autoComplete="off"
            help={usesPlainHttp(draft.orgUrl) ? PLAIN_HTTP_WARNING : undefined}
            style={styles.half}
            testID="ado-org-url"
          />
          <TextField
            label="Default project"
            placeholder="Loaded after the token is tested"
            value={draft.defaultProject}
            onChangeText={draft.setDefaultProject}
            disabled={!draft.projects}
            error={draft.projectError}
            help={draft.projects && draft.projects.length > 0 ? `Projects: ${draft.projects.slice(0, 6).join(', ')}${draft.projects.length > 6 ? ', …' : ''}` : undefined}
            style={styles.half}
            testID="ado-default-project"
          />
        </View>
        <TextField
          ref={patRef}
          variant="secure"
          label="Personal access token"
          onSecretChange={draft.onPatChange}
          onSubmitEditing={() => {
            if (draft.canTest) void draft.runTest();
          }}
          accessory={
            <Button
              label="Test connection"
              variant="secondary"
              loading={draft.test.state === 'testing'}
              disabled={!draft.canTest && draft.test.state !== 'testing'}
              onPress={() => void draft.runTest()}
              testID="ado-test-connection"
            />
          }
          testID="ado-pat"
        />
        <View style={styles.chips} role="list" aria-label="Token scopes">
          {chips.map((chip) => (
            <View key={chip.scope} role="listitem" aria-label={`${chip.label}: ${chip.state === 'untested' ? 'not tested yet' : chip.detail}`}>
              <Pill tone={chipTone[chip.state]} dot label={`${chip.label}${chipWord[chip.state]}`} testID={`ado-scope-${chip.scope}`} />
            </View>
          ))}
        </View>
        <Text variant="meta">{PAT_HELP}</Text>
        <TextField
          label="Token expires (optional)"
          placeholder="YYYY-MM-DD"
          value={draft.expiresAt}
          onChangeText={draft.setExpiresAt}
          error={draft.expiryError}
          help="Azure DevOps doesn't tell the app; the row warns a week before."
          maxLength={10}
          style={styles.expiry}
          testID="ado-expires"
        />
        <TestOutcome
          test={draft.test}
          passedText={`Connection works${draft.test.result?.identity ? ` · signed in as ${draft.test.result.identity}` : ''}${
            draft.test.result && draft.test.result.missingScopes.length > 0
              ? ` · missing ${draft.test.result.missingScopes.map(adoScopeRequirement).join(', ')}`
              : ''
          }`}
          testID="ado-test-outcome"
        />
        {draft.saveError ? (
          <Text variant="meta" color={tone.danger.text} role="alert">
            {draft.saveError}
          </Text>
        ) : null}
      </ConnectionForm>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space.lg,
  },
  pair: {
    flexDirection: 'row',
    gap: space.md,
  },
  half: {
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  expiry: {
    width: 320,
  },
});
