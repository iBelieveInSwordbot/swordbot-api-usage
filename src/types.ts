/**
 * Shared types for Swordbot API Usage.
 *
 * Long-format metrics (provider, key, value) make adding new metrics
 * zero-migration.
 */

export type ProviderId = 'google' | 'openai' | 'anthropic';

export interface UsageSnapshot {
  provider: ProviderId;
  /** ISO timestamp the snapshot was taken */
  takenAt: string;
  metrics: UsageMetric[];
  /** Anything the provider gave us we couldn't normalize */
  raw?: unknown;
}

export interface UsageMetric {
  /** e.g. "spend_mtd_usd", "requests_24h", "tokens_in_24h" */
  key: string;
  value: number;
  unit?: string;
  label?: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: string;
  brandColor: string;
  /** Whether the adapter has the credentials it needs */
  isConfigured(): boolean;
  /** Fetch the latest usage snapshot. May throw. */
  fetchSnapshot(): Promise<UsageSnapshot>;
}

export interface AlertEvent {
  id?: number;
  provider: ProviderId;
  type: AlertType;
  firedAt: string;
  payload: string; // JSON
  acknowledgedAt?: string | null;
}

export type AlertType =
  | 'budget_threshold'
  | 'spend_anomaly'
  | 'fetch_error';
