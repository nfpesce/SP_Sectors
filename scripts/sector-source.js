const http = require('http');
const https = require('https');

const SOURCE_URL = 'https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-sp-500-etf-trust-spy';

const EXPECTED_SECTORS = [
  'Information Technology',
  'Financials',
  'Communication Services',
  'Health Care',
  'Consumer Discretionary',
  'Industrials',
  'Consumer Staples',
  'Energy',
  'Utilities',
  'Materials',
  'Real Estate',
];

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function decodeHtmlEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function textContent(value) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAsOfDate(value) {
  const cleaned = textContent(String(value)).replace(/^as of\s+/i, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  const match = cleaned.match(/^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{4})$/);
  if (!match || !MONTHS[match[1]]) {
    throw new Error(`Unrecognized State Street as-of date: ${cleaned}`);
  }

  return `${match[3]}-${MONTHS[match[1]]}-${match[2].padStart(2, '0')}`;
}

function parseEmbeddedData(html) {
  const inputTags = html.match(/<input\b[^>]*>/gi) || [];
  const input = inputTags.find(tag => /\bid\s*=\s*["']index-sector-breakdown["']/i.test(tag));
  if (!input) return null;

  const valueMatch = input.match(/\bvalue\s*=\s*(["'])([\s\S]*?)\1/i);
  if (!valueMatch) throw new Error('State Street index-sector-breakdown input has no value');

  const data = JSON.parse(decodeHtmlEntities(valueMatch[2]));
  if (!Array.isArray(data.attrArray)) {
    throw new Error('State Street index sector data has no attrArray');
  }

  return {
    sectors: data.attrArray.map(item => ({
      name: item?.name?.value,
      weight: parseFloat(item?.weight?.originalValue ?? item?.weight?.value),
    })),
    updated: parseAsOfDate(data.asOfDateSimple || data.asOfDate),
  };
}

function parseTableData(html) {
  const sectionMatch = html.match(
    /<h3>\s*Index Sector Breakdown\s*<span[^>]*>\s*as of\s+([^<]+)<\/span>\s*<\/h3>([\s\S]*?)<\/table>/i,
  );
  if (!sectionMatch) return null;

  const sectors = [];
  const rowPattern = /<tr[^>]*>[\s\S]*?<td[^>]*class=["'][^"']*label[^"']*["'][^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*class=["'][^"']*data[^"']*["'][^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;
  let row;
  while ((row = rowPattern.exec(sectionMatch[2])) !== null) {
    sectors.push({
      name: textContent(row[1]),
      weight: parseFloat(textContent(row[2]).replace('%', '')),
    });
  }

  return {
    sectors,
    updated: parseAsOfDate(sectionMatch[1]),
  };
}

function validateSectorData(data) {
  if (!data || !Array.isArray(data.sectors)) {
    throw new Error('Sector data is missing the sectors array');
  }

  const byName = new Map();
  for (const sector of data.sectors) {
    const name = String(sector?.name || '').trim();
    const weight = Number(sector?.weight);
    if (!name || !Number.isFinite(weight) || weight <= 0 || weight >= 100) {
      throw new Error(`Invalid sector entry: ${JSON.stringify(sector)}`);
    }
    if (byName.has(name)) throw new Error(`Duplicate sector: ${name}`);
    byName.set(name, weight);
  }

  const missing = EXPECTED_SECTORS.filter(name => !byName.has(name));
  const extra = [...byName.keys()].filter(name => !EXPECTED_SECTORS.includes(name));
  if (missing.length || extra.length) {
    throw new Error(`Unexpected sector set (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`);
  }

  const updated = parseAsOfDate(data.updated);
  const date = new Date(`${updated}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== updated) {
    throw new Error(`Invalid sector data date: ${updated}`);
  }

  const sectors = EXPECTED_SECTORS.map(name => ({ name, weight: byName.get(name) }))
    .sort((a, b) => b.weight - a.weight);
  const total = sectors.reduce((sum, sector) => sum + sector.weight, 0);
  if (total < 99 || total > 101) {
    throw new Error(`Sector weights total ${total.toFixed(2)}%, expected approximately 100%`);
  }

  return { sectors, updated };
}

function parseSectorWeights(html) {
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('State Street returned an empty response');
  }

  const parsed = parseEmbeddedData(html) || parseTableData(html);
  if (!parsed) throw new Error('State Street index sector breakdown was not found');
  return validateSectorData(parsed);
}

function fetchText(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'http:' ? http : https;
    const request = client.get(parsedUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; SPSectors/2.0; +https://github.com/nfpesce/SP_Sectors)',
      },
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft === 0) return reject(new Error('Too many redirects from State Street'));
        const redirectUrl = new URL(response.headers.location, parsedUrl).toString();
        return resolve(fetchText(redirectUrl, redirectsLeft - 1));
      }

      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`State Street returned HTTP ${response.statusCode}`));
      }

      response.setEncoding('utf8');
      let body = '';
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 5_000_000) {
          request.destroy(new Error('State Street response exceeded 5 MB'));
        }
      });
      response.on('end', () => resolve(body));
      response.on('error', reject);
    });

    request.setTimeout(30_000, () => request.destroy(new Error('State Street request timed out')));
    request.on('error', reject);
  });
}

module.exports = {
  EXPECTED_SECTORS,
  SOURCE_URL,
  fetchText,
  parseAsOfDate,
  parseSectorWeights,
  validateSectorData,
};
