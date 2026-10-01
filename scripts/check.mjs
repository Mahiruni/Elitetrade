import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['src','scripts','test','public'].flatMap(dir => readdirSync(dir).filter(n => /\.(mjs|js)$/.test(n)).map(n => `${dir}/${n}`));
for (const file of files) {
  const check = spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if (check.status !== 0) process.exit(check.status || 1);
}
for (const asset of ['/app.js','/styles.css','/favicon.svg']) if (!readFileSync('public/index.html','utf8').includes(asset)) throw new Error(`Missing asset ${asset}`);
console.log(`Syntax and entrypoint checks passed (${files.length} JavaScript files).`);
