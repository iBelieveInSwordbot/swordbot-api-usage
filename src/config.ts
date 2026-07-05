import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import type { ProviderId } from './types.js';

export interface AppConfig {
  port: number;
  dataDir: string;
  pollCron: string;
  alertThresholds: number[];
  budgets: Record<ProviderId, number>;
  slackWebhookUrl?: string;
  /** When true, fall back to synthetic demo data if a provider isn't configured. */
  demoMode: boolean;
  providerKeys: {
    openai?: string;
    anthropic?: string;
    google?: string;
  };
}

function num(env: string | undefined, fallback: number): number {
  const n = Number(env);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): AppConfig {
  const dataDir = path.resolve(process.env.DATA_DIR || './data');
  fs.mkdirSync(dataDir, { recursive: true });

  return {
    port: num(process.env.PORT, 4747),
    dataDir,
    pollCron: process.env.POLL_CRON || '*/15 * * * *',
    alertThresholds: (process.env.ALERT_THRESHOLDS || '50,75,90,100')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
    budgets: {
      google: num(process.env.BUDGET_GOOGLE, 0),
      openai: num(process.env.BUDGET_OPENAI, 0),
      anthropic: num(process.env.BUDGET_ANTHROPIC, 0),
    },
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || undefined,
    demoMode: (process.env.DEMO_MODE || '').toLowerCase() === 'true',
    providerKeys: {
      openai: process.env.OPENAI_API_KEY || undefined,
      anthropic: process.env.ANTHROPIC_API_KEY || undefined,
      google: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || undefined,
    },
  };
}
