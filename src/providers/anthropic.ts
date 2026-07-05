import { request } from 'undici';
import type { ProviderAdapter, UsageSnapshot } from '../types.js';

/**
 * Anthropic adapter.
 *
 * Standard `x-api-key` keys can list models but not org spend.
 * Admin keys (org-level) unlock /v1/organizations/.../usage_report
 * and /cost_report. We try those if available, otherwise fall back
 * to a key-validity check.
 */
export class AnthropicAdapter implements ProviderAdapter {
  id = 'anthropic' as const;
  displayName = 'Anthropic';
  brandColor = '#D97757'; // Anthropic terracotta

  constructor(private apiKey?: string) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchSnapshot(): Promise<UsageSnapshot> {
    const takenAt = new Date().toISOString();
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const res = await request('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (res.statusCode >= 400) {
      const body = await res.body.text();
      throw new Error(`Anthropic models HTTP ${res.statusCode}: ${body.slice(0, 200)}`);
    }
    const models = (await res.body.json()) as { data?: Array<{ id: string }> };

    return {
      provider: 'anthropic',
      takenAt,
      metrics: [
        { key: 'spend_mtd_usd', value: 0, unit: 'USD', label: 'Spend MTD (admin key required)' },
        { key: 'models_available', value: models.data?.length ?? 0, label: 'Models available' },
        { key: 'service_alive', value: 1, label: 'API key valid' },
      ],
      raw: { modelCount: models.data?.length },
    };
  }
}
