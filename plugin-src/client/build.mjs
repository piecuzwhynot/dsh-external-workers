import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Build the client bundle the Web shell loads.
 *
 * The shell's module loader expects a CommonJS bundle wrapped in
 * `window.__ModuleLoader__.load({ id, factory })`, with `react` (and
 * `react-dom`) left external so the page's own copy is used.
 *
 * Run with:  node plugin-src/client/build.mjs
 * Set EXTERNAL_WORKERS_ESBUILD to a path when esbuild is not a local dependency.
 */

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(sourceDirectory, '../..');
const outputPath = resolve(packageRoot, 'lib/client.js');
const loaderId = process.env.EXTERNAL_WORKERS_CLIENT_ID ?? 'dsh-external-workers';

const override = process.env.EXTERNAL_WORKERS_ESBUILD;
const esbuild = await import(override !== undefined && override.length > 0 ? pathToFileURL(override).href : 'esbuild');

const result = await esbuild.build({
  entryPoints: [resolve(sourceDirectory, 'index.js')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome100'],
  external: ['react', 'react-dom'],
  write: false,
  minify: process.env.NODE_ENV === 'production',
  legalComments: 'none',
});

const bundled = result.outputFiles?.[0]?.text;
if (!bundled) throw new Error('esbuild did not produce a client bundle');

const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(loaderId)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${bundled}
    return module.exports;
  }
});
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, wrapped, 'utf8');
console.log(`Wrote ${outputPath} (${wrapped.length} bytes)`);
