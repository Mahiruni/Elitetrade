import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';

for (const project of ['tsconfig.json', 'web/claude-pro/tsconfig.json']) {
  const check = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', project], { stdio: 'inherit' });
  if (check.status !== 0) process.exit(check.status || 1);
}
await build({ entryPoints: ['web/claude-pro/index.tsx'], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: 'public/claude-pro-bot.js', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' });
await build({ entryPoints: ['web/claude-pro/model.ts'], bundle: true, format: 'esm', target: 'es2022', outfile: 'public/claude-pro-model.js' });
const css = spawnSync(process.execPath, ['node_modules/@tailwindcss/cli/dist/index.mjs', '-i', 'web/claude-pro/styles.css', '-o', 'public/claude-pro-bot.css', '--minify'], { stdio: 'inherit' });
if (css.status !== 0) process.exit(css.status || 1);
const native = 'android-native/app/src/main/assets/claude-pro';
mkdirSync(native, { recursive: true });
copyFileSync('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'public/fonts/inter-latin.woff2');
copyFileSync('public/fonts/inter-latin.woff2', `${native}/inter-latin.woff2`);
copyFileSync('node_modules/@fontsource-variable/inter/LICENSE', 'public/fonts/Inter-OFL.txt');
for (const file of ['Inter-OFL.txt', 'DM-Sans-OFL.txt', 'Instrument-Serif-OFL.txt']) copyFileSync(`public/fonts/${file}`, `${native}/${file}`);
for (const file of ['claude-pro-bot.js', 'claude-pro-bot.css']) copyFileSync(`public/${file}`, `${native}/${file}`);
for (const file of ['dm-sans.woff', 'instrument-serif.woff']) copyFileSync(`public/fonts/${file}`, `${native}/${file}`);
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0D0F12"><title>Claude Pro Bot</title><link rel="stylesheet" href="claude-pro-bot.css"><script type="module" src="claude-pro-bot.js"></script></head><body class="cp-standalone"><div id="claude-pro-root" data-native="true"></div></body></html>';
writeFileSync(`${native}/index.html`, html);
console.log('Claude Pro Bot built for web and native Android.');
