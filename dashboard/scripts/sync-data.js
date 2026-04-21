// Copies data files from repo root into dashboard/public/ so Vite
// includes them in the build output served from /repo-health/.
// Runs as `prebuild` + `predev` — always fresh with the latest
// aggregate.js output.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const PUBLIC = resolve(__dirname, '../public');

function copyIf(src, dst) {
  if (existsSync(src)) {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    console.log(`sync: ${src.replace(ROOT, '.')} -> ${dst.replace(PUBLIC, 'public')}`);
  } else {
    console.warn(`sync: skip ${src} (not found — run aggregate.js first)`);
  }
}

copyIf(join(ROOT, 'dashboard.json'), join(PUBLIC, 'dashboard.json'));
copyIf(join(ROOT, 'history-combined.json'), join(PUBLIC, 'history-combined.json'));

const histSrc = join(ROOT, 'history');
const histDst = join(PUBLIC, 'history');
if (existsSync(histSrc)) {
  for (const repo of readdirSync(histSrc)) {
    const combined = join(histSrc, repo, 'combined.json');
    if (existsSync(combined)) {
      const repoDst = join(histDst, repo);
      mkdirSync(repoDst, { recursive: true });
      copyFileSync(combined, join(repoDst, 'combined.json'));
    }
  }
  console.log(`sync: history/*/combined.json copied`);
}
