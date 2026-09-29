const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  SOURCE_URL,
  fetchText,
  parseSectorWeights,
  validateSectorData,
} = require('./scripts/sector-source');

const PORT = 3000;
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// ── Sector weights cache ──────────────────────────────────
let sectorCache = null;
let sectorCacheTime = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getSectorWeights() {
  const now = Date.now();
  if (sectorCache && (now - sectorCacheTime) < CACHE_TTL) {
    return sectorCache;
  }

  try {
    const html = await fetchText(SOURCE_URL);
    const data = parseSectorWeights(html);
    sectorCache = data.sectors;
    sectorCacheTime = now;
    console.log(`Fetched ${data.sectors.length} sector weights from State Street (${data.updated})`);
    return data.sectors;
  } catch (err) {
    console.error('Failed to fetch sector weights:', err.message);
    if (sectorCache) return sectorCache; // return stale cache

    // The checked-in JSON is the durable fallback when the live source is unavailable.
    try {
      const fallback = validateSectorData(JSON.parse(
        fs.readFileSync(path.join(__dirname, 'sectors.json'), 'utf8'),
      ));
      sectorCache = fallback.sectors;
      sectorCacheTime = now;
      console.warn(`Using sectors.json fallback from ${fallback.updated}`);
      return sectorCache;
    } catch (fallbackError) {
      throw new Error(`${err.message}; fallback unavailable: ${fallbackError.message}`);
    }
  }
}

// ── HTTP Server ───────────────────────────────────────────
http.createServer(async (req, res) => {
  // API endpoint for sector weights
  if (req.url === '/api/sectors') {
    try {
      const sectors = await getSectorWeights();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ sectors }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static file serving
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`SP Sectors serving on http://localhost:${PORT}`));
