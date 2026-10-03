const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(script);
const names = ['loadStorageMap', 'saveStorageMap', 'loadGoogleRainCache', 'saveGoogleRainCache',
  'googleRainLocationKey', 'fetchRainData', 'rollingRainTotals', 'getGoogleObservedRain',
  'loadVisualCrossingRainCache', 'saveVisualCrossingRainCache', 'rainHourEpoch', 'rainWindowSpec',
  'expectedRainHourEpochs', 'normalizedGoogleRainRecords', 'cachedGoogleRainRecords',
  'cachedVisualCrossingRainRecords', 'combinedRainCoverage', 'visualCrossingRainBudget',
  'addVisualCrossingRainCost', 'groupRainHourGaps', 'saveVisualCrossingRainRecords',
  'requestVisualCrossingRainRange', 'estimateRainRangeCost', 'fillVisualCrossingRainGaps',
  'pruneRainHistory', 'getObservedRain', 'collectObservedRain', 'summarizeSavedRain',
  'loadSupplementalIfNear', 'loadSupplementalData', 'activeLocationMatches', 'inchesFromQuantity'];
function extract(name) {
  const pattern = new RegExp('^    (?:async )?function ' + name + '\\(', 'm');
  const start = html.search(pattern);
  assert(start >= 0, name + ' exists');
  const tail = html.slice(start);
  const next = tail.slice(1).search(/^    (?:async )?function /m);
  assert(next >= 0, name + ' has a following function');
  return tail.slice(0, next + 1);
}
const source = names.map(extract).join('\n');
const HOUR = 3600000;
const initial = Date.parse('2026-10-02T16:15:00Z');
function environment(storage = new Map()) {
  const state = { now: initial, calls: [], googleFail: false, visualFail: false, renders: [], rect: { top: 900, bottom: 1100 } };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])); }
    static now() { return state.now; }
  }
  const context = {
    Date: Clock, URLSearchParams, AbortController, setTimeout, clearTimeout, navigator: {},
    console: { warn() {} },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    GOOGLE_RAIN_CACHE_KEY: 'google', VISUAL_CROSSING_RAIN_CACHE_KEY: 'visual',
    VISUAL_CROSSING_RAIN_BUDGET_KEY: 'budget', RAIN_COLLECTION_CACHE_KEY: 'collection',
    RAIN_COLLECTION_TTL_MS: 6 * HOUR, RAIN_MAX_AUTOMATIC_REQUESTS: 3,
    VISUAL_CROSSING_RAIN_DAILY_RECORD_LIMIT: 250, CACHE_LOCATION_LIMIT: 5,
    VISUAL_CROSSING_API_KEY: 'fake', MM_PER_INCH: 25.4, rainCollectionRequests: new Map(),
    rainCollectionQueue: Promise.resolve(), weatherApiKey: () => 'fake',
    providerResponseError: async (_, label) => new Error(label + ' unavailable'),
    activeLocation: { lat: 33.8, lon: -84.4 }, locationViewSequence: 0, recapLoadKey: '', recapState: {}, latestHistoryData: null,
    document: { hidden: false }, window: { innerHeight: 800 },
    els: { quickRecapSection: { getBoundingClientRect: () => state.rect } },
    renderHistory: (...args) => state.renders.push(args),
    loadRecentLocations: () => [], pruneLocationCaches() {},
    getHistory: async () => ({}), getPollenForecast: async () => ({ status: 'available' }),
    fetch: async raw => {
      const url = new URL(raw);
      state.calls.push(url);
      const end = Math.floor(state.now / HOUR) * 3600;
      if (url.hostname === 'weather.googleapis.com') {
        if (state.googleFail) return { ok: false };
        const count = Number(url.searchParams.get('hours'));
        return { ok: true, json: async () => ({ historyHours: Array.from({ length: count }, (_, i) => ({
          interval: { startTime: new Date((end - (count - i) * 3600) * 1000).toISOString() },
          precipitation: { qpf: { quantity: 0.01, unit: 'INCHES' } }
        })) }) };
      }
      if (state.visualFail) return { ok: false };
      const pieces = url.pathname.split('/');
      const start = Number(pieces.at(-2)), finish = Number(pieces.at(-1));
      const count = (finish - start) / 3600 + 1;
      return { ok: true, json: async () => ({ queryCost: count, days: [{ hours: Array.from({ length: count }, (_, i) => ({ datetimeEpoch: start + i * 3600, precip: 0.02 })) }] }) };
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { state, context, storage };
}
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9, `${actual} equals ${expected}`);
async function main() {
  const first = environment();
  const a = first.context.getObservedRain(33.8, -84.4);
  const b = first.context.getObservedRain(33.8, -84.4);
  assert.equal(a, b, 'simultaneous requests share one promise');
  const result = await a;
  assert.equal(first.state.calls.length, 2, 'one Google and one six-day gap request');
  near(result.rain24, 0.24); near(result.rain3d, 0.24 + 48 * 0.02); near(result.rain7d, 0.24 + 144 * 0.02);
  assert.equal(result.rain7dMissingHours, 0);
  assert.equal(first.context.visualCrossingRainBudget().used, 144, 'actual cost replaces reservation');
  assert.equal(result.rainAsOf, '2026-10-02T16:00:00.000Z', 'only completed hours');
  const reload = environment(first.storage);
  reload.state.now += 3 * HOUR;
  const saved = await reload.context.getObservedRain(33.8, -84.4);
  assert.equal(reload.state.calls.length, 0, 'reload within cooldown never downloads');
  near(saved.rain7d, result.rain7d); assert.equal(saved.rainAsOf, result.rainAsOf);
  reload.state.now = initial + 6 * HOUR;
  const updated = await reload.context.getObservedRain(33.8, -84.4);
  assert.equal(reload.state.calls.length, 1, 'Google new hours require no repeat Visual Crossing history');
  assert.equal(reload.state.calls[0].searchParams.get('hours'), '6');
  near(updated.rain7d, 30 * 0.01 + 138 * 0.02);
  const visual = reload.context.cachedVisualCrossingRainRecords(33.8, -84.4);
  assert(visual.every(record => record.epoch >= Math.floor(reload.state.now / HOUR) * 3600 - 168 * 3600));

  const limited = environment();
  limited.context.addVisualCrossingRainCost(190);
  const limitedResult = await limited.context.getObservedRain(33.8, -84.4);
  assert.equal(limited.state.calls.length, 1, 'budget stops history request before download');
  assert.equal(limitedResult.rain7d, null); near(limitedResult.rain24, 0.24);
  assert.match(limitedResult.rainCollectionNote, /allowance/);

  const failure = environment(); failure.state.googleFail = true; failure.state.visualFail = true;
  await failure.context.getObservedRain(33.8, -84.4);
  const failedReload = environment(failure.storage); failedReload.state.now += HOUR;
  await failedReload.context.getObservedRain(33.8, -84.4);
  assert.equal(failedReload.state.calls.length, 0, 'failed providers do not retry on reload');
  assert(failure.context.visualCrossingRainBudget().used > 0, 'failed request reservation remains protective');

  const overlap = environment();
  const epochs = overlap.context.expectedRainHourEpochs(24);
  const google = epochs.map(epoch => ({ epoch, precip: 0.01 }));
  const backup = epochs.map(epoch => ({ epoch, precip: 0.9 }));
  near(overlap.context.combinedRainCoverage(google, backup, 24).value, 0.24);
  assert.equal(overlap.context.combinedRainCoverage(google.slice(1), [], 24).value, null, 'missing hour is not presented as complete');
  assert(!epochs.includes(Math.floor(initial / HOUR) * 3600), 'current unfinished hour excluded');

  const fragmented = environment();
  const seven = fragmented.context.expectedRainHourEpochs(168);
  const missing = new Set([seven[0], seven[25], seven[50], seven[75]]);
  fragmented.context.saveVisualCrossingRainRecords(33.8, -84.4, seven.filter(epoch => !missing.has(epoch)).map(epoch => ({ epoch, precip: 0.02 })));
  const fragmentedResult = await fragmented.context.getObservedRain(33.8, -84.4);
  assert.equal(fragmented.state.calls.filter(url => url.hostname !== 'weather.googleapis.com').length, 3, 'fragmented gaps have a per-collection request cap');
  assert.equal(fragmentedResult.rain7dMissingHours, 1);
  assert.equal(fragmentedResult.rain7d, null);
  assert.match(fragmentedResult.rainCollectionNote, /next collection/);

  const shared = environment();
  const otherTab = environment(shared.storage);
  let lockQueue = Promise.resolve();
  const locks = { request: (_, callback) => { const next = lockQueue.then(callback); lockQueue = next.catch(() => {}); return next; } };
  shared.context.navigator.locks = locks; otherTab.context.navigator.locks = locks;
  await Promise.all([shared.context.getObservedRain(33.8, -84.4), otherTab.context.getObservedRain(33.8, -84.4)]);
  assert.equal(shared.state.calls.length + otherTab.state.calls.length, 2, 'browser lock plus saved cooldown prevents two tabs downloading twice');

  const localPreview = environment();
  localPreview.context.navigator.locks = { request: async () => { const error = new Error('Opaque file origin'); error.name = 'SecurityError'; throw error; } };
  await localPreview.context.getObservedRain(33.8, -84.4);
  assert.equal(localPreview.state.calls.length, 2, 'local preview works when Web Locks are unavailable');
  const noStorage = environment();
  noStorage.context.localStorage.setItem = () => { throw new Error('Storage full'); };
  const noStorageResult = await noStorage.context.getObservedRain(33.8, -84.4);
  assert.equal(noStorage.state.calls.length, 0, 'downloads stop when cooldown cannot be persisted');
  assert.match(noStorageResult.rainCollectionNote, /could not save/);

  const visibility = environment();
  visibility.context.loadSupplementalIfNear();
  assert.equal(visibility.state.calls.length, 0, 'below-screen recap performs no downloads');
  visibility.state.rect = { top: 790, bottom: 1000 };
  visibility.context.loadSupplementalIfNear();
  await visibility.context.getObservedRain(33.8, -84.4);
  assert.equal(visibility.state.calls.length, 2, 'visible recap starts shared collection');
  const previousCalls = visibility.state.calls.length;
  visibility.context.loadSupplementalIfNear();
  assert.equal(visibility.state.calls.length, previousCalls);

  const switched = environment();
  switched.state.rect = { top: 100, bottom: 300 };
  switched.context.loadSupplementalIfNear();
  switched.context.activeLocation = { lat: 40, lon: -70 };
  switched.context.recapState = { marker: 'new location' };
  await switched.context.getObservedRain(33.8, -84.4);
  await Promise.resolve();
  assert.equal(switched.context.recapState.marker, 'new location', 'late old-location responses cannot change new-location recap');

  console.log('Rain history checks passed: merged totals, Google priority, visibility, cooldown/reload, duplicate requests, gap reuse, retention, incomplete data, failures, and usage budget. No real API requests.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
