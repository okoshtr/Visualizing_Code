// Builds the web app, the single-file artifact version and the VS Code extension.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const media = join(root, 'node_modules/blockly/media');

const common = { bundle: true, minify: !watch, sourcemap: watch ? 'inline' : false, target: 'es2020', logLevel: 'warning', legalComments: 'none' };

function html(styles, scripts) {
  return readFileSync(join(root, 'src/web/index.html'), 'utf8').replace('<!--STYLES-->', styles).replace('<!--SCRIPTS-->', scripts);
}

async function buildWeb() {
  const out = join(root, 'dist/web');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await esbuild.build({ ...common, entryPoints: { app: join(root, 'src/web/main.ts') }, outdir: out, format: 'iife', define: { __ARTIFACT__: 'false' } });
  cpSync(media, join(out, 'media'), { recursive: true });
  writeFileSync(join(out, 'index.html'), html('<link rel="stylesheet" href="app.css">', '<script src="app.js"></script>'));
}

async function buildArtifact() {
  // One HTML file with inlined script/styles (for sharing as a single page).
  const out = join(root, 'dist/artifact');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const res = await esbuild.build({ ...common, minify: true, entryPoints: { app: join(root, 'src/web/main.ts') }, outdir: out, format: 'iife', write: false, define: { __ARTIFACT__: 'true' } });
  const js = res.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
  const css = res.outputFiles.find((f) => f.path.endsWith('.css')).text;
  const page = html(`<style>${css}</style>`, `<script>${js}</script>`)
    .replace(/^[\s\S]*?<head>\s*/, '')
    .replace(/<\/head>\s*<body>\s*/, '')
    .replace(/\s*<\/body>\s*<\/html>\s*$/, '\n')
    .replace(/<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*/, '');
  writeFileSync(join(out, 'index.html'), page);
  cpSync(media, join(out, 'media'), { recursive: true });
}

async function buildExtension() {
  const out = join(root, 'extension/dist');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await esbuild.build({ ...common, entryPoints: [join(root, 'src/vscode/extension.ts')], outfile: join(out, 'extension.js'), platform: 'node', format: 'cjs', external: ['vscode'] });
  await esbuild.build({ ...common, entryPoints: { webview: join(root, 'src/vscode/webview.ts') }, outdir: out, format: 'iife' });
  cpSync(media, join(out, 'media'), { recursive: true });

}

const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const all = { web: buildWeb, artifact: buildArtifact, extension: buildExtension };
for (const [name, fn] of Object.entries(all)) {
  if (targets.length && !targets.includes(name)) continue;
  const t = Date.now();
  await fn();
  console.log(`✓ ${name} (${Date.now() - t} ms)`);
}
