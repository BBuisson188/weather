const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('    async function fetchWeatherData(');
const end = html.indexOf('    function fetchRainData(', start);
assert(start >= 0 && end > start);
const source = html.slice(start, end);
async function main() {
  for (const phase of ['connection', 'body']) {
    let timeout, signal, cleared = false;
    const c = {
      AbortController, setTimeout: callback => { timeout = callback; return 1; }, clearTimeout: () => { cleared = true; },
      fetch: async (_, options) => {
        signal = options.signal;
        if (phase === 'connection') return new Promise(() => {});
        return { ok: true, status: 200, text: () => new Promise(() => {}) };
      }
    };
    vm.createContext(c); vm.runInContext(source, c);
    const request = c.fetchWeatherData('https://example.invalid/weather');
    const failure = assert.rejects(request, /timed out after 20 seconds/);
    await Promise.resolve(); timeout(); await failure;
    assert(signal.aborted); assert(cleared, phase + ' timeout releases timer');
  }
  let options, cleared = false;
  const c = { AbortController, setTimeout: () => 1, clearTimeout: () => { cleared = true; },
    fetch: async (_, input) => { options = input; return { ok: false, status: 429, text: async () => '{"error":{"message":"quota"}}' }; } };
  vm.createContext(c); vm.runInContext(source, c);
  const response = await c.fetchWeatherData('https://example.invalid/weather', { cache: 'no-store', headers: { Accept: 'application/json' } });
  assert.equal(response.status, 429); assert.equal(response.ok, false);
  assert.equal((await response.json()).error.message, 'quota');
  assert.equal(await response.text(), '{"error":{"message":"quota"}}');
  assert.equal(options.cache, 'no-store'); assert.equal(options.headers.Accept, 'application/json'); assert(cleared);
  const unbounded = html.split('\n').filter(line => /await fetch\(/.test(line));
  assert.equal(unbounded.length, 1, 'all main-page provider requests use the bounded helper');
  console.log('Provider timeout checks passed: connection/body stalls abort, timers clear, error diagnostics and request options survive. No API requests.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
