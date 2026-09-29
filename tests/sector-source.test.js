const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  EXPECTED_SECTORS,
  parseSectorWeights,
  validateSectorData,
} = require('../scripts/sector-source');
const { updateSectorFile } = require('../scripts/update-sectors');

const WEIGHTS = [39.42, 11.53, 9.87, 9.38, 8.55, 8.10, 4.45, 3.41, 1.86, 1.72, 1.71];

function sectorData(updated = '2026-09-28') {
  return {
    sectors: EXPECTED_SECTORS.map((name, index) => ({ name, weight: WEIGHTS[index] })),
    updated,
  };
}

function embeddedHtml(data = sectorData()) {
  const value = {
    asOfDateSimple: 'Sep 28 2026',
    attrArray: data.sectors.map(sector => ({
      name: { value: sector.name },
      weight: { originalValue: String(sector.weight) },
    })),
  };
  const encoded = JSON.stringify(value).replaceAll('"', '&#34;');
  return `<html><input type="hidden" id="index-sector-breakdown" value="${encoded}"></html>`;
}

test('parses and validates State Street embedded sector data', () => {
  const parsed = parseSectorWeights(embeddedHtml());
  assert.equal(parsed.updated, '2026-09-28');
  assert.equal(parsed.sectors.length, 11);
  assert.deepEqual(parsed.sectors[0], { name: 'Information Technology', weight: 39.42 });
});

test('falls back to the visible index table when embedded JSON is absent', () => {
  const rows = sectorData().sectors.map(sector =>
    `<tr><td class="label">${sector.name}</td><td class="data">${sector.weight}%</td></tr>`,
  ).join('');
  const html = `<h3>Index Sector Breakdown <span class="date">as of Sep 28 2026</span></h3><table>${rows}</table>`;
  const parsed = parseSectorWeights(html);
  assert.equal(parsed.updated, '2026-09-28');
  assert.equal(parsed.sectors.length, 11);
});

test('rejects incomplete data instead of replacing valid weights', () => {
  const incomplete = sectorData();
  incomplete.sectors.pop();
  assert.throws(() => validateSectorData(incomplete), /missing: Real Estate/);
});

test('keeps the existing file when the source request fails', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sectors-test-'));
  const outputPath = path.join(directory, 'sectors.json');
  const original = `${JSON.stringify(sectorData('2026-09-15'), null, 2)}\n`;
  fs.writeFileSync(outputPath, original);

  const result = await updateSectorFile({
    outputPath,
    fetcher: async () => { throw new Error('simulated source failure'); },
  });

  assert.equal(result.status, 'fallback');
  assert.equal(fs.readFileSync(outputPath, 'utf8'), original);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('does not replace the existing file with older source data', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sectors-test-'));
  const outputPath = path.join(directory, 'sectors.json');
  const original = `${JSON.stringify(sectorData('2026-09-28'), null, 2)}\n`;
  fs.writeFileSync(outputPath, original);

  const olderHtml = embeddedHtml(sectorData('2026-09-20'))
    .replace('Sep 28 2026', 'Sep 20 2026');
  const result = await updateSectorFile({ outputPath, fetcher: async () => olderHtml });

  assert.equal(result.status, 'fallback');
  assert.equal(fs.readFileSync(outputPath, 'utf8'), original);
  fs.rmSync(directory, { recursive: true, force: true });
});
