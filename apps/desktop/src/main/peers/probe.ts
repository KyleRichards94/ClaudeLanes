import { WebSocket } from 'ws';
import { parsePeerAddress, type PeerFrom, type PeerProbe } from '@agent-lanes/contracts';
import { PEER_FRAME_MAX_BYTES } from './network';
import { openFrame } from './signer';

export const PROBE_TIMEOUT_MS = 5_000;

/**
 * Connections › Test for the Peers tab (AL-289): dials each listed peer and checks the `hello` it
 * sends on connect against the draft's team secret. Sends nothing back, so the running connection
 * between the two apps is left alone.
 */
export function probePeers(addresses: readonly string[], secret: string, self: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<PeerProbe[]> {
  return Promise.all(addresses.map((address) => probeOne(address, secret, self, options.timeoutMs ?? PROBE_TIMEOUT_MS, options.signal)));
}

function probeOne(address: string, secret: string, self: string, timeoutMs: number, signal?: AbortSignal): Promise<PeerProbe> {
  const result = (outcome: PeerProbe['outcome'], message: string | null, from?: PeerFrom): PeerProbe => ({ address, outcome, user: from?.user ?? null, host: from?.host ?? null, message });
  const parsed = parsePeerAddress(address);
  if (!parsed) return Promise.resolve(result('unreachable', 'Not a computer name or IP address.'));
  return new Promise((done) => {
    const host = parsed.host.includes(':') ? `[${parsed.host}]` : parsed.host;
    const ws = new WebSocket(`ws://${host}:${parsed.port}/`, { maxPayload: PEER_FRAME_MAX_BYTES, handshakeTimeout: timeoutMs });
    let settled = false;
    const finish = (probe: PeerProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.terminate();
      done(probe);
    };
    const timer = setTimeout(() => finish(result('unreachable', 'It connected but sent nothing.')), timeoutMs);
    signal?.addEventListener('abort', () => finish(result('unreachable', 'The test was stopped.')), { once: true });
    ws.on('unexpected-response', (_request, response) =>
      finish(result('unreachable', response.statusCode === 403 ? 'It refused the connection: this computer is not in its peer list.' : `It answered HTTP ${response.statusCode}.`)),
    );
    ws.on('error', (error) => finish(result('unreachable', `Could not connect: ${(error as { code?: string }).code ?? error.message}`)));
    ws.on('message', (data) => {
      const opened = openFrame(data.toString(), secret);
      if (opened.ok) finish(opened.frame.from.instance === self ? result('unreachable', 'That address is this app.') : result('answered', null, opened.frame.from));
      else if (opened.reason === 'signature') finish(result('rejected', 'It signs with a different team secret.'));
      else finish(result('unreachable', 'It answered with something that is not a peer frame.'));
    });
  });
}
