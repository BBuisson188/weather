const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NWSAlerts = require('../nws-alerts.js');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const radar = fs.readFileSync(path.join(root, 'radar.html'), 'utf8');
const polygon = { type: 'Polygon', coordinates: [[[-85, 33], [-84, 33], [-84, 34], [-85, 33]]] };
const zone = 'https://api.weather.gov/zones/forecast/GAZ001';
function fixture(event, extra = {}, geometry = null) {
  return { type: 'Feature', geometry, properties: { id: event, event, status: 'Actual', messageType: 'Update', ends: new Date(Date.now() + 3600000).toISOString(), ...extra } };
}
function functions(source, names, context) {
  vm.createContext(context);
  for (const name of names) {
    const start = source.search(new RegExp('^    (?:async )?function ' + name + '\\(', 'm'));
    assert(start >= 0, name);
    const tail = source.slice(start), end = tail.indexOf('\n    }');
    assert(end >= 0, name + ' closing brace');
    vm.runInContext(tail.slice(0, end + 6), context);
  }
  return context;
}
async function main() {
  const features = [fixture('Flood Watch', { affectedZones: [zone], description: '<script>bad</script>', instruction: 'Avoid flooded roads.' }),
    fixture('Tornado Warning', {}, polygon), fixture('Wind Advisory'), fixture('Severe Thunderstorm Warning'),
    fixture('Canceled', { messageType: 'Cancel' }), fixture('Expired', { ends: new Date(Date.now() - 1000).toISOString() })];
  const normalized = NWSAlerts.normalize(features);
  assert.equal(normalized.length, 4);
  assert.equal(normalized[0].event, 'Tornado Warning');
  assert.equal(normalized[2].event, 'Flood Watch', 'warnings precede watches, watches precede advisories');
  assert.equal(normalized[2].instruction, 'Avoid flooded roads.');
  assert(NWSAlerts.normalize([fixture('Upcoming watch', { effective: new Date(Date.now() + 600000).toISOString() })]).length, 'future-effective active watches remain visible');
  assert.equal(NWSAlerts.zoneURL('https://evil.example/zones/forecast/GAZ001'), null);
  const map = await NWSAlerts.mapFeatures(features, async url => { assert.equal(url, zone); return polygon; });
  assert(map.features.some(f => f.properties.event === 'Flood Watch' && f.geometry === polygon));
  assert(map.features.find(f => f.properties.event === 'Flood Watch').properties.boundarySource);
  assert.equal(map.missingCount, 2, 'alerts without mappable outlines are counted, not silently discarded');
  const failed = await NWSAlerts.mapFeatures([features[0]], async () => { throw Error('offline'); });
  assert.equal(failed.missingCount, 1);

  const container = { innerHTML: '' };
  const context = functions(html, ['escapeHtml', 'alertTone', 'formatAlertWindow', 'renderPersistentAlerts', 'checkWeatherAlerts', 'renderTodayOptions', 'refreshVisibleAlerts'], {
    NWSAlerts, Date, console: { warn() {} }, latestAlertsData: normalized, latestSourceDetails: {}, alertsCheckState: 'ready', alertsCheckedAt: 0,
    sourceRow: (label, value) => ({ label, value }), document: { hidden: false, getElementById: () => container },
    els: { todayOptions: { innerHTML: '', classList: { toggle() {} } } },
    sharedLocationRequest: (kind, lat, lon, callback) => callback(), getWeatherAlerts: async () => [], activeLocationMatches: () => true,
    activeLocation: { lat: 33, lon: -84 }
  });
  context.renderPersistentAlerts();
  assert(container.innerHTML.includes('Tornado Warning'));
  assert(container.innerHTML.includes('View all 4 alerts'));
  assert(!container.innerHTML.includes('Flood Watch'), 'lower priority watch remains in View all');
  assert(context.latestSourceDetails.alerts.rows.some(row => row.label === 'Flood Watch'));
  const banner = container.innerHTML;
  for (const offset of [0, 1, 2]) {
    context.renderTodayOptions(normalized, [], offset);
    assert.equal(container.innerHTML, banner, 'forecast tabs cannot hide persistent alerts');
    assert.equal(context.els.todayOptions.innerHTML, '', 'no duplicate official alert cards');
  }
  context.latestAlertsData = [normalized[2]];
  context.renderPersistentAlerts();
  assert(container.innerHTML.includes('Flood Watch'));
  assert(context.latestSourceDetails['alert-0'].rows.some(row => row.value === 'Avoid flooded roads.'));
  context.getWeatherAlerts = async () => { throw Error('failed'); };
  await context.checkWeatherAlerts(context.activeLocation);
  assert(container.innerHTML.includes('Could not update'));
  assert(container.innerHTML.includes('previously received'));
  context.latestAlertsData = null;
  await context.checkWeatherAlerts(context.activeLocation);
  assert(container.innerHTML.includes('Could not update'), 'failure visible without previous alerts');
  context.getWeatherAlerts = async () => normalized;
  await context.checkWeatherAlerts(context.activeLocation, () => false);
  assert.equal(context.latestAlertsData, null, 'late result cannot replace another location');
  context.alertsCheckState = 'ready';
  let requests = 0;
  context.checkWeatherAlerts = () => { requests++; };
  context.document.hidden = true; context.refreshVisibleAlerts(); assert.equal(requests, 0);
  context.document.hidden = false; context.alertsCheckedAt = Date.now(); context.refreshVisibleAlerts(); assert.equal(requests, 0);
  context.alertsCheckedAt = 0; context.refreshVisibleAlerts(); assert.equal(requests, 1, 'only visible, aged alert checks refresh');
  const rc = functions(radar, ['filterAlertFeatures', 'alertStyle', 'alertEscape'], { NWSAlerts, Date, Set });
  assert(rc.filterAlertFeatures([features[0]], 'severe').length, 'flood watches with null geometry survive filtering');
  assert.equal(rc.alertStyle(features[0]).color, '#48b7ff');
  assert(!rc.alertEscape('<script>').includes('<'));
  assert(!html.includes('message_type=alert&'));
  assert(!radar.includes('message_type=alert&'));
  assert(radar.includes('let alertMode = "all"'));
  const status = { textContent: '' }, button = () => ({ textContent: '', classList: { toggle() {} } });
  const urls = [], layers = [];
  const zones = Array.from({ length: 20 }, (_, i) => `https://api.weather.gov/zones/forecast/GAZ${String(i).padStart(3, '0')}`);
  let regionalFeatures = [fixture('Flood Watch', { affectedZones: zones }), fixture('Tornado Warning', { headline: '<script>bad</script>' }, polygon)];
  const integration = functions(radar, ['updateAlertButtons', 'filterAlertFeatures', 'alertStyle', 'alertEscape', 'radarAlertSnapshot', 'loadAlerts', 'setAlertMode'], {
    NWSAlerts, Date, Set, Map, Object, console: { error() {} },
    alertMode: 'all', alertLoadToken: 0, alertSnapshot: null, alertSnapshotPending: null, alertPointInfo: null, alertPointPending: null,
    locationData: { lat: 33, lon: -84 }, zoneBoundaries: {}, alertsLayer: null,
    SEVERE_ALERTS_BTN: button(), ALL_ALERTS_BTN: button(), document: { getElementById: () => status },
    localStorage: { setItem() {} }, map: { removeLayer() {}, hasLayer: () => true },
    L: { geoJSON: (data, options) => { layers.push({ data, options }); return { addTo() {} }; } },
    alertJSON: async url => {
      urls.push(url);
      if (url.includes('/points/')) return { properties: { relativeLocation: { properties: { state: 'GA' } }, forecastZone: zones[19] } };
      if (url.includes('/alerts/')) return { features: regionalFeatures };
      return { geometry: polygon };
    }
  });
  await integration.loadAlerts();
  assert(urls.some(url => url.includes('area=GA')), 'map fetches state coverage, not only selected point');
  assert.equal(urls.filter(url => url.includes('/zones/')).length, 12, 'missing boundary lookups are capped');
  assert(urls.includes(zones[19]), 'selected-location zone boundary is fetched first');
  assert(status.textContent.includes('not fully mapped'));
  assert.equal(layers[0].data.features.at(-1).properties.event, 'Tornado Warning', 'warning drawn over lower-priority watches');
  let popup;
  layers[0].options.onEachFeature(regionalFeatures[1], { bindPopup: value => { popup = value; } });
  assert(!popup.includes('<script>'), 'real popup construction escapes provider content');
  urls.length = 0;
  await integration.loadAlerts();
  assert.equal(urls.filter(url => url.includes('/alerts/')).length, 0, 'switch/re-render reuses fresh alert snapshot');
  assert.equal(urls.filter(url => url.includes('/zones/')).length, 8, 'next pass fills only missing outlines');
  assert(!status.textContent.includes('not fully mapped'));
  urls.length = 0;
  await integration.loadAlerts(true);
  assert.equal(urls.filter(url => url.includes('/points/')).length, 0);
  assert.equal(urls.filter(url => url.includes('/zones/')).length, 0, 'cached static boundaries not downloaded again');
  assert.equal(urls.filter(url => url.includes('/alerts/')).length, 1, 'manual refresh updates official notices');
  integration.alertJSON = async () => { throw Error('offline'); };
  await integration.loadAlerts(true);
  assert(status.textContent.includes('Could not update'));
  assert.equal(integration.alertsLayer, null, 'failed check removes old map coverage rather than claiming current alerts');
  integration.setAlertMode('all');
  assert.equal(integration.alertMode, 'none');
  assert(status.textContent.includes('hidden'));
  console.log('NWS alert checks passed: persistent cross-tab alerts, priority/overflow, full notices, updates, expired/canceled filtering, visible failures, location guards, zone outlines, safe popups, and foreground-only refresh. No API requests.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
