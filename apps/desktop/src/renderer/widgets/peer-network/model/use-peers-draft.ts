import { useState } from 'react';
import { DEFAULT_PEER_BEACON_PORT, DEFAULT_PEER_PORT, parsePeerAddress, type PeersConnectionSummary } from '@agent-lanes/contracts';
import type { ConnectionDraftController, DraftStatus } from '@/entities/connection';
import { useReplaceConnection, useSaveConnection, type ConnectionDraftInput } from '@/shared/api';

export function portError(port: string): string | null {
  const value = Number(port.trim());
  return Number.isInteger(value) && value >= 1 && value <= 65_535 ? null : 'Use a port from 1 to 65535.';
}

export function addressError(address: string, all: readonly string[]): string | null {
  const text = address.trim();
  if (text === '') return null;
  if (!parsePeerAddress(text)) return `Use a computer name or IP address, with :port when it isn't ${DEFAULT_PEER_PORT}.`;
  return all.filter((other) => other.trim().toLowerCase() === text.toLowerCase()).length > 1 ? 'Listed twice.' : null;
}

interface Values {
  port: string;
  beaconPort: string;
  /** One row per address; an empty row is ignored. */
  addresses: string[];
}

function valuesOf(row: PeersConnectionSummary | undefined): Values {
  return {
    port: String(row?.port ?? DEFAULT_PEER_PORT),
    beaconPort: String(row?.beaconPort ?? DEFAULT_PEER_BEACON_PORT),
    addresses: row && row.addresses.length > 0 ? [...row.addresses] : [''],
  };
}

function same(a: Values, b: Values): boolean {
  const listed = (values: Values) => values.addresses.map((address) => address.trim()).filter(Boolean).join('\n');
  return a.port.trim() === b.port.trim() && a.beaconPort.trim() === b.beaconPort.trim() && listed(a) === listed(b);
}

export interface PeersDraft extends ConnectionDraftController, Values {
  setPort(value: string): void;
  setBeaconPort(value: string): void;
  portError: string | null;
  beaconPortError: string | null;
  setAddress(index: number, value: string): void;
  addAddress(): void;
  removeAddress(index: number): void;
  addressErrors: Array<string | null>;
  /** Starts from what is saved, or the defaults. */
  load(row: PeersConnectionSummary | undefined): void;
  saveError: string | null;
}

/**
 * The Peers tab's Advanced settings (AL-298): the two ports and the addresses of apps the beacon can't
 * reach. Nothing to test: a valid change is ready for Save connections.
 */
export function usePeersDraft(): PeersDraft {
  const saveConnection = useSaveConnection();
  const replaceConnection = useReplaceConnection();
  const [saved, setSaved] = useState<PeersConnectionSummary | undefined>(undefined);
  const [values, setValues] = useState<Values>(() => valuesOf(undefined));
  const [saveError, setSaveError] = useState<string | null>(null);

  const addressErrors = values.addresses.map((address) => addressError(address, values.addresses));
  const badPort = portError(values.port);
  const badBeaconPort = portError(values.beaconPort);
  const valid = !badPort && !badBeaconPort && addressErrors.every((error) => error === null);
  const status: DraftStatus = same(values, valuesOf(saved)) ? 'empty' : valid ? 'passed' : 'untested';

  function edit(change: (current: Values) => Values) {
    setValues(change);
    setSaveError(null);
  }

  function draft(): ConnectionDraftInput {
    return {
      kind: 'peers',
      port: Number(values.port.trim()),
      beaconPort: Number(values.beaconPort.trim()),
      addresses: values.addresses.map((address) => address.trim()).filter(Boolean),
    };
  }

  return {
    ...values,
    setPort: (port) => edit((current) => ({ ...current, port })),
    setBeaconPort: (beaconPort) => edit((current) => ({ ...current, beaconPort })),
    portError: badPort,
    beaconPortError: badBeaconPort,
    setAddress: (index, value) => edit((current) => ({ ...current, addresses: current.addresses.map((address, at) => (at === index ? value : address)) })),
    addAddress: () => edit((current) => ({ ...current, addresses: [...current.addresses, ''] })),
    removeAddress: (index) => edit((current) => ({ ...current, addresses: current.addresses.length === 1 ? [''] : current.addresses.filter((_, at) => at !== index) })),
    addressErrors,
    load(row) {
      setSaved(row);
      setValues(valuesOf(row));
      setSaveError(null);
    },
    status,
    saving: saveConnection.isPending || replaceConnection.isPending,
    saveError,
    async save() {
      if (status !== 'passed') return;
      try {
        if (saved) await replaceConnection.mutateAsync({ id: saved.id, draft: draft() });
        else await saveConnection.mutateAsync(draft());
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Saving failed.');
        throw error;
      }
    },
    clear() {
      setValues(valuesOf(saved));
      setSaveError(null);
    },
  };
}
