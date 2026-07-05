import { request } from 'undici';
import type { ProviderAdapter, UsageSnapshot } from '../types.js';

/**
 * OpenAI billing/usage adapter.
 *
 * Uses the dashboard billing endpoint:
 *   GET /v1/dashboard/billing/usage?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 * This requires a session-class key on most accounts. If it 401s we
 * surface that instead of inventing numbers.
 */
export class OpenAIAdapter implements ProviderAdapter {
  id = 'openai' as const;
  displayName = 'OpenAI';
  brandColor = '#10A37F'; // OpenAI green

  constructor(private apiKey?: string) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchSnapshot(): Promise<UsageSnapshot> {
    const takenAt = new Date().toISOString();
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');

    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const startStr = toYMD(start);
    const endStr = toYMD(addDays(today, 1));

    const url = `https://api.openai.com/v1/dashboard/billing/usage?start_date=${startStr}&end_date=${endStr}`;
    const res = await request(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (res.statusCode >= 400) {
      const body = await res.body.text();
      throw new Error(`OpenAI usage HTTP ${res.statusCode}: ${body.slice(0, 200)}`);
    }
    const usage = (await res.body.json()) as {
      total_usage?: number; // cents
      daily_costs?: Array<{ timestamp: number; line_items: Array<{ name: string; cost: number }> }>;
    };

    const spendMtdUsd = (usage.total_usage ?? 0) / 100;

    return {
      provider: 'openai',
      takenAt,
      metrics: [
        {
          key: 'spend_mtd_usd',
          value: round2(spendMtdUsd),
          unit: 'USD',
          label: 'Month-to-date spend',
        },
        {
          key: 'days_billed',
          value: usage.daily_costs?.length ?? 0,
          label: 'Days with billing activity',
        },
      ],
      raw: usage,
    };
  }
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
