/**
 * Synthesize a snapshot that should trigger budget + credits alerts so
 * we can verify the alerting + Slack pipeline end-to-end.
 *
 *   npm run alerts:test
 */
import { loadConfig } from '../config.js';
import { Store } from '../db.js';
import { AlertEngine } from '../alerts.js';
import type { UsageSnapshot } from '../types.js';

async function main() {
  const cfg = loadConfig();
  const store = new Store(cfg.dataDir);
  const alerts = new AlertEngine(store, cfg);

  // Force a "75% of budget" condition for OpenAI if budget is set,
  // otherwise pretend the budget is $100 just for the test.
  const limit = cfg.budgets.openai > 0 ? cfg.budgets.openai : 100;
  const synthetic: UsageSnapshot = {
    provider: 'openai',
    takenAt: new Date().toISOString(),
    metrics: [
      { key: 'spend_mtd_usd', value: limit * 0.76, unit: 'USD', label: 'Synthetic test' },
    ],
  };
  store.saveSnapshot(synthetic);
  // Temporarily inject budget if user hasn't configured one.
  if (cfg.budgets.openai <= 0) cfg.budgets.openai = limit;
  const fired = await alerts.evaluate(synthetic);
  console.log(`Fired ${fired.length} alert(s):`);
  for (const a of fired) console.log(`  - ${a.type}: ${a.payload}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
