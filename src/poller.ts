import type { AlertEngine } from './alerts.js';
import type { Store } from './db.js';
import type { ProviderAdapter } from './types.js';

export interface PollResult {
  provider: string;
  ok: boolean;
  error?: string;
  metrics?: number;
}

export async function pollAll(
  adapters: ProviderAdapter[],
  store: Store,
  alerts: AlertEngine
): Promise<PollResult[]> {
  const out: PollResult[] = [];

  await Promise.all(
    adapters.map(async (adapter) => {
      if (!adapter.isConfigured()) {
        out.push({ provider: adapter.id, ok: false, error: 'not_configured' });
        return;
      }
      try {
        const snap = await adapter.fetchSnapshot();
        store.saveSnapshot(snap);
        await alerts.evaluate(snap);
        out.push({ provider: adapter.id, ok: true, metrics: snap.metrics.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await alerts.fetchError(adapter.id, message);
        out.push({ provider: adapter.id, ok: false, error: message });
      }
    })
  );

  return out;
}
