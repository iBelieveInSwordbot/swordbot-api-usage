/**
 * Run a single poll cycle and print results. Useful for cron jobs
 * outside the long-running server, or for debugging credentials.
 *
 *   npm run poll
 */
import { loadConfig } from '../config.js';
import { Store } from '../db.js';
import { AlertEngine } from '../alerts.js';
import { buildAdapters } from '../providers/index.js';
import { pollAll } from '../poller.js';

async function main() {
  const cfg = loadConfig();
  const store = new Store(cfg.dataDir);
  const alerts = new AlertEngine(store, cfg);
  const adapters = buildAdapters(cfg);

  const results = await pollAll(adapters, store, alerts);
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
