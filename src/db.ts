import Database from 'better-sqlite3';
import path from 'node:path';
import type { AlertEvent, ProviderId, UsageSnapshot } from './types.js';

export class Store {
  private db: Database.Database;

  constructor(dataDir: string) {
    this.db = new Database(path.join(dataDir, 'usage.db'));
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        taken_at TEXT NOT NULL,
        raw_json TEXT
      );

      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL,
        provider TEXT NOT NULL,
        taken_at TEXT NOT NULL,
        key TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        label TEXT,
        FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_provider_key_time
        ON metrics(provider, key, taken_at);

      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        type TEXT NOT NULL,
        fired_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        acknowledged_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_fired
        ON alerts(fired_at DESC);

      -- Tracks which budget thresholds we've already fired this month
      -- so we don't spam (e.g. fire 75% only once per cycle).
      CREATE TABLE IF NOT EXISTS alert_state (
        provider TEXT NOT NULL,
        period TEXT NOT NULL,
        threshold INTEGER NOT NULL,
        fired_at TEXT NOT NULL,
        PRIMARY KEY (provider, period, threshold)
      );
    `);
  }

  saveSnapshot(snap: UsageSnapshot): number {
    const txn = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO snapshots (provider, taken_at, raw_json)
           VALUES (?, ?, ?)`
        )
        .run(snap.provider, snap.takenAt, snap.raw ? JSON.stringify(snap.raw) : null);
      const snapshotId = info.lastInsertRowid as number;

      const insertMetric = this.db.prepare(
        `INSERT INTO metrics (snapshot_id, provider, taken_at, key, value, unit, label)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const m of snap.metrics) {
        insertMetric.run(
          snapshotId,
          snap.provider,
          snap.takenAt,
          m.key,
          m.value,
          m.unit ?? null,
          m.label ?? null
        );
      }
      return snapshotId;
    });
    return txn();
  }

  /** Latest value for a (provider, metric) pair. */
  latestMetric(provider: ProviderId, key: string): { value: number; takenAt: string } | null {
    const row = this.db
      .prepare(
        `SELECT value, taken_at as takenAt FROM metrics
         WHERE provider = ? AND key = ?
         ORDER BY taken_at DESC LIMIT 1`
      )
      .get(provider, key) as { value: number; takenAt: string } | undefined;
    return row ?? null;
  }

  /** Time series for charting. */
  metricSeries(
    provider: ProviderId,
    key: string,
    sinceISO: string
  ): Array<{ takenAt: string; value: number }> {
    return this.db
      .prepare(
        `SELECT taken_at as takenAt, value FROM metrics
         WHERE provider = ? AND key = ? AND taken_at >= ?
         ORDER BY taken_at ASC`
      )
      .all(provider, key, sinceISO) as Array<{ takenAt: string; value: number }>;
  }

  recordAlert(alert: AlertEvent): number {
    const info = this.db
      .prepare(
        `INSERT INTO alerts (provider, type, fired_at, payload)
         VALUES (?, ?, ?, ?)`
      )
      .run(alert.provider, alert.type, alert.firedAt, alert.payload);
    return info.lastInsertRowid as number;
  }

  recentAlerts(limit = 50): AlertEvent[] {
    return this.db
      .prepare(
        `SELECT id, provider, type, fired_at as firedAt, payload, acknowledged_at as acknowledgedAt
         FROM alerts ORDER BY fired_at DESC LIMIT ?`
      )
      .all(limit) as AlertEvent[];
  }

  /** Has this threshold already fired in this period? */
  thresholdAlreadyFired(provider: ProviderId, period: string, threshold: number): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM alert_state
         WHERE provider = ? AND period = ? AND threshold = ?`
      )
      .get(provider, period, threshold);
    return Boolean(row);
  }

  markThresholdFired(provider: ProviderId, period: string, threshold: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO alert_state (provider, period, threshold, fired_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(provider, period, threshold, new Date().toISOString());
  }

  acknowledgeAlert(id: number): void {
    this.db
      .prepare(`UPDATE alerts SET acknowledged_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  }
}
