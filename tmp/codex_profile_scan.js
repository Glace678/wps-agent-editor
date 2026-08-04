const fs = require('fs');
const path = require('path');

const root =
  'C:/Users/Glace/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Roaming/Codex/web/Codex';

const patterns = [
  'fast_mode',
  'featureRequirements',
  'serviceTier',
  'gpt-5.4',
  'iconKind":"fast"',
];

const skipDirs = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'ShaderCache',
  'Safe Browsing',
  'Crowd Deny',
  'PKIMetadata',
  'TrustTokenKeyCommitments',
  'component_crx_cache',
  'extensions_crx_cache',
  'GrShaderCache',
]);

function shouldReadFile(name) {
  return (
    /\.(json|ldb|log)$/i.test(name) ||
    /^(Preferences|Local State|CURRENT|MANIFEST.*|README)$/i.test(name) ||
    name === 'browser-sidebar-page-states.json'
  );
}

function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) {
        scan(fullPath);
      }
      continue;
    }

    if (!shouldReadFile(entry.name)) {
      continue;
    }

    try {
      const buf = fs.readFileSync(fullPath);
      const text = buf.toString('utf8');
      const hits = patterns
        .map((pattern) => {
          const idx = text.indexOf(pattern);
          return idx >= 0 ? { pattern, idx } : null;
        })
        .filter(Boolean);

      if (!hits.length) {
        continue;
      }

      console.log(`\nFILE ${fullPath}`);
      for (const hit of hits) {
        const start = Math.max(0, hit.idx - 180);
        const end = Math.min(text.length, hit.idx + 520);
        const snippet = text.slice(start, end).replace(/[\r\n]+/g, ' ');
        console.log(`PAT ${hit.pattern} AT ${hit.idx}`);
        console.log(snippet);
      }
    } catch {}
  }
}

scan(root);
