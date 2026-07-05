/* ================================================================
 * Swordbot API Usage — frontend
 * Material Design 3 dashboard with bespoke canvas dataviz.
 * No charting libs: gradient stacked-area, donut, grouped bars,
 * sparklines, all hand-rolled so the visual style stays consistent.
 * ================================================================ */

/* ----------------------------------------------------------------
 * STATIC-DEMO SHIM
 * When window.__STATIC_SNAPSHOT__ is present (GitHub Pages build),
 * we intercept /api/* fetches and serve from the baked-in snapshot
 * instead of hitting a Node/Fastify server. This lets the same
 * app.js run against either a live backend or a static host.
 * ---------------------------------------------------------------- */
(function installStaticShim() {
  const snap = typeof window !== 'undefined' ? window.__STATIC_SNAPSHOT__ : null;
  if (!snap) return;

  const jsonResp = (data) => new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  function resolveSeries(url) {
    // /api/series/<provider>/<key>?hours=<n>
    const m = url.match(/\/api\/series\/([^/]+)\/([^/?]+)(?:\?hours=(\d+))?/);
    if (!m) return null;
    const [, provider, key, hoursStr] = m;
    const hours = hoursStr ? parseInt(hoursStr, 10) : 168;
    const bucket = snap.series?.[provider]?.[key];
    if (!bucket) return { points: [] };
    // Pick nearest available hours bucket.
    const available = Object.keys(bucket).map(Number).sort((a, b) => a - b);
    let pick = available.find(h => h >= hours) ?? available[available.length - 1];
    return bucket[pick] ?? { points: [] };
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async function shimFetch(input, init) {
    const url = typeof input === 'string' ? input : input.url;
    if (!url || !url.startsWith('/api/')) return origFetch(input, init);

    // Read-only endpoints served from snapshot.
    if (url === '/api/status') return jsonResp(snap.status);
    if (url === '/api/alerts') return jsonResp(snap.alerts);
    if (url.startsWith('/api/series/')) return jsonResp(resolveSeries(url));

    // Write endpoints: no-op success. This keeps ack / poll-now buttons
    // from throwing but doesn't mutate state.
    if (url === '/api/poll-now' || /\/api\/alerts\/[^/]+\/ack$/.test(url)) {
      return jsonResp({ ok: true, static: true });
    }
    // Anything else: pass through (unlikely to succeed on Pages).
    return origFetch(input, init);
  };

  // Surface a subtle banner so it's obvious this is a static demo.
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div');
    banner.textContent = 'Static demo — synthetic data. Full app: github.com/iBelieveInSwordbot/swordbot-api-usage';
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(217,119,87,0.9);color:#fff;font:500 12px/1 Roboto,system-ui;padding:8px 16px;text-align:center;z-index:9999;letter-spacing:0.3px;';
    document.body.appendChild(banner);
  });
})();

const PROVIDER_COLORS = {
  google:    '#4285F4',
  openai:    '#10A37F',
  anthropic: '#D97757',
};
const PROVIDER_INITIAL = {
  google: 'G', openai: 'O', anthropic: 'A',
};

const fmtUsd = (n) =>
  n == null ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtUsdShort = (n) => {
  if (n == null) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(2)}`;
};
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString());
const fmtNumShort = (n) => {
  if (n == null) return '—';
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
};
const fmtPct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);
const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const fmtTimeShort = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric' }) : '—';

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

// ----- Tooltip (singleton) -----
const tooltip = document.createElement('div');
tooltip.className = 'tooltip';
document.body.appendChild(tooltip);
function showTooltip(html, x, y) {
  tooltip.innerHTML = html;
  tooltip.classList.add('show');
  // Place above-right of cursor, clamped to viewport.
  const rect = tooltip.getBoundingClientRect();
  const px = Math.min(window.innerWidth - rect.width - 12, x + 14);
  const py = Math.max(8, y - rect.height - 12);
  tooltip.style.left = `${px}px`;
  tooltip.style.top = `${py}px`;
}
function hideTooltip() { tooltip.classList.remove('show'); }

// ----- Section navigation (rail) -----
document.querySelectorAll('.rail-item[data-section]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.section;
    document.querySelectorAll('.rail-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.content').forEach((s) => s.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
    // Re-render charts so canvases pick up correct sizes after display:block.
    setTimeout(() => render(LAST_STATUS, LAST_ALERTS), 30);
  });
});

// ----- Theme toggle -----
document.getElementById('theme-toggle').addEventListener('click', () => {
  document.body.classList.toggle('theme-dark');
  document.body.classList.toggle('theme-light');
  const dark = document.body.classList.contains('theme-dark');
  document.getElementById('theme-icon').textContent = dark ? 'light_mode' : 'dark_mode';
  localStorage.setItem('swordbot-theme', dark ? 'dark' : 'light');
  setTimeout(() => render(LAST_STATUS, LAST_ALERTS), 30);
});
(() => {
  const saved = localStorage.getItem('swordbot-theme');
  if (saved === 'light') {
    document.body.classList.remove('theme-dark');
    document.body.classList.add('theme-light');
    document.getElementById('theme-icon').textContent = 'dark_mode';
  }
})();

// ----- Time-range toggle -----
let RANGE_HOURS = 168;
document.querySelectorAll('#range-toggle button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#range-toggle button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    RANGE_HOURS = Number(btn.dataset.hours);
    refreshCharts();
  });
});

// ----- Poll-now -----
document.getElementById('poll-now').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const icon = btn.querySelector('.material-symbols-rounded');
  icon.style.animation = 'spin 1s linear infinite';
  const styleId = 'spin-style';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = '@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }
  try {
    await fetch('/api/poll-now', { method: 'POST' });
    await refresh();
  } finally {
    btn.disabled = false;
    icon.style.animation = '';
  }
});

// ----- Canvas helpers -----
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

// ----- Main: stacked area chart -----
async function renderSpendChart(providers) {
  const canvas = document.getElementById('spend-chart');
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);
  const legendEl = document.getElementById('spend-legend');

  const configured = providers.filter((p) => p.configured);
  if (!configured.length) {
    drawEmpty(ctx, w, h, 'No providers configured');
    legendEl.innerHTML = '';
    return;
  }

  const series = await Promise.all(
    configured.map(async (p) => {
      const r = await fetchJSON(`/api/series/${p.id}/spend_mtd_usd?hours=${RANGE_HOURS}`);
      return { provider: p, points: r.points };
    })
  );

  const allTimes = new Set();
  for (const s of series) for (const p of s.points) allTimes.add(p.takenAt);
  const sortedTimes = [...allTimes].sort();
  if (sortedTimes.length === 0) {
    drawEmpty(ctx, w, h, 'No data yet — click Poll now to populate');
    legendEl.innerHTML = '';
    return;
  }

  // For each timestamp, get each provider's last-known spend up to that point.
  const aligned = sortedTimes.map((t) => {
    const row = { t: new Date(t).getTime() };
    for (const s of series) {
      let last = 0;
      for (const p of s.points) {
        if (p.takenAt <= t) last = p.value;
        else break;
      }
      row[s.provider.id] = last;
    }
    return row;
  });

  // Stack bottom→top in input order.
  const stackOrder = series.map((s) => s.provider.id);
  const padL = 56, padR = 24, padT = 16, padB = 36;
  const minX = aligned[0].t;
  const maxX = aligned[aligned.length - 1].t;
  const maxStack = Math.max(...aligned.map((r) => stackOrder.reduce((sum, id) => sum + (r[id] || 0), 0)), 1);
  const niceMax = niceCeil(maxStack * 1.1);

  const xToPx = (t) => padL + ((t - minX) / Math.max(maxX - minX, 1)) * (w - padL - padR);
  const yToPx = (v) => h - padB - (v / niceMax) * (h - padT - padB);

  // Grid lines + Y labels
  ctx.strokeStyle = cssVar('--md-outline-variant');
  ctx.lineWidth = 1;
  ctx.fillStyle = cssVar('--md-on-surface-variant');
  ctx.font = `400 11px ${cssVar('--font-body') || 'Roboto'}`;
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = niceMax * (1 - i / 4);
    const y = padT + ((h - padT - padB) * i) / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(fmtUsdShort(v), 8, y);
  }
  // X labels (4 ticks)
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const t = minX + ((maxX - minX) * i) / 4;
    const x = padL + ((w - padL - padR) * i) / 4;
    ctx.fillText(formatXLabel(t, RANGE_HOURS), x, h - 16);
  }
  ctx.textAlign = 'left';

  // Stacked areas with gradient fills (bottom to top).
  let prevTop = aligned.map(() => 0);
  for (const id of stackOrder) {
    const color = PROVIDER_COLORS[id] || cssVar('--md-primary');
    // Build path: rising along values, falling along previous top (reversed).
    ctx.beginPath();
    aligned.forEach((row, i) => {
      const val = row[id] || 0;
      const top = prevTop[i] + val;
      const x = xToPx(row.t), y = yToPx(top);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    for (let i = aligned.length - 1; i >= 0; i--) {
      const x = xToPx(aligned[i].t), y = yToPx(prevTop[i]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
    grad.addColorStop(0, hexAlpha(color, 0.55));
    grad.addColorStop(1, hexAlpha(color, 0.05));
    ctx.fillStyle = grad;
    ctx.fill();

    // Top stroke
    ctx.beginPath();
    aligned.forEach((row, i) => {
      const top = prevTop[i] + (row[id] || 0);
      const x = xToPx(row.t), y = yToPx(top);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    prevTop = prevTop.map((v, i) => v + (aligned[i][id] || 0));
  }

  // Legend
  legendEl.innerHTML = stackOrder
    .map((id) => {
      const p = series.find((s) => s.provider.id === id).provider;
      return `<span><span class="swatch" style="background:${PROVIDER_COLORS[id]}"></span>${p.displayName}</span>`;
    })
    .join('');

  // Hover tracking
  attachHover(canvas, (mx, my, rect) => {
    if (mx < padL || mx > w - padR) return hideTooltip();
    // Find nearest aligned column.
    let bestIdx = 0, bestDx = Infinity;
    for (let i = 0; i < aligned.length; i++) {
      const dx = Math.abs(xToPx(aligned[i].t) - mx);
      if (dx < bestDx) { bestDx = dx; bestIdx = i; }
    }
    const row = aligned[bestIdx];
    const x = xToPx(row.t);

    // Re-draw tooltip line on top.
    refreshCharts._lastVerticalLine = () => {
      ctx.strokeStyle = cssVar('--md-outline');
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT); ctx.lineTo(x, h - padB);
      ctx.stroke();
      ctx.setLineDash([]);
      // Draw dots at each stacked point.
      let cum = 0;
      for (const id of stackOrder) {
        const v = row[id] || 0;
        cum += v;
        const dotY = yToPx(cum);
        ctx.fillStyle = cssVar('--md-surface');
        ctx.beginPath(); ctx.arc(x, dotY, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = PROVIDER_COLORS[id];
        ctx.beginPath(); ctx.arc(x, dotY, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    };
    // Re-render base then overlay.
    redrawSpendChart();
    refreshCharts._lastVerticalLine();

    const total = stackOrder.reduce((s, id) => s + (row[id] || 0), 0);
    const lines = stackOrder.map((id) => {
      const p = series.find((s) => s.provider.id === id).provider;
      return `<div class="tt-row"><span><span class="swatch" style="background:${PROVIDER_COLORS[id]}"></span>${p.displayName}</span><span>${fmtUsd(row[id] || 0)}</span></div>`;
    }).join('');
    showTooltip(
      `<div class="tt-time">${fmtTime(new Date(row.t).toISOString())}</div>${lines}<div class="tt-row" style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.15);padding-top:6px"><span><strong>Total</strong></span><span><strong>${fmtUsd(total)}</strong></span></div>`,
      mx + rect.left,
      my + rect.top
    );
  }, () => {
    hideTooltip();
    redrawSpendChart();
  });

  function redrawSpendChart() {
    setupCanvas(canvas);
    // re-render the entire chart without hover overlay
    ctx.strokeStyle = cssVar('--md-outline-variant'); ctx.lineWidth = 1;
    ctx.fillStyle = cssVar('--md-on-surface-variant');
    ctx.font = `400 11px ${cssVar('--font-body') || 'Roboto'}`;
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = niceMax * (1 - i / 4);
      const y = padT + ((h - padT - padB) * i) / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillText(fmtUsdShort(v), 8, y);
    }
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const t = minX + ((maxX - minX) * i) / 4;
      const x = padL + ((w - padL - padR) * i) / 4;
      ctx.fillText(formatXLabel(t, RANGE_HOURS), x, h - 16);
    }
    ctx.textAlign = 'left';

    let p2 = aligned.map(() => 0);
    for (const id of stackOrder) {
      const color = PROVIDER_COLORS[id];
      ctx.beginPath();
      aligned.forEach((row, i) => {
        const top = p2[i] + (row[id] || 0);
        const x = xToPx(row.t), y = yToPx(top);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      for (let i = aligned.length - 1; i >= 0; i--) {
        const x = xToPx(aligned[i].t), y = yToPx(p2[i]);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
      grad.addColorStop(0, hexAlpha(color, 0.55));
      grad.addColorStop(1, hexAlpha(color, 0.05));
      ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath();
      aligned.forEach((row, i) => {
        const top = p2[i] + (row[id] || 0);
        const x = xToPx(row.t), y = yToPx(top);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.stroke();
      p2 = p2.map((v, i) => v + (aligned[i][id] || 0));
    }
  }
}

// ----- Donut: provider mix -----
function renderDonut(providers) {
  const canvas = document.getElementById('donut-chart');
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);
  const legendEl = document.getElementById('donut-legend');

  const items = providers
    .filter((p) => p.spendMtdUsd && p.spendMtdUsd > 0)
    .map((p) => ({ id: p.id, name: p.displayName, value: p.spendMtdUsd }));
  const total = items.reduce((s, x) => s + x.value, 0);
  document.getElementById('donut-total').textContent = fmtUsd(total);

  if (items.length === 0) {
    ctx.fillStyle = cssVar('--md-on-surface-variant');
    ctx.font = `400 13px ${cssVar('--font-body') || 'Roboto'}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No spend data yet', w / 2, h / 2);
    legendEl.innerHTML = '';
    return;
  }

  const cx = w / 2, cy = h / 2;
  const rOuter = Math.min(w, h) / 2 - 8;
  const rInner = rOuter * 0.66;

  let start = -Math.PI / 2;
  const arcs = [];
  for (const it of items) {
    const sweep = (it.value / total) * Math.PI * 2;
    const end = start + sweep;
    arcs.push({ ...it, start, end });
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, start, end);
    ctx.arc(cx, cy, rInner, end, start, true);
    ctx.closePath();
    ctx.fillStyle = PROVIDER_COLORS[it.id] || cssVar('--md-primary');
    ctx.fill();
    // Slim white separator
    ctx.strokeStyle = cssVar('--md-surface-container');
    ctx.lineWidth = 2;
    ctx.stroke();
    start = end;
  }

  legendEl.innerHTML = items
    .map((it) => `<span><span class="swatch" style="background:${PROVIDER_COLORS[it.id]}"></span>${it.name} · ${fmtUsd(it.value)} (${((it.value / total) * 100).toFixed(1)}%)</span>`)
    .join('');

  // Hover for donut
  attachHover(canvas, (mx, my, rect) => {
    const dx = mx - cx, dy = my - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < rInner || dist > rOuter) return hideTooltip();
    let ang = Math.atan2(dy, dx);
    if (ang < -Math.PI / 2) ang += Math.PI * 2;
    const hit = arcs.find((a) => ang >= a.start && ang < a.end);
    if (!hit) return hideTooltip();
    showTooltip(
      `<div class="tt-row"><span><span class="swatch" style="background:${PROVIDER_COLORS[hit.id]}"></span>${hit.name}</span><span>${fmtUsd(hit.value)} (${((hit.value/total)*100).toFixed(1)}%)</span></div>`,
      mx + rect.left,
      my + rect.top
    );
  }, hideTooltip);
}

// ----- Grouped bars: requests per day -----
async function renderBars(providers) {
  const canvas = document.getElementById('bars-chart');
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);
  const legendEl = document.getElementById('bars-legend');

  const configured = providers.filter((p) => p.configured);
  // Pull last 7 days of requests_24h, take last sample per day.
  const series = await Promise.all(
    configured.map(async (p) => {
      const r = await fetchJSON(`/api/series/${p.id}/requests_24h?hours=168`);
      return { provider: p, points: r.points };
    })
  );

  // Bucket by day.
  const buckets = {};
  for (const s of series) {
    for (const pt of s.points) {
      const day = pt.takenAt.slice(0, 10);
      if (!buckets[day]) buckets[day] = {};
      buckets[day][s.provider.id] = pt.value; // last write wins → most recent that day
    }
  }
  const days = Object.keys(buckets).sort().slice(-7);
  if (!days.length) {
    drawEmpty(ctx, w, h, 'No request data yet');
    legendEl.innerHTML = '';
    return;
  }

  const padL = 48, padR = 16, padT = 12, padB = 36;
  const groupW = (w - padL - padR) / days.length;
  const ids = configured.map((p) => p.id);
  const barW = Math.max(8, (groupW - 16) / ids.length - 2);
  const maxVal = Math.max(1, ...days.flatMap((d) => ids.map((id) => buckets[d][id] || 0)));
  const niceMax = niceCeil(maxVal * 1.1);

  // Grid + Y labels
  ctx.strokeStyle = cssVar('--md-outline-variant');
  ctx.fillStyle = cssVar('--md-on-surface-variant');
  ctx.font = `400 11px ${cssVar('--font-body') || 'Roboto'}`;
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = niceMax * (1 - i / 4);
    const y = padT + ((h - padT - padB) * i) / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(fmtNumShort(v), 6, y);
  }

  ctx.textAlign = 'center';
  days.forEach((d, di) => {
    const groupX = padL + di * groupW + 8;
    ids.forEach((id, ii) => {
      const v = buckets[d][id] || 0;
      const barH = (v / niceMax) * (h - padT - padB);
      const x = groupX + ii * (barW + 4);
      const y = h - padB - barH;
      // rounded rect
      const r = Math.min(6, barW / 2);
      ctx.fillStyle = PROVIDER_COLORS[id];
      roundedRect(ctx, x, y, barW, barH, r, r, 0, 0);
      ctx.fill();
    });
    ctx.fillStyle = cssVar('--md-on-surface-variant');
    ctx.fillText(new Date(d).toLocaleDateString(undefined, { weekday: 'short' }), groupX + (groupW - 16) / 2, h - 16);
  });
  ctx.textAlign = 'left';

  legendEl.innerHTML = ids
    .map((id) => {
      const p = configured.find((c) => c.id === id);
      return `<span><span class="swatch" style="background:${PROVIDER_COLORS[id]}"></span>${p.displayName}</span>`;
    }).join('');
}

// ----- Token throughput (horizontal stacked bars) -----
function renderTokens(providers) {
  const canvas = document.getElementById('tokens-chart');
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);
  const legendEl = document.getElementById('tokens-legend');

  const items = providers
    .filter((p) => p.tokensIn24h != null || p.tokensOut24h != null)
    .map((p) => ({
      id: p.id, name: p.displayName,
      input: p.tokensIn24h || 0, output: p.tokensOut24h || 0,
    }));
  if (!items.length) { drawEmpty(ctx, w, h, 'No token data'); legendEl.innerHTML = ''; return; }

  const max = Math.max(1, ...items.map((it) => it.input + it.output));
  const padL = 120, padR = 24, padT = 16, padB = 24;
  const rowH = (h - padT - padB) / items.length;

  ctx.font = `400 12px ${cssVar('--font-body') || 'Roboto'}`;
  ctx.textBaseline = 'middle';

  items.forEach((it, i) => {
    const y = padT + i * rowH + rowH / 2;
    ctx.fillStyle = cssVar('--md-on-surface');
    ctx.textAlign = 'right';
    ctx.fillText(it.name, padL - 12, y);

    const totalW = w - padL - padR;
    const inW = (it.input / max) * totalW;
    const outW = (it.output / max) * totalW;
    const barH = rowH * 0.55;
    const top = y - barH / 2;

    // input bar
    ctx.fillStyle = PROVIDER_COLORS[it.id];
    roundedRect(ctx, padL, top, inW, barH, 4, 0, 0, 4);
    ctx.fill();
    // output bar
    ctx.fillStyle = hexAlpha(PROVIDER_COLORS[it.id], 0.55);
    roundedRect(ctx, padL + inW, top, outW, barH, 0, 4, 4, 0);
    ctx.fill();

    // Value label
    ctx.fillStyle = cssVar('--md-on-surface-variant');
    ctx.textAlign = 'left';
    ctx.fillText(`${fmtNumShort(it.input)} in · ${fmtNumShort(it.output)} out`, padL + inW + outW + 8, y);
  });

  legendEl.innerHTML = `
    <span><span class="swatch" style="background:#888"></span>Input tokens (solid)</span>
    <span><span class="swatch" style="background:#88888888"></span>Output tokens (translucent)</span>
  `;
}

// ----- Latency bars -----
function renderLatency(providers) {
  const canvas = document.getElementById('latency-chart');
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);

  const items = providers.filter((p) => p.avgLatencyMs != null);
  if (!items.length) { drawEmpty(ctx, w, h, 'No latency data'); return; }

  const max = Math.max(1, ...items.map((p) => p.avgLatencyMs));
  const niceMax = niceCeil(max * 1.2);
  const padL = 120, padR = 80, padT = 16, padB = 24;
  const rowH = (h - padT - padB) / items.length;

  ctx.font = `400 12px ${cssVar('--font-body') || 'Roboto'}`;
  ctx.textBaseline = 'middle';

  items.forEach((it, i) => {
    const y = padT + i * rowH + rowH / 2;
    ctx.fillStyle = cssVar('--md-on-surface');
    ctx.textAlign = 'right';
    ctx.fillText(it.displayName, padL - 12, y);

    const totalW = w - padL - padR;
    const barW = (it.avgLatencyMs / niceMax) * totalW;
    const barH = rowH * 0.45;
    ctx.fillStyle = PROVIDER_COLORS[it.id];
    roundedRect(ctx, padL, y - barH / 2, barW, barH, 4, 4, 4, 4);
    ctx.fill();

    ctx.fillStyle = cssVar('--md-on-surface-variant');
    ctx.textAlign = 'left';
    ctx.fillText(`${it.avgLatencyMs.toFixed(0)} ms`, padL + barW + 8, y);
  });
}

// ----- Sparklines -----
async function renderSparklines() {
  const reqCanvas = document.getElementById('kpi-spark-requests');
  const spendCanvas = document.getElementById('kpi-spark-spend');
  if (reqCanvas) {
    const series = await fetchAggregateSeries('requests_24h', RANGE_HOURS);
    drawSparkline(reqCanvas, series, cssVar('--md-on-primary-container') || '#fff');
  }
  if (spendCanvas) {
    const series = await fetchAggregateSeries('spend_mtd_usd', RANGE_HOURS);
    drawSparkline(spendCanvas, series, cssVar('--md-primary'));
  }
}

async function fetchAggregateSeries(key, hours) {
  const ids = Object.keys(PROVIDER_COLORS);
  const all = await Promise.all(
    ids.map(async (id) => {
      try { return (await fetchJSON(`/api/series/${id}/${key}?hours=${hours}`)).points; }
      catch { return []; }
    })
  );
  const times = new Set();
  all.forEach((arr) => arr.forEach((p) => times.add(p.takenAt)));
  const sorted = [...times].sort();
  return sorted.map((t) => {
    let sum = 0;
    for (const arr of all) {
      let last = 0;
      for (const p of arr) {
        if (p.takenAt <= t) last = p.value;
        else break;
      }
      sum += last;
    }
    return { t: new Date(t).getTime(), v: sum };
  });
}

function drawSparkline(canvas, points, color) {
  const { ctx, w, h } = setupCanvas(canvas);
  if (!points.length) return;
  const xs = points.map((p) => p.t), vs = points.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minV = Math.min(...vs), maxV = Math.max(...vs);
  const span = Math.max(maxV - minV, 0.0001);
  const xToPx = (t) => ((t - minX) / Math.max(maxX - minX, 1)) * w;
  const yToPx = (v) => h - 6 - ((v - minV) / span) * (h - 12);

  // Fill
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xToPx(p.t), y = yToPx(p.v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexAlpha(color, 0.45));
  grad.addColorStop(1, hexAlpha(color, 0.0));
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xToPx(p.t), y = yToPx(p.v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ----- Provider cards (Providers tab) -----
function renderProviderCards(providers) {
  const root = document.getElementById('provider-cards');
  if (!providers.length) { root.innerHTML = '<div class="empty"><span class="material-symbols-rounded">cloud_off</span><p>No providers configured</p></div>'; return; }
  root.innerHTML = providers.map((p) => {
    const color = PROVIDER_COLORS[p.id] || '#888';
    let pct = null;
    if (p.budgetUsd > 0 && p.spendMtdUsd != null) pct = Math.min(100, (p.spendMtdUsd / p.budgetUsd) * 100);
    const status = providerStatus(p);
    const barColor = pct == null ? color : pct >= 100 ? cssVar('--md-error') : pct >= 75 ? cssVar('--md-warning') : cssVar('--md-success');

    const rows = [];
    if (p.spendMtdUsd != null) rows.push(['Spend MTD', fmtUsd(p.spendMtdUsd)]);
    if (p.requests24h != null) rows.push(['Requests (24h)', fmtNum(p.requests24h)]);
    if (p.tokensIn24h != null) rows.push(['Tokens in (24h)', fmtNumShort(p.tokensIn24h)]);
    if (p.tokensOut24h != null) rows.push(['Tokens out (24h)', fmtNumShort(p.tokensOut24h)]);
    if (p.avgLatencyMs != null) rows.push(['Avg latency', `${p.avgLatencyMs.toFixed(0)} ms`]);
    if (p.spendUpdatedAt) rows.push(['Updated', fmtTime(p.spendUpdatedAt)]);

    const budget = p.budgetUsd > 0 ? `
      <div class="budget-bar"><div class="budget-bar-fill" style="width:${pct?.toFixed(1) ?? 0}%;background:${barColor}"></div></div>
      <div class="budget-text"><span>${fmtUsd(p.spendMtdUsd ?? 0)}</span><span>of ${fmtUsd(p.budgetUsd)}${pct != null ? ` (${pct.toFixed(1)}%)` : ''}</span></div>
    ` : '';

    return `
      <div class="card provider-card">
        <div class="ph">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="pavatar" style="background:${color}">${PROVIDER_INITIAL[p.id] || '?'}</div>
            <div>
              <h3>${p.displayName}</h3>
              <div class="pmeta">${p.configured ? 'Configured' : 'Not configured'}</div>
            </div>
          </div>
          <span class="status-chip ${status.cls}"><span class="dot"></span>${status.label}</span>
        </div>
        ${rows.map((r) => `<div class="metric-row"><span class="k">${r[0]}</span><span class="v">${r[1]}</span></div>`).join('')}
        ${budget}
      </div>`;
  }).join('');
}
function providerStatus(p) {
  if (!p.configured) return { cls: 'off', label: 'Not configured' };
  if (p.budgetUsd > 0 && p.spendMtdUsd != null) {
    const pct = (p.spendMtdUsd / p.budgetUsd) * 100;
    if (pct >= 100) return { cls: 'bad', label: 'Over budget' };
    if (pct >= 75) return { cls: 'warn', label: 'Approaching' };
  }
  return { cls: 'good', label: 'Healthy' };
}

// ----- KPI cards -----
function renderKPIs(status, alerts) {
  document.getElementById('kpi-spend').textContent = fmtUsd(status.totalSpendUsd);
  if (status.totalBudgetUsd > 0) {
    const pct = Math.min(100, (status.totalSpendUsd / status.totalBudgetUsd) * 100);
    document.getElementById('kpi-spend-sub').textContent =
      `${pct.toFixed(1)}% of ${fmtUsd(status.totalBudgetUsd)} monthly budget`;
    document.getElementById('kpi-spend-bar').style.width = `${pct}%`;
  } else {
    document.getElementById('kpi-spend-sub').textContent = 'No budget set — configure in .env';
    document.getElementById('kpi-spend-bar').style.width = '0%';
  }

  document.getElementById('kpi-requests').textContent = fmtNumShort(status.totalRequests24h);
  // Burn rate: from sparkline series if available — derived later in renderSparklines via state.
  if (status.totalSpendUsd > 0) {
    const day = new Date().getDate();
    const burn = status.totalSpendUsd / Math.max(day, 1) * 30;
    document.getElementById('kpi-burn').textContent = `${fmtUsd(status.totalSpendUsd / Math.max(day, 1))}/day`;
    document.getElementById('kpi-burn-sub').textContent = `~${fmtUsd(burn)} projected for the month`;
  } else {
    document.getElementById('kpi-burn').textContent = '—';
    document.getElementById('kpi-burn-sub').textContent = 'no spend yet';
  }

  const active = alerts.filter((a) => !a.acknowledgedAt);
  document.getElementById('kpi-alerts').textContent = String(active.length);
  document.getElementById('kpi-alerts-sub').textContent = active.length === 0 ? 'all clear' : `${active.length} need attention`;
  const badge = document.getElementById('rail-alert-badge');
  if (active.length > 0) {
    badge.hidden = false; badge.textContent = String(active.length);
  } else { badge.hidden = true; }

  // Alert pills
  const counts = {};
  for (const a of active) counts[a.type] = (counts[a.type] || 0) + 1;
  const pills = Object.entries(counts).map(([t, n]) => {
    const cls = t === 'spend_anomaly' || t === 'fetch_error' ? 'bad' : 'warn';
    return `<span class="alert-pill ${cls}">${prettyAlertType(t)}: ${n}</span>`;
  }).join('');
  document.getElementById('alert-pills').innerHTML = pills;

  document.getElementById('last-updated').textContent = `Updated ${fmtTime(status.generatedAt)}`;
}
function prettyAlertType(t) {
  return ({ budget_threshold: 'Budget', spend_anomaly: 'Anomaly', fetch_error: 'Fetch error' })[t] || t;
}

// ----- Alerts list -----
function renderAlertsList(alerts) {
  const root = document.getElementById('alerts-list');
  if (!alerts.length) {
    root.innerHTML = '<div class="empty"><span class="material-symbols-rounded">check_circle</span><p>No alerts. The boring kind of empty — good.</p></div>';
    return;
  }
  root.innerHTML = alerts.map((a) => {
    const p = (() => { try { return JSON.parse(a.payload || '{}'); } catch { return {}; } })();
    const icon = ({ budget_threshold: 'savings', spend_anomaly: 'priority_high', fetch_error: 'error' })[a.type] || 'notifications';
    const iconCls = a.type === 'spend_anomaly' || a.type === 'fetch_error' ? 'bad' : '';
    const title = ({
      budget_threshold: `${a.provider} hit ${p.threshold}% of monthly budget`,
      spend_anomaly: `${a.provider} spend anomaly`,
      fetch_error: `${a.provider} fetch failed`,
    })[a.type] || a.type;
    const detail = ({
      budget_threshold: `${fmtUsd(p.spendUsd)} of ${fmtUsd(p.limitUsd)} (${p.pct}%)`,
      spend_anomaly: `Last hour ${fmtUsd(p.lastHourGrowthUsd)} vs baseline ${fmtUsd(p.baselineHourlyGrowthUsd)}/h (${p.ratio}×)`,
      fetch_error: p.message || 'unknown error',
    })[a.type] || JSON.stringify(p);

    return `
      <div class="alert-item ${a.type} ${a.acknowledgedAt ? 'acknowledged' : ''}">
        <div class="alert-icon ${iconCls}"><span class="material-symbols-rounded">${icon}</span></div>
        <div class="alert-body">
          <div class="at">${title}</div>
          <div class="am">${detail}</div>
          <div class="am">${fmtTime(a.firedAt)}${a.acknowledgedAt ? ` · ack ${fmtTime(a.acknowledgedAt)}` : ''}</div>
        </div>
        <div class="alert-actions">
          ${a.acknowledgedAt ? '' : `<button class="btn btn-text" data-ack="${a.id}">Ack</button>`}
        </div>
      </div>`;
  }).join('');

  root.querySelectorAll('[data-ack]').forEach((b) => {
    b.addEventListener('click', async () => {
      await fetch(`/api/alerts/${b.dataset.ack}/ack`, { method: 'POST' });
      refresh();
    });
  });
}

// ----- helpers -----
function attachHover(canvas, onMove, onLeave) {
  canvas.onmousemove = (e) => {
    const r = canvas.getBoundingClientRect();
    onMove(e.clientX - r.left, e.clientY - r.top, r);
  };
  canvas.onmouseleave = onLeave;
}
function drawEmpty(ctx, w, h, msg) {
  ctx.fillStyle = cssVar('--md-on-surface-variant');
  ctx.font = `400 13px ${cssVar('--font-body') || 'Roboto'}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(msg, w / 2, h / 2);
}
function niceCeil(v) {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const m = v / base;
  let nice;
  if (m <= 1) nice = 1;
  else if (m <= 2) nice = 2;
  else if (m <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}
function hexAlpha(hex, a) {
  // Accepts #rrggbb only
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function roundedRect(ctx, x, y, w, h, rTL, rTR, rBR, rBL) {
  rTL = Math.min(rTL, w / 2, h / 2);
  rTR = Math.min(rTR, w / 2, h / 2);
  rBR = Math.min(rBR, w / 2, h / 2);
  rBL = Math.min(rBL, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rTL, y);
  ctx.lineTo(x + w - rTR, y);
  ctx.arcTo(x + w, y, x + w, y + rTR, rTR);
  ctx.lineTo(x + w, y + h - rBR);
  ctx.arcTo(x + w, y + h, x + w - rBR, y + h, rBR);
  ctx.lineTo(x + rBL, y + h);
  ctx.arcTo(x, y + h, x, y + h - rBL, rBL);
  ctx.lineTo(x, y + rTL);
  ctx.arcTo(x, y, x + rTL, y, rTL);
  ctx.closePath();
}
function formatXLabel(t, hours) {
  const d = new Date(t);
  if (hours <= 24) return d.toLocaleTimeString(undefined, { hour: 'numeric' });
  if (hours <= 72) return d.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ----- Orchestration -----
let LAST_STATUS = null;
let LAST_ALERTS = [];

async function render(status, alerts) {
  if (!status) return;
  renderKPIs(status, alerts);
  renderProviderCards(status.providers);
  renderAlertsList(alerts);
  await renderSpendChart(status.providers);
  renderDonut(status.providers);
  await renderBars(status.providers);
  renderTokens(status.providers);
  renderLatency(status.providers);
  await renderSparklines();
}

async function refreshCharts() {
  if (!LAST_STATUS) return;
  await renderSpendChart(LAST_STATUS.providers);
  await renderBars(LAST_STATUS.providers);
  await renderSparklines();
}

async function refresh() {
  try {
    const [status, alertsResp] = await Promise.all([
      fetchJSON('/api/status'),
      fetchJSON('/api/alerts'),
    ]);
    LAST_STATUS = status;
    LAST_ALERTS = alertsResp.alerts;
    await render(status, alertsResp.alerts);
  } catch (err) {
    console.error(err);
    document.getElementById('last-updated').textContent = `Error: ${err.message}`;
  }
}

window.addEventListener('resize', () => {
  clearTimeout(window.__resizeTimer);
  window.__resizeTimer = setTimeout(() => render(LAST_STATUS, LAST_ALERTS), 150);
});

refresh();
setInterval(refresh, 30_000);
