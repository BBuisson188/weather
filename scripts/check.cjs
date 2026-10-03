const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
for (const file of ['index.html', 'radar.html', 'ocean.html', 'longrange.html']) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(script, { filename: file });
}
JSON.parse(fs.readFileSync(path.join(root, 'site.webmanifest'), 'utf8'));
const whitespace = spawnSync('git', ['diff', '--check', 'HEAD'], { cwd: root, stdio: 'inherit' });
if (whitespace.error || whitespace.status !== 0) process.exit(1);
const committedWhitespace = spawnSync('git', ['show', '--format=', '--check', 'HEAD'], { cwd: root, stdio: 'inherit' });
if (committedWhitespace.error || committedWhitespace.status !== 0) process.exit(1);
for (const file of fs.readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.cjs')).sort()) {
  const result = spawnSync(process.execPath, [path.join(root, 'tests', file)], { cwd: root, stdio: 'inherit', timeout: 60000 });
  if (result.error || result.status !== 0) { console.error('Check failed: ' + file); process.exit(1); }
}
console.log('All offline pre-publish checks passed. No weather API requests.');
