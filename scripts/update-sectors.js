const fs = require('fs');
const path = require('path');
const {
  SOURCE_URL,
  fetchText,
  parseSectorWeights,
  validateSectorData,
} = require('./sector-source');

const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, '..', 'sectors.json');

function readExistingData(outputPath) {
  if (!fs.existsSync(outputPath)) return null;
  return validateSectorData(JSON.parse(fs.readFileSync(outputPath, 'utf8')));
}

function writeJsonAtomically(outputPath, data) {
  const temporaryPath = `${outputPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, outputPath);
}

async function updateSectorFile({
  sourceUrl = process.env.SP_SECTOR_SOURCE_URL || SOURCE_URL,
  outputPath = process.env.SP_SECTORS_OUTPUT_PATH || DEFAULT_OUTPUT_PATH,
  fetcher = fetchText,
} = {}) {
  let existing;
  try {
    existing = readExistingData(outputPath);
  } catch (error) {
    throw new Error(`Existing sectors.json is not a valid fallback: ${error.message}`);
  }

  try {
    const html = await fetcher(sourceUrl);
    const next = parseSectorWeights(html);

    if (existing && next.updated < existing.updated) {
      throw new Error(`State Street data (${next.updated}) is older than sectors.json (${existing.updated})`);
    }

    writeJsonAtomically(outputPath, next);
    console.log(`Updated ${path.basename(outputPath)} with ${next.sectors.length} sectors as of ${next.updated}`);
    return { status: 'updated', data: next };
  } catch (error) {
    if (!existing) throw error;
    console.warn(`::warning::Sector update skipped: ${error.message}. Keeping sectors.json from ${existing.updated}.`);
    return { status: 'fallback', data: existing, error };
  }
}

if (require.main === module) {
  updateSectorFile().catch(error => {
    console.error(`Sector update failed with no valid fallback: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { readExistingData, updateSectorFile, writeJsonAtomically };
