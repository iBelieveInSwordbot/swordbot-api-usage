/**
 * Seed the SQLite store with 7 days of believable demo data so the
 * dashboard chart looks alive on first load.
 *
 *   npm run seed
 */
import { loadConfig } from '../config.js';
import { Store } from '../db.js';
import type { UsageSnapshot, ProviderId } from '../types.js';

interface Seed {
  id: ProviderId;
  base: number;        // base USD spend at start of month
  hourly: number;      // USD per hour growth
  reqsPerUsd: number;  // synthetic requests per USD
}

const SEEDS: Seed[] = [
  { id: 'google',    base: 12.50, hourly: 0.42, reqsPerUsd: 380 },
  { id: 'openai',    base: 28.00, hourly: 0.95, reqsPerUsd: 290 },
  { id: 'anthropic', base: 41.00, hourly: 1.45, reqsPerUsd: 220 },
];

function diurnalJitter(hour: number, hourly: number) {
  // Slight daytime bump, valley overnight.
  return Math.sin((hour / 24) * Math.PI * 2) * hourly * 4;
}

async function main() {
  const cfg = loadConfig();
  const store = new Store(cfg.dataDir);

  const now = Date.now();
  const HOURS = 24 * 7;
  const STEP_MIN = 30;
  let inserted = 0;

  for (let mins = HOURS * 60; mins >= 0; mins -= STEP_MIN) {
    const t = new Date(now - mins * 60 * 1000);
    const monthStart = new Date(t.getFullYear(), t.getMonth(), 1).getTime();
    const hoursIntoMonth = Math.max((t.getTime() - monthStart) / (60 * 60 * 1000), 0);
    const hod = t.getHours();

    for (const s of SEEDS) {
      const spend = s.base + hoursIntoMonth * s.hourly + diurnalJitter(hod, s.hourly);
      const requests = Math.round(spend * s.reqsPerUsd + 1500);
      const snap: UsageSnapshot = {
        provider: s.id,
        takenAt: t.toISOString(),
        metrics: [
          { key: 'spend_mtd_usd', value: round2(spend), unit: 'USD', label: 'Month-to-date spend' },
          { key: 'requests_24h', value: requests, label: 'Requests (24h)' },
          { key: 'tokens_in_24h', value: requests * 850, label: 'Input tokens (24h)' },
          { key: 'tokens_out_24h', value: requests * 320, label: 'Output tokens (24h)' },
          { key: 'avg_latency_ms', value: round1(550 + diurnalJitter(hod, 1) * 30), unit: 'ms', label: 'Avg latency' },
        ],
      };
      store.saveSnapshot(snap);
      inserted++;
    }
  }
  console.log(`seeded ${inserted} snapshots across ${SEEDS.length} providers`);
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round1(n: number): number { return Math.round(n * 10) / 10; }

main().catch((err) => { console.error(err); process.exit(1); });
