// ── Configuration ──────────────────────────────────────────
const API_KEY = 'ci4eon1r01qsre0dm800ci4eon1r01qsre0dm80g';
const REFRESH_MS = 60_000;
const TILE_GAP = 1.5; // px per side (3px total gap between tiles)

// ── Sector definitions ────────────────────────────────────
const SECTORS = [
  { ticker: 'XLK', sector: 'Technology',      shortName: 'Tech' },
  { ticker: 'XLY', sector: 'Cons. Discret.',  shortName: 'Discret.' },
  { ticker: 'XLF', sector: 'Financials',      shortName: 'Financ.' },
  { ticker: 'XLC', sector: 'Communication',   shortName: 'Comm.' },
  { ticker: 'XLV', sector: 'Health Care',     shortName: 'Health' },
  { ticker: 'XLI', sector: 'Industrials',     shortName: 'Indust.' },
  { ticker: 'XLP', sector: 'Cons. Staples',   shortName: 'Staples' },
  { ticker: 'XLE', sector: 'Energy',          shortName: 'Energy' },
  { ticker: 'XLU', sector: 'Utilities',       shortName: 'Utilities' },
  { ticker: 'XLB', sector: 'Materials',       shortName: 'Materials' },
  { ticker: 'XLRE', sector: 'Real Estate',    shortName: 'Real Est.' },
];

const DEFAULT_WEIGHTS = {
  XLK: 30.39, XLY: 14.81, XLF: 12.07, XLC: 10.63, XLV: 8.68,
  XLI: 8.26,  XLP: 5.55,  XLE: 3.55,  XLU: 2.32,  XLB: 1.90, XLRE: 1.79,
};

// Mapping from us500.com sector names to our tickers
const SECTOR_NAME_MAP = {
  'Information Technology': 'XLK',
  'Consumer Discretionary': 'XLY',
  'Financials': 'XLF',
  'Communication Services': 'XLC',
  'Health Care': 'XLV',
  'Industrials': 'XLI',
  'Consumer Staples': 'XLP',
  'Energy': 'XLE',
  'Utilities': 'XLU',
  'Materials': 'XLB',
  'Real Estate': 'XLRE',
};

// ── Color stops (percent → RGB) ───────────────────────────
const COLOR_STOPS = [
  { pct: -3, r: 100, g: 10, b: 10 },
  { pct: -2, r: 160, g: 25, b: 25 },
  { pct: -1, r: 190, g: 55, b: 55 },
  { pct:  0, r:  65, g: 65, b: 65 },
  { pct:  1, r:  55, g: 130, b: 55 },
  { pct:  2, r:  25, g: 160, b: 25 },
  { pct:  3, r:  10, g: 120, b: 10 },
];

// ── State ──────────────────────────────────────────────────
let sectorData = []; // [{ ticker, sector, shortName, weight }]
let layoutRects = []; // output of squarify()
let quoteData = {};   // { TICKER: { dp: number } }
let refreshTimer = null;

// ── Color interpolation ───────────────────────────────────
function pctToColor(pct) {
  if (pct == null || isNaN(pct)) return 'rgb(65,65,65)';
  const clamped = Math.max(-3, Math.min(3, pct));
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (clamped >= a.pct && clamped <= b.pct) {
      const t = (clamped - a.pct) / (b.pct - a.pct);
      const r = Math.round(a.r + t * (b.r - a.r));
      const g = Math.round(a.g + t * (b.g - a.g));
      const bl = Math.round(a.b + t * (b.b - a.b));
      return `rgb(${r},${g},${bl})`;
    }
  }
  if (clamped <= COLOR_STOPS[0].pct) {
    const s = COLOR_STOPS[0];
    return `rgb(${s.r},${s.g},${s.b})`;
  }
  const s = COLOR_STOPS[COLOR_STOPS.length - 1];
  return `rgb(${s.r},${s.g},${s.b})`;
}

function formatPct(dp) {
  if (dp == null || isNaN(dp)) return '—';
  const sign = dp > 0 ? '+' : '';
  return `${sign}${dp.toFixed(2)}%`;
}

// ── Fetch sector weights ──────────────────────────────────
// Tries sectors.json first (works on GitHub Pages and locally),
// then falls back to /api/sectors (local Node server proxy),
// then falls back to hardcoded defaults.
async function fetchSectorWeights() {
  for (const url of ['./sectors.json', '/api/sectors']) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.sectors && Array.isArray(data.sectors)) {
        const weights = {};
        for (const s of data.sectors) {
          const ticker = SECTOR_NAME_MAP[s.name];
          if (ticker) weights[ticker] = s.weight;
        }
        if (Object.keys(weights).length >= 8) return weights;
      }
    } catch (err) {
      // try next source
    }
  }
  console.warn('Using hardcoded sector weights as fallback');
  return { ...DEFAULT_WEIGHTS };
}

// ── Layout ────────────────────────────────────────────────
function computeLayout() {
  const grid = document.getElementById('grid');
  const w = grid.offsetWidth || window.innerWidth;
  const h = grid.offsetHeight || window.innerHeight;
  layoutRects = squarify(sectorData, { x: 0, y: 0, w, h });
}

function renderTiles() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  for (const rect of layoutRects) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.ticker = rect.ticker;

    // Apply position with gap
    tile.style.left = (rect.x + TILE_GAP) + 'px';
    tile.style.top = (rect.y + TILE_GAP) + 'px';
    tile.style.width = Math.max(0, rect.w - TILE_GAP * 2) + 'px';
    tile.style.height = Math.max(0, rect.h - TILE_GAP * 2) + 'px';

    // Color from quote data
    const data = quoteData[rect.ticker];
    const dp = data ? data.dp : null;
    tile.style.backgroundColor = pctToColor(dp);

    // Determine content tier based on tile size
    const tileW = rect.w - TILE_GAP * 2;
    const tileH = rect.h - TILE_GAP * 2;
    const minDim = Math.min(tileW, tileH);

    if (minDim > 120) {
      // Large tile: sector name + ticker + change + weight
      const sectorEl = document.createElement('span');
      sectorEl.className = 'sector-name';
      sectorEl.textContent = rect.sector;
      sectorEl.style.fontSize = Math.max(10, minDim * 0.12) + 'px';

      const tickerEl = document.createElement('span');
      tickerEl.className = 'ticker';
      tickerEl.textContent = rect.ticker;
      tickerEl.style.fontSize = Math.max(14, minDim * 0.22) + 'px';

      const changeEl = document.createElement('span');
      changeEl.className = 'change';
      changeEl.textContent = formatPct(dp);
      changeEl.style.fontSize = Math.max(12, minDim * 0.16) + 'px';

      const weightEl = document.createElement('span');
      weightEl.className = 'weight';
      weightEl.textContent = rect.weight.toFixed(1) + '%';
      weightEl.style.fontSize = Math.max(9, minDim * 0.09) + 'px';

      tile.appendChild(sectorEl);
      tile.appendChild(tickerEl);
      tile.appendChild(changeEl);
      tile.appendChild(weightEl);
    } else if (minDim > 60) {
      // Medium tile: ticker + change
      const tickerEl = document.createElement('span');
      tickerEl.className = 'ticker';
      tickerEl.textContent = rect.ticker;
      tickerEl.style.fontSize = Math.max(12, minDim * 0.22) + 'px';

      const changeEl = document.createElement('span');
      changeEl.className = 'change';
      changeEl.textContent = formatPct(dp);
      changeEl.style.fontSize = Math.max(10, minDim * 0.16) + 'px';

      tile.appendChild(tickerEl);
      tile.appendChild(changeEl);
    } else {
      // Small tile: ticker only
      const tickerEl = document.createElement('span');
      tickerEl.className = 'ticker';
      tickerEl.textContent = rect.ticker;
      tickerEl.style.fontSize = Math.max(9, minDim * 0.28) + 'px';

      tile.appendChild(tickerEl);
    }

    grid.appendChild(tile);
  }
}

function updateColors() {
  const tiles = document.querySelectorAll('.tile');
  for (const tile of tiles) {
    const ticker = tile.dataset.ticker;
    const data = quoteData[ticker];
    const dp = data ? data.dp : null;
    tile.style.backgroundColor = pctToColor(dp);

    // Update change text
    const changeEl = tile.querySelector('.change');
    if (changeEl) changeEl.textContent = formatPct(dp);
  }
}

// ── Data fetching ─────────────────────────────────────────
async function fetchQuotes() {
  const fetches = sectorData.map(async ({ ticker }) => {
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && typeof data.dp === 'number') {
        quoteData[ticker] = { dp: data.dp };
      }
    } catch (err) {
      console.error(`Error fetching ${ticker}:`, err);
    }
  });

  await Promise.all(fetches);
  updateColors();
}

// ── Resize handling ───────────────────────────────────────
let resizeTimeout = null;
function handleResize() {
  if (!sectorData.length) return;
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => doLayout(), 150);
}

// ── Init ──────────────────────────────────────────────────
function doLayout() {
  const grid = document.getElementById('grid');
  const w = grid.offsetWidth;
  const h = grid.offsetHeight;
  if (w > 0 && h > 0 && sectorData.length > 0) {
    computeLayout();
    renderTiles();
    updateColors();
    return true;
  }
  return false;
}

async function init() {
  // Fetch sector weights (live or fallback)
  const weights = await fetchSectorWeights();

  // Build sectorData array
  sectorData = SECTORS.map(s => ({
    ...s,
    weight: weights[s.ticker] || DEFAULT_WEIGHTS[s.ticker] || 1,
  }));

  // Try layout immediately, then retry a few times if viewport not ready
  if (!doLayout()) {
    let attempts = 0;
    const poller = setInterval(() => {
      if (doLayout() || ++attempts > 100) clearInterval(poller);
    }, 50);
  }

  // Fetch quotes and start refresh
  fetchQuotes();
  refreshTimer = setInterval(fetchQuotes, REFRESH_MS);

  // Handle window resize (also catches late viewport initialization)
  window.addEventListener('resize', handleResize);
}

document.addEventListener('DOMContentLoaded', init);
