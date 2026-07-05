import type { AppConfig } from '../config.js';
import type { ProviderAdapter } from '../types.js';
import { AnthropicAdapter } from './anthropic.js';
import { GoogleAdapter } from './google.js';
import { OpenAIAdapter } from './openai.js';
import { DemoAdapter } from './demo.js';

/**
 * Build the active provider list. If DEMO_MODE is on OR a real
 * provider has no API key, we substitute a DemoAdapter for that slot
 * so the dashboard is always populated.
 *
 * Order matters — it's the order tiles appear in the UI.
 */
export function buildAdapters(cfg: AppConfig): ProviderAdapter[] {
  const google = new GoogleAdapter(cfg.providerKeys.google);
  const openai = new OpenAIAdapter(cfg.providerKeys.openai);
  const anthropic = new AnthropicAdapter(cfg.providerKeys.anthropic);

  const useDemo = cfg.demoMode;

  return [
    google.isConfigured() && !useDemo
      ? google
      : new DemoAdapter('google', 'Google · Gemini', '#4285F4', 12.50, 0.42),
    openai.isConfigured() && !useDemo
      ? openai
      : new DemoAdapter('openai', 'OpenAI', '#10A37F', 28.00, 0.95),
    anthropic.isConfigured() && !useDemo
      ? anthropic
      : new DemoAdapter('anthropic', 'Anthropic', '#D97757', 41.00, 1.45),
  ];
}
