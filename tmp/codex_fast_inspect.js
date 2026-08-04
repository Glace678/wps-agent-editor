const fs = require('fs');
const path = require('path');
const asar = require('../node_modules/@electron/asar');

const archivePath =
  'C:/Program Files/WindowsApps/OpenAI.Codex_26.727.6591.0_x64__2p2nqsd0c76g0/app/resources/app.asar';

const patterns = [
  'function X1r',
  'isServiceTierAllowed',
  'featureRequirements?.fast_mode',
  'composer.toggleFastMode',
  "availableOptions.find(e=>e.iconKind==='fast')",
];

function findFile(targetDir, name) {
  for (const entry of asar.listPackage(archivePath)) {
    const normalized = entry.replace(/\\/g, '/');
    if (
      normalized.endsWith(`/${name}`) &&
      (!targetDir || normalized.includes(`/${targetDir}/`))
    ) {
      return entry;
    }
  }
  return null;
}

const jsFile = findFile('assets', 'app-initial-cpPdPura.js');
if (!jsFile) {
  const matches = asar
    .listPackage(archivePath)
    .filter((entry) => /app-initial.*\.js$/i.test(entry))
    .slice(0, 20);
  console.error('Could not locate app-initial-cpPdPura.js in archive');
  console.error('Candidates:');
  for (const match of matches) {
    console.error(match);
  }
  process.exit(1);
}

const archiveEntry = jsFile.replace(/\\/g, '/').replace(/^\/+/, '');
const source = asar.extractFile(archivePath, archiveEntry).toString('utf8');
console.log(`JS file: ${archiveEntry}`);

for (const pattern of patterns) {
  const idx = source.indexOf(pattern);
  console.log(`\n=== ${pattern} @ ${idx} ===`);
  if (idx >= 0) {
    console.log(source.slice(Math.max(0, idx - 500), Math.min(source.length, idx + 1800)));
  }
}
