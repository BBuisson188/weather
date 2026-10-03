const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const names = ['loadStorageMap', 'saveStorageMap', 'saveLocationCacheEntry', 'sharedLocationRequest',
  'setForecastStatus', 'pruneLocationCaches', 'getForecast', 'fetchCoreForecast', 'activeLocationMatches', 'loadWeather'];
const source = names.map(name => {
  const start = html.search(new RegExp('^    (?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const tail = html.slice(start), next = tail.slice(1).search(/^    (?:async )?function /m);
  return tail.slice(0, next + 1);
}).join('\n');
const keys = ['FORECAST_CACHE_KEY', 'DAILY_OUTLOOK_CACHE_KEY', 'POLLEN_CACHE_KEY', 'GOOGLE_RAIN_CACHE_KEY',
  'VISUAL_CROSSING_RAIN_CACHE_KEY', 'VISUAL_CROSSING_HISTORY_CACHE_KEY', 'RAIN_COLLECTION_CACHE_KEY'];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function environment() {
  const storage = new Map(), pending = new Map(), calls = [], renders = [];
  const c = {
    Date, console: { warn() {}, error() {} }, locationRequests: new Map(),
    CORE_FORECAST_TTL_MS: 1800000, MANUAL_REFRESH_GUARD_MS: 120000, CACHE_LOCATION_LIMIT: 5,
    activeLocation: null, weatherLoadSequence: 0, locationViewSequence: 0, recapLoadKey: '',
    recapState: {}, latestForecastData: null, latestOutlookData: null, latestAlertsData: null,
    latestSourceDetails: {}, latestDailyOutlookItems: [], latestHistoryData: null, narrativeDayOffset: null,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    googleRainLocationKey: (lat, lon) => lat.toFixed(3) + ',' + lon.toFixed(3),
    loadRecentLocations: () => c.recent || [], localDateKey: date => date.toISOString().slice(0, 10),
    setStatus() {}, showOnboarding() {}, hideDailyDetail() {}, hideSourceDetail() {}, updateRadarLink() {},
    seedDemo: () => { c.els.currentTemp.textContent = '--'; c.els.currentCondition.textContent = 'Waiting'; },
    renderForecast: (value, label) => { c.latestForecastData = value; c.els.currentTemp.textContent = value.id; renders.push([label, value.id]); },
    renderHistory() {}, renderHeroNarrative() {}, narrativeDefaultOffset: () => 0,
    renderDailyOutlook: items => { c.latestDailyOutlookItems = items; },
    sourceRow: (...args) => args, unavailableSource: (...args) => args,
    getWeatherAlerts: async () => { calls.push('alerts'); return []; },
    getDailyOutlook: async () => { calls.push('daily'); return []; },
    loadSupplementalIfNear: () => calls.push('recap'),
    getVisualCrossingForecast: async (lat, lon) => {
      const key = c.googleRainLocationKey(lat, lon); calls.push(key);
      return pending.get(key)?.promise || { id: key };
    },
    getOpenMeteoForecast: async () => { throw Error('fallback unavailable'); },
    els: {}
  };
  for (const key of keys) c[key] = key;
  for (const name of ['currentTemp', 'currentCondition', 'currentGlyph', 'highSub', 'lowSub', 'outlookChart', 'placeName', 'forecastStatus', 'refreshBtn']) c.els[name] = { textContent: '', innerHTML: '', setAttribute() {} };
  c.els.outlookShell = { querySelectorAll: () => [] };
  vm.createContext(c); vm.runInContext(source, c);
  const save = (key, location, entry) => c.saveStorageMap(key, { ...c.loadStorageMap(key), [c.googleRainLocationKey(location.lat, location.lon)]: entry });
  return { c, storage, calls, renders, pending, save };
}
const a = { lat: 33.8, lon: -84.4, label: 'A' }, b = { lat: 40.1, lon: -74.2, label: 'B' };
async function main() {
  const e = environment(), { c } = e, ak = c.googleRainLocationKey(a.lat, a.lon), bk = c.googleRainLocationKey(b.lat, b.lon);
  e.save(c.FORECAST_CACHE_KEY, a, { value: { id: 'saved A' }, updatedAt: new Date().toISOString() });
  const loadA = c.loadWeather(a);
  assert.equal(c.els.currentTemp.textContent, 'saved A', 'cache appears synchronously');
  await loadA; await flush();
  assert(!e.calls.includes(ak), 'fresh cache avoids provider forecast request');
  assert(e.calls.includes('alerts'), 'alerts checked independently');
  e.calls.length = 0;
  await c.loadWeather(a, true); await flush();
  assert(!e.calls.includes(ak), 'two-minute refresh guard');
  assert(!e.calls.includes('daily') && !e.calls.includes('recap'), 'manual refresh does not load secondary providers');

  e.save(c.FORECAST_CACHE_KEY, a, { value: { id: 'old A' }, updatedAt: new Date(Date.now() - 3600000).toISOString() });
  const waitA = deferred(), waitB = deferred(); e.pending.set(ak, waitA); e.pending.set(bk, waitB);
  const firstA = c.loadWeather(a); await flush();
  const loadB = c.loadWeather(b); assert.equal(c.els.currentTemp.textContent, '--', 'new uncached location clears previous temperature'); await flush();
  const secondA = c.loadWeather(a); assert.equal(c.els.currentTemp.textContent, 'old A', 'stale cached location is restored'); await flush();
  assert.match(c.els.forecastStatus.textContent, /Updating/);
  assert.equal(e.calls.filter(call => call === ak).length, 1, 'rapid return joins in-flight request');
  waitB.resolve({ id: 'new B' }); await loadB;
  assert.equal(c.els.currentTemp.textContent, 'old A', 'late B cannot replace A');
  waitA.resolve({ id: 'new A' }); await Promise.all([firstA, secondA]); await flush();
  assert.equal(c.els.currentTemp.textContent, 'new A');
  assert.equal(c.loadStorageMap(c.FORECAST_CACHE_KEY)[bk].value.id, 'new B', 'background result saved to original location');
  assert.equal(c.loadStorageMap(c.FORECAST_CACHE_KEY)[ak].value.id, 'new A', 'concurrent cache writes preserve both entries');

  const errors = environment(), fail = deferred(); errors.pending.set(ak, fail);
  const badA = errors.c.loadWeather(a); await flush();
  await errors.c.loadWeather(b); fail.reject(Error('offline')); await badA;
  assert.equal(errors.c.els.currentTemp.textContent, bk, 'late failure cannot damage another location');
  assert.notEqual(errors.c.els.currentCondition.textContent, 'Weather unavailable');

  const locations = Array.from({ length: 6 }, (_, i) => ({ lat: i, lon: i + 10 }));
  c.recent = locations.slice(1);
  for (const key of keys) for (const loc of locations) e.save(key, loc, { value: {} });
  c.pruneLocationCaches(c.recent);
  for (const key of keys) assert.equal(Object.keys(c.loadStorageMap(key)).length, 5);
  const evicted = c.googleRainLocationKey(locations[0].lat, locations[0].lon);
  c.saveLocationCacheEntry(c.FORECAST_CACHE_KEY, evicted, { value: { id: 'late evicted' } });
  assert(!c.loadStorageMap(c.FORECAST_CACHE_KEY)[evicted], 'late results do not resurrect evicted cache');
  console.log('Location checks passed: instant/stale caches, safe A/B/A switches and errors, deduplication, merged cache writes, five-location eviction, and core-only refresh. No API requests.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
