import type { ProviderAdapter, ProviderId, UsageSnapshot } from '../types.js';

/**
 * Demo adapter — wraps a provider id with deterministic-but-realistic
 * synthetic data. Used when DEMO_MODE=true OR when a real provider is
 * unconfigured, so the Material dashboard always has something to show.
 *
 * The numbers drift slowly with time so the chart actually moves.
 */
export class DemoAdapter implements ProviderAdapter {
  brandColor: string;
  displayName: string;
  constructor(
    public id: ProviderId,
    displayName: string,
    brandColor: string,
    private baseSpend: number,
    private hourlyRate: number
  ) {
    this.displayName = `${displayName} (demo)`;
    this.brandColor = brandColor;
  }

  isConfigured(): boolean { return true; }

  async fetchSnapshot(): Promise<UsageSnapshot> {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const hourOfDay = now.getHours();
    // Simple "monthly accumulation" curve: base + days_so_far * daily +
    // jitter from hour, so spend is monotonically rising-ish.
    const jitter = Math.sin((hourOfDay / 24) * Math.PI * 2) * (this.hourlyRate * 4);
    const spend = this.baseSpend +
      (dayOfMonth - 1) * this.hourlyRate * 24 +
      hourOfDay * this.hourlyRate +
      jitter;

    const requests = Math.round(spend * 320 + 1500);

    return {
      provider: this.id,
      takenAt: now.toISOString(),
      metrics: [
        { key: 'spend_mtd_usd', value: round2(spend), unit: 'USD', label: 'Month-to-date spend' },
        { key: 'requests_24h', value: requests, label: 'Requests (24h)' },
        { key: 'tokens_in_24h', value: requests * 850, label: 'Input tokens (24h)' },
        { key: 'tokens_out_24h', value: requests * 320, label: 'Output tokens (24h)' },
        { key: 'avg_latency_ms', value: round1(550 + jitter * 30), unit: 'ms', label: 'Avg latency' },
      ],
    };
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round1(n: number): number { return Math.round(n * 10) / 10; }
