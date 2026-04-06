const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

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

function fetchSectorPage() {
  return new Promise((resolve, reject) => {
    https.get('https://us500.com/sp500-companies-by-sector', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SPSectors/1.0)' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        https.get(res.headers.location, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SPSectors/1.0)' }
        }, (res2) => {
          let body = '';
          res2.on('data', chunk => body += chunk);
          res2.on('end', () => resolve(body));
          res2.on('error', reject);
        }).on('error', reject);
        return;
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseSectorWeights(html) {
  // Look for __NEXT_DATA__ script tag
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('__NEXT_DATA__ not found');

  const data = JSON.parse(match[1]);

  // Navigate to sector data - try common Next.js paths
  const pageProps = data.props?.pageProps;
  if (!pageProps) throw new Error('pageProps not found');

  // The sector info may be in different locations depending on page structure
  // Try to find labels and hold data (pie chart data)
  let labels, holds;

  if (pageProps.sectors?.info) {
    labels = pageProps.sectors.info.labelsData;
    holds = pageProps.sectors.info.holdData;
  } else if (pageProps.info) {
    labels = pageProps.info.labelsData;
    holds = pageProps.info.holdData;
  }

  if (!labels || !holds || labels.length !== holds.length) {
    throw new Error('Sector labels/holds data not found or mismatched');
  }

  return labels.map((name, i) => ({
    name: name.trim(),
    weight: parseFloat(holds[i]),
  })).filter(s => !isNaN(s.weight));
}

async function getSectorWeights() {
  const now = Date.now();
  if (sectorCache && (now - sectorCacheTime) < CACHE_TTL) {
    return sectorCache;
  }

  try {
    const html = await fetchSectorPage();
    const sectors = parseSectorWeights(html);
    if (sectors.length >= 8) {
      sectorCache = sectors;
      sectorCacheTime = now;
      console.log(`Fetched ${sectors.length} sector weights from us500.com`);
      return sectors;
    }
    throw new Error(`Only got ${sectors.length} sectors`);
  } catch (err) {
    console.error('Failed to fetch sector weights:', err.message);
    if (sectorCache) return sectorCache; // return stale cache
    throw err;
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
