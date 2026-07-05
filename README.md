# Swordbot API Usage 🗡️

A Material Design 3 dashboard + proactive alerting engine for AI API
spend across **Google Gemini, OpenAI, and Anthropic**.

Built by **Wozbot 🤖** for **Swordbot**.

## What you get

### Visual
- 🎨 **Material Design 3** — MD3 design tokens, shape scales, state
  layers, light/dark themes (toggle in the rail).
- 🧭 **Navigation rail** with active states + alert badge counter.
- 📊 **Bespoke canvas dataviz** (no chart libs — keeps the visual
  language consistent):
  - Stacked-area spend chart with gradient fills + crosshair tooltip
  - Donut "provider mix" with hover slice info
  - Grouped bar chart for daily request volume
  - Horizontal bars for token throughput (input vs output)
  - Sparklines on KPI cards
- ⚡ **Smooth transitions, hover tooltips, segmented time-range
  toggle (24h / 3d / 7d / 30d).**

### Functional
- 🔌 **3 provider adapters**: Google (Gemini), OpenAI, Anthropic.
  Adapter pattern means dropping in a fourth is one file.
- 🚨 **Alert engine** (the real killer feature):
  - Budget thresholds at 50/75/90/100% of monthly limit
  - Spend anomaly: last hour ≥ 3× the prior 24h baseline
  - Fetch errors (rate-limited so they don't spam Slack)
  - State-deduped per `(provider, period, threshold)` so 75% won't
    re-fire 12 times the same month
- 🔔 **Slack webhook notifier** for all alert types.
- 💾 **SQLite** + long-format metrics table → zero-migration extensibility.
- ⏱️ **node-cron poller** (default every 15 min, configurable).
- 🎭 **Demo mode** seeds 7 days of believable synthetic data so the
  dashboard looks alive before you've added real keys.

## Quick start

```bash
cd projects/swordbot-api-usage
cp .env.example .env       # add real keys + budgets
npm install
npm run seed               # optional — populates 7d of demo data
npm run dev                # http://localhost:4747
```

To force demo mode even with real keys (handy for screenshots):

```bash
DEMO_MODE=true npm run dev
```

## Provider notes (the honest part)

- **Google · Gemini**: standard `GOOGLE_API_KEY` lets us validate the
  key + count models. Real org spend lives in Google Cloud Billing,
  which needs OAuth, not an API key. Until that's wired, the spend
  metric reads 0 (with a clear label explaining why).
- **OpenAI**: the dashboard billing endpoint expects a session-class
  key on most accounts. If your normal API key 401s the dashboard
  surfaces that instead of inventing numbers.
- **Anthropic**: standard keys can list models but not org spend —
  Admin keys (org-level) unlock the cost report endpoints.

In the meantime, **demo mode gives you the full visual experience**
with realistic numbers. Real adapters wire in incrementally as you
get the right credentials.

## Architecture

```
                ┌──────────────┐
                │  cron / boot │
                └──────┬───────┘
                       ▼
   ┌────────────────────────────────────────┐
   │ pollAll(adapters, store, alerts)       │
   │  ├─ google (Gemini)                    │
   │  ├─ openai                             │
   │  └─ anthropic                          │
   └────────────────────────────────────────┘
                  │
        ┌─────────┴───────────┐
        ▼                     ▼
   ┌──────────┐         ┌──────────────┐
   │ SQLite   │         │ AlertEngine  │
   │ metrics  │         │ ├ budgets    │
   │ snapshots│         │ ├ anomalies  │
   │ alerts   │         │ └ fetch err  │
   └─────┬────┘         └──────┬───────┘
         │                     │
         ▼                     ▼
    Fastify API           Slack webhook
       (/api/*)
         │
         ▼
   MD3 Dashboard (vanilla, no build)
```

## File layout

```
swordbot-api-usage/
├── src/
│   ├── server.ts         # Fastify + cron loop
│   ├── poller.ts         # poll all adapters
│   ├── alerts.ts         # alert engine + Slack
│   ├── db.ts             # SQLite store
│   ├── config.ts         # env loader
│   ├── types.ts
│   ├── providers/
│   │   ├── google.ts
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   ├── demo.ts       # synthetic data adapter
│   │   └── index.ts
│   └── cli/
│       ├── poll-once.ts
│       ├── seed-demo.ts  # 7 days of demo data
│       └── test-alerts.ts
├── public/
│   ├── index.html        # MD3 layout
│   ├── styles.css        # MD3 tokens, light + dark themes
│   └── app.js            # Custom canvas dataviz
├── data/                 # SQLite (auto-created)
├── .env.example
├── package.json
└── tsconfig.json
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/status` | Latest aggregate + per-provider snapshot |
| GET    | `/api/series/:provider/:metric?hours=N` | Time-series data |
| GET    | `/api/alerts` | Last 100 alert events |
| POST   | `/api/alerts/:id/ack` | Acknowledge an alert |
| POST   | `/api/poll-now` | Force an immediate poll |

## Roadmap

- [ ] Google Cloud Billing OAuth flow → real Gemini spend
- [ ] Anthropic Admin API → real org-level spend + cost report breakdowns
- [ ] OpenAI session-key onboarding wizard
- [ ] Discord / iMessage / push notification channels
- [ ] Forecast widget (linear projection of MTD)
- [ ] Cost-per-feature attribution via OpenClaw integration
- [ ] Per-API-key attribution
- [ ] CSV export of any chart's data

🤓
