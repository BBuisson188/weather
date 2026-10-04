(function (root) {
  'use strict';
  function priority(alert) {
    const event = alert.event || '';
    if (/Tornado Warning/i.test(event)) return 100;
    if (/Severe Thunderstorm Warning/i.test(event)) return 95;
    if (/Flash Flood Warning/i.test(event)) return 92;
    if (/Warning/i.test(event)) return 88;
    if (/Tornado Watch/i.test(event)) return 84;
    if (/Severe Thunderstorm Watch/i.test(event)) return 82;
    if (/Flood Watch/i.test(event)) return 78;
    if (/Watch/i.test(event)) return 70;
    if (/Advisory/i.test(event)) return 55;
    return 40;
  }
  function activeFeatures(features, now = Date.now()) {
    const unique = new Map();
    for (const feature of Array.isArray(features) ? features : []) {
      const p = feature?.properties || {};
      if (p.status && p.status !== 'Actual') continue;
      if (/Cancel|Error|Ack/i.test(p.messageType || '')) continue;
      // ends is the event end; expires is the message expiry when ends is absent.
      const end = Date.parse(p.ends || p.expires || '');
      if (Number.isFinite(end) && end <= now) continue;
      const key = p.id || feature.id || JSON.stringify([p.event, p.headline, p.affectedZones]);
      const prior = unique.get(key);
      if (!prior || Date.parse(p.sent || '') >= Date.parse(prior.properties?.sent || '')) unique.set(key, feature);
    }
    return [...unique.values()].sort((a, b) => priority(b.properties || {}) - priority(a.properties || {}) ||
      ({ Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 }[b.properties?.severity] || 0) -
      ({ Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 }[a.properties?.severity] || 0));
  }
  function normalize(features) {
    return activeFeatures(features).map(feature => ({ ...feature.properties, event: feature.properties?.event || 'Weather alert' }));
  }
  function zoneURL(value) {
    try {
      const url = new URL(value);
      return url.origin === 'https://api.weather.gov' && /^\/zones\/(forecast|county|fire|marine)\/[A-Z0-9]+$/.test(url.pathname) ? url.href : null;
    } catch { return null; }
  }
  function polygon(geometry) {
    return geometry && ['Polygon', 'MultiPolygon', 'GeometryCollection'].includes(geometry.type);
  }
  async function mapFeatures(features, getZone) {
    const mapped = [], missing = new Set();
    for (const feature of activeFeatures(features)) {
      if (polygon(feature.geometry)) { mapped.push(feature); continue; }
      const zones = [...new Set((feature.properties?.affectedZones || []).map(zoneURL).filter(Boolean))];
      let complete = zones.length > 0;
      for (const url of zones) {
        let geometry;
        try { geometry = await getZone(url); } catch { /* Keep the alert visible in the coverage status. */ }
        if (polygon(geometry)) mapped.push({ ...feature, geometry, properties: { ...feature.properties, boundarySource: 'NWS county/forecast-zone boundary' } });
        else complete = false;
      }
      if (!complete) missing.add(feature.properties?.id || feature.id || feature.properties?.event);
    }
    return { features: mapped, missingCount: missing.size };
  }
  const api = { priority, activeFeatures, normalize, zoneURL, mapFeatures };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NWSAlerts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
