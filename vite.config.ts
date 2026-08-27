/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { build } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

// The site is served from https://<user>.github.io/gatha/ — see SPEC.md section 2.
// Every asset URL must be built from import.meta.env.BASE_URL, never a leading slash.
export default defineConfig({
  base: '/gatha/',
  build: {
    target: 'es2022',
  },
  plugins: [serviceWorker()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

/**
 * What goes into the cache at install time: the shell, the fonts, and the two
 * corpus files the app cannot start without (SPEC.md §10). Not the discourses —
 * 673 files and three megabytes, which the worker keeps as they are read.
 */
function isPrecached(path: string): boolean {
  if (path === 'index.html') return true;
  if (path.startsWith('assets/')) return true;
  if (path.startsWith('icons/')) return true;
  if (path === 'manifest.webmanifest') return true;
  return path === 'corpus/order.json' || /^corpus\/[a-z-]+\/passages\.json$/.test(path);
}

/**
 * Builds `dist/sw.js` from `src/sw/service-worker.ts` once the rest of the
 * build has been written, with the precache list filled in from what was
 * actually emitted. esbuild comes with Vite, so this costs no dependency.
 */
function serviceWorker(): Plugin {
  let base = '/';
  let outDir = 'dist';

  return {
    name: 'gatha-service-worker',
    apply: 'build',

    configResolved(config) {
      base = config.base;
      outDir = config.build.outDir;
    },

    async closeBundle() {
      const files = walk(outDir).sort();
      const precache = files
        .filter(isPrecached)
        // The shell answers to the base itself, which is what a page load asks
        // for; `index.html` is never requested by name.
        .map((path) => (path === 'index.html' ? base : base + path));

      // Hashed over the contents, not the names. Most assets carry a content
      // hash in the filename already, but `index.html` does not — and since the
      // shell is served cache-first, a version that missed a change to it would
      // leave that change permanently unreachable.
      const digest = createHash('sha256');
      for (const path of files.filter(isPrecached)) {
        digest.update(path);
        digest.update(readFileSync(join(outDir, path)));
      }
      const version = digest.digest('hex').slice(0, 12);

      const result = await build({
        entryPoints: ['src/sw/service-worker.ts'],
        bundle: true,
        format: 'iife',
        target: 'es2022',
        write: false,
        define: {
          __PRECACHE__: JSON.stringify(precache),
          __VERSION__: JSON.stringify(version),
        },
      });

      const [output] = result.outputFiles;
      if (output === undefined) throw new Error('service worker produced no output');
      writeFileSync(join(outDir, 'sw.js'), output.text);
      console.log(`  sw.js  ${String(precache.length)} files precached, version ${version}`);
    },
  };
}

/** Every file under a directory, as slash-separated paths relative to it. */
function walk(root: string, at: string = root): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(at)) {
    const full = join(at, entry);
    if (statSync(full).isDirectory()) found.push(...walk(root, full));
    else found.push(relative(root, full).split(sep).join(posix.sep));
  }
  return found;
}
