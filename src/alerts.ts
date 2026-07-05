import { request } from 'undici';
import type { AppConfig } from './config.js';
import type { Store } from './db.js';
import type { AlertEvent, ProviderId, UsageSnapshot } from './types.js';

/**
 * Alerting engine.
 *
 * Runs after each snapshot. Fires alerts for:
 *   1. Budget thresholds (50/75/90/100% of monthly limit)
 *   2. Spend anomalies (3× yesterday's hourly pace, MVP heuristic)
 *
 * State is deduped per (provider, period, threshold) so we don't spam.
 */
export class AlertEngine {
  constructor(private store: Store, private cfg: AppConfig) {}

  async evaluate(snap: UsageSnapshot): Promise<AlertEvent[]> {
    const fired: AlertEvent[] = [];

    fired.push(...this.checkBudget(snap));
    fired.push(...this.checkAnomaly(snap));

    for (const a of fired) {
      const id = this.store.recordAlert(a);
      a.id = id;
      await this.notify(a);
    }
    return fired;
  }

  /** Fire an alert when we can't fetch a provider at all. */
  async fetchError(provider: ProviderId, message: string): Promise<void> {
    const alert: AlertEvent = {
      provider,
      type: 'fetch_error',
      firedAt: new Date().toISOString(),
      payload: JSON.stringify({ message }),
    };
    this.store.recordAlert(alert);
    // Don't spam Slack on every poll — only notify once per hour per provider.
    // (Simple in-memory rate-limit is fine here for an MVP.)
    if (this.shouldNotifyFetchError(provider)) {
      await this.notify(alert);
    }
  }

  private fetchErrorLastNotified = new Map<ProviderId, number>();
  private shouldNotifyFetchError(provider: ProviderId): boolean {
    const now = Date.now();
    const last = this.fetchErrorLastNotified.get(provider) ?? 0;
    if (now - last < 60 * 60 * 1000) return false;
    this.fetchErrorLastNotified.set(provider, now);
    return true;
  }

  private checkBudget(snap: UsageSnapshot): AlertEvent[] {
    const limit = this.cfg.budgets[snap.provider];
    if (!limit || limit <= 0) return [];

    const spendMetric = snap.metrics.find((m) => m.key === 'spend_mtd_usd');
    if (!spendMetric) return [];

    const pct = (spendMetric.value / limit) * 100;
    const period = thisPeriod();
    const out: AlertEvent[] = [];

    for (const threshold of this.cfg.alertThresholds) {
      if (pct >= threshold && !this.store.thresholdAlreadyFired(snap.provider, period, threshold)) {
        this.store.markThresholdFired(snap.provider, period, threshold);
        out.push({
          provider: snap.provider,
          type: 'budget_threshold',
          firedAt: snap.takenAt,
          payload: JSON.stringify({
            threshold,
            spendUsd: spendMetric.value,
            limitUsd: limit,
            pct: round1(pct),
            period,
          }),
        });
      }
    }
    return out;
  }

  /**
   * Spend anomaly detection: compare last 1h of spend growth vs the
   * previous 24h average hourly growth. If 3× → fire.
   */
  private checkAnomaly(snap: UsageSnapshot): AlertEvent[] {
    const spend = snap.metrics.find((m) => m.key === 'spend_mtd_usd');
    if (!spend) return [];

    const now = new Date(snap.takenAt);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const series24h = this.store.metricSeries(snap.provider, 'spend_mtd_usd', oneDayAgo);
    if (series24h.length < 4) return []; // not enough data yet

    const seriesPriorHour = series24h.filter((p) => p.takenAt < oneHourAgo);
    if (seriesPriorHour.length < 2) return [];

    const lastPriorHourValue = seriesPriorHour[seriesPriorHour.length - 1].value;
    const firstValue = series24h[0].value;
    const hoursSpan =
      (new Date(seriesPriorHour[seriesPriorHour.length - 1].takenAt).getTime() -
        new Date(series24h[0].takenAt).getTime()) /
      (60 * 60 * 1000);
    if (hoursSpan <= 0) return [];

    const baselineHourlyGrowth = Math.max(
      (lastPriorHourValue - firstValue) / hoursSpan,
      0.0001 // avoid div-by-zero
    );
    const lastHourGrowth = Math.max(spend.value - lastPriorHourValue, 0);

    if (lastHourGrowth >= baselineHourlyGrowth * 3 && lastHourGrowth >= 0.5) {
      // De-dupe per hour.
      const period = `anomaly-${now.toISOString().slice(0, 13)}`;
      if (!this.store.thresholdAlreadyFired(snap.provider, period, 1)) {
        this.store.markThresholdFired(snap.provider, period, 1);
        return [
          {
            provider: snap.provider,
            type: 'spend_anomaly',
            firedAt: snap.takenAt,
            payload: JSON.stringify({
              lastHourGrowthUsd: round2(lastHourGrowth),
              baselineHourlyGrowthUsd: round2(baselineHourlyGrowth),
              ratio: round1(lastHourGrowth / baselineHourlyGrowth),
            }),
          },
        ];
      }
    }
    return [];
  }

  private async notify(alert: AlertEvent): Promise<void> {
    const url = this.cfg.slackWebhookUrl;
    if (!url) return;
    const text = formatSlackText(alert);
    try {
      await request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (err) {
      // We don't recursively alert on alert failures.
      console.error('[alerts] slack notify failed:', err);
    }
  }
}

function formatSlackText(alert: AlertEvent): string {
  const p = JSON.parse(alert.payload || '{}');
  switch (alert.type) {
    case 'budget_threshold':
      return `:money_with_wings: *${alert.provider}* hit *${p.threshold}%* of monthly budget — $${p.spendUsd} / $${p.limitUsd} (${p.pct}%)`;
    case 'spend_anomaly':
      return `:rotating_light: *${alert.provider}* spend anomaly — last hour $${p.lastHourGrowthUsd} vs baseline $${p.baselineHourlyGrowthUsd}/h (${p.ratio}×)`;
    case 'fetch_error':
      return `:x: *${alert.provider}* fetch failed: ${p.message}`;
  }
}

function thisPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
