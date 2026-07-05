import { request } from 'undici';
import type { ProviderAdapter, UsageSnapshot } from '../types.js';

/**
 * Google (Gemini API) adapter.
 *
 * The Generative Language API (`generativelanguage.googleapis.com`)
 * doesn't expose per-account spend directly — that lives in Cloud
 * Billing, which needs OAuth + a billing account id, not just an API
 * key. For the MVP we:
 *
 *   - Validate the API key by listing models (proves the key works).
 *   - Surface model count + a service_alive metric.
 *   - Leave spend_mtd_usd at 0 with a label noting Cloud Billing
 *     credentials would unlock real spend.
 *
 * That keeps us honest — no fake numbers — while the dashboard tile
 * still has something to show.
 */
export class GoogleAdapter implements ProviderAdapter {
  id = 'google' as const;
  displayName = 'Google · Gemini';
  brandColor = '#4285F4'; // Google blue

  constructor(private apiKey?: string) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchSnapshot(): Promise<UsageSnapshot> {
    const takenAt = new Date().toISOString();
    if (!this.apiKey) throw new Error('GOOGLE_API_KEY not set');

    const res = await request(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(this.apiKey)}`,
      { headers: { 'content-type': 'application/json' } }
    );
    if (res.statusCode >= 400) {
      const body = await res.body.text();
      throw new Error(`Google models HTTP ${res.statusCode}: ${body.slice(0, 200)}`);
    }
    const json = (await res.body.json()) as { models?: Array<{ name: string }> };

    return {
      provider: 'google',
      takenAt,
      metrics: [
        {
          key: 'spend_mtd_usd',
          value: 0,
          unit: 'USD',
          label: 'Spend MTD (Cloud Billing creds required)',
        },
        {
          key: 'models_available',
          value: json.models?.length ?? 0,
          label: 'Models available',
        },
        { key: 'service_alive', value: 1, label: 'API key valid' },
      ],
      raw: { modelCount: json.models?.length ?? 0 },
    };
  }
}
