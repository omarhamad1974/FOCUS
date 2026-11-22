import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Files under public/ that every visit needs (the rest, like demo photos, is cached on first use). */
const PUBLIC_SHELL = ['manifest.webmanifest', 'splash.js', 'brand'];

function publicFiles(): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) readdirSync(p).forEach((f) => walk(join(p, f)));
    else out.push(relative('public', p).split('\\').join('/'));
  };
  PUBLIC_SHELL.forEach((f) => walk(join('public', f)));
  return out;
}

/**
 * Writes sw.js next to index.html at build time. Its precache list holds this
 * build's hashed files, and its version is a hash of their contents, so every
 * deploy installs a fresh service worker and drops the old cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'pingo-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = ['./', ...Object.keys(bundle), ...publicFiles()].filter((f) => !f.endsWith('.map'));
      const hash = createHash('sha256');
      for (const [name, chunk] of Object.entries(bundle)) {
        hash.update(name);
        hash.update(chunk.type === 'chunk' ? chunk.code : chunk.source);
      }
      publicFiles().forEach((f) => hash.update(readFileSync(join('public', f))));
      const source = readFileSync('pwa/sw.js', 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PRECACHE__', JSON.stringify(files.map((f) => (f === './' || f.startsWith('./') ? f : `./${f}`))));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Relative base so the build works on GitHub Pages under any repository name.
export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  test: { environment: 'node' },
} as never);
