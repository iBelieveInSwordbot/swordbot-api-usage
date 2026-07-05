import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cron from 'node-cron';
import { loadConfig } from './config.js';
import { Store } from './db.js';
import { AlertEngine } from './alerts.js';
import { buildAdapters } from './providers/index.js';
import { pollAll } from './poller.js';
import type { ProviderId } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const cfg = loadConfig();
  const store = new Store(cfg.dataDir);
  const alerts = new AlertEngine(store, cfg);
  const adapters = buildAdapters(cfg);

  const app = Fastify({ logger: { level: 'info' } });

  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  // ----- API -----

  app.get('/api/status', async () => {
    const providers = adapters.map((a) => {
      const spend = store.latestMetric(a.id, 'spend_mtd_usd');
      const requests = store.latestMetric(a.id, 'requests_24h');
      const tokensIn = store.latestMetric(a.id, 'tokens_in_24h');
      const tokensOut = store.latestMetric(a.id, 'tokens_out_24h');
      const latency = store.latestMetric(a.id, 'avg_latency_ms');
      return {
        id: a.id,
        displayName: a.displayName,
        brandColor: a.brandColor,
        configured: a.isConfigured(),
        spendMtdUsd: spend?.value ?? null,
        spendUpdatedAt: spend?.takenAt ?? null,
        requests24h: requests?.value ?? null,
        tokensIn24h: tokensIn?.value ?? null,
        tokensOut24h: tokensOut?.value ?? null,
        avgLatencyMs: latency?.value ?? null,
        budgetUsd: cfg.budgets[a.id] ?? 0,
      };
    });

    const totalSpend = providers.reduce((sum, p) => sum + (p.spendMtdUsd ?? 0), 0);
    const totalBudget = providers.reduce((sum, p) => sum + (p.budgetUsd ?? 0), 0);
    const totalRequests = providers.reduce((sum, p) => sum + (p.requests24h ?? 0), 0);

    return {
      generatedAt: new Date().toISOString(),
      totalSpendUsd: round2(totalSpend),
      totalBudgetUsd: totalBudget,
      totalRequests24h: totalRequests,
      providers,
      alertThresholds: cfg.alertThresholds,
    };
  });

  app.get<{ Params: { provider: ProviderId; key: string }; Querystring: { hours?: string } }>(
    '/api/series/:provider/:key',
    async (req) => {
      const { provider, key } = req.params;
      const hours = Number(req.query.hours ?? 168);
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const points = store.metricSeries(provider, key, since);
      return { provider, key, hours, points };
    }
  );

  app.get('/api/alerts', async () => {
    return { alerts: store.recentAlerts(100) };
  });

  app.post<{ Params: { id: string } }>('/api/alerts/:id/ack', async (req) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return { ok: false };
    store.acknowledgeAlert(id);
    return { ok: true };
  });

  app.post('/api/poll-now', async () => {
    const results = await pollAll(adapters, store, alerts);
    return { results };
  });

  // ----- Schedule -----
  cron.schedule(cfg.pollCron, async () => {
    app.log.info({ cron: cfg.pollCron }, 'polling all providers');
    try {
      const results = await pollAll(adapters, store, alerts);
      app.log.info({ results }, 'poll complete');
    } catch (err) {
      app.log.error({ err }, 'poll failed');
    }
  });

  setTimeout(() => {
    pollAll(adapters, store, alerts).catch((err) =>
      app.log.error({ err }, 'initial poll failed')
    );
  }, 500);

  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  app.log.info(`🗡️  Swordbot API Usage running on http://localhost:${cfg.port}`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
