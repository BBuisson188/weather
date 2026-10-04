const assert = require('node:assert/strict');
const weather = require('../weather-summary.js');
const HOUR = 3600000;
const start = new Date(2026, 9, 4), end = new Date(2026, 9, 5);
function fixture() {
  return Array.from({ length: 28 }, (_, index) => ({ time: new Date(start.getTime() + (index - 1) * HOUR),
    prob: 0, amount: 0, code: 0, temp: 70, feels: 70, wind: 5, gust: 10 }));
}
function edit(rows, hour, changes) { Object.assign(rows.find(item => item.time.getTime() === start.getTime() + hour * HOUR), changes); }
const analyze = (rows, options = {}) => weather.analyze(rows, { start, end, now: start, ...options });
const describe = model => weather.describe(model, {
  when: date => 'Sunday ' + (date.getHours() < 6 ? 'early morning' : date.getHours() < 12 ? 'morning' : date.getHours() < 17 ? 'afternoon' : 'evening'),
  clock: date => date.getHours() === 0 ? 'midnight' : String(date.getHours()), amount: value => 'about ' + value.toFixed(2) + ' in expected', dayLabel: 'Sunday'
});
const rows = fixture();
edit(rows, 11, { prob: 25, amount: 0 });
edit(rows, 14, { prob: 40, amount: 0.02 }); edit(rows, 15, { prob: 45, amount: 0.03 });
edit(rows, 16, { prob: 55, amount: 0.03 }); edit(rows, 17, { prob: 60, amount: 0.04 });
edit(rows, 18, { prob: 70, amount: 0.05 }); edit(rows, 19, { prob: 85, amount: 0.2 });
edit(rows, 20, { prob: 65, amount: 0.03 });
const rain = analyze(rows);
assert.equal(rain.dayPeak.value, 85); assert.equal(rain.rainPeak.start.time.getHours(), 19, 'true whole-day peak, not first weak chance');
assert.equal(rain.rainWindows[0].start.time.getHours(), 14, '20-25% does not trigger onset');
assert.equal(rain.rainWindows[0].end.time.getHours(), 21, 'two low hours plus no later return permit easing');
const rainText = describe(rain);
assert.match(rainText.detail, /Highest hourly chance near 85% around 19/);
assert.match(rainText.detail, /Chances increase around 14/);
assert.match(rainText.detail, /may ease around 21/);
assert(!/rainy day/i.test(rainText.title), 'short high-probability event is not an all-day washout');
const ongoing = analyze(rows, { today: true, now: new Date(start.getTime() + 15.5 * HOUR) });
assert.match(describe(ongoing).title, /remain elevated Sunday afternoon/);
assert.match(describe(ongoing).detail, /Highest remaining hourly chance near 85% around 19/);
assert(!/Sunday morning/.test(describe(ongoing).title), 'ongoing Today title does not name an elapsed starting daypart');

const separate = fixture();
for (const hour of [9, 10]) edit(separate, hour, { prob: 45, amount: 0.03 });
for (const hour of [19, 20]) edit(separate, hour, { prob: 80, amount: 0.1 });
const two = analyze(separate);
assert.equal(two.rainWindows.length, 2); assert.equal(two.rainWindows[0].end, null, 'morning break is not final ending');
assert.equal(two.rainWindows[1].end.time.getHours(), 21);
assert.match(describe(two).title, /Separate rain windows/);
assert.match(describe(two).detail, /Another window develops around 19/);
assert.match(describe(two).detail, /from 19 to 20/, 'equal maximum hours form a peak plateau');

const isolated = fixture(); edit(isolated, 15, { prob: 65, amount: 0.02 });
assert.equal(analyze(isolated).rainWindows.length, 1, 'one strong shower remains meaningful');
edit(isolated, 15, { prob: 45 });
assert.equal(analyze(isolated).rainWindows.length, 0, 'isolated moderate spike does not claim definite start');
assert.match(describe(analyze(isolated)).detail, /start time is uncertain/);
const widespread = fixture();
for (let hour = 6; hour < 18; hour++) edit(widespread, hour, { prob: 75, amount: 0.02 });
assert.match(describe(analyze(widespread)).title, /Periods of rain Sunday/);

const missing = rows.filter(item => item.time.getHours() !== 22);
assert.equal(analyze(missing).rainWindows[0].end, null, 'missing hours cannot prove a final ending');
const missingProbability = fixture();
for (const hour of [14,15]) edit(missingProbability, hour, { prob: 80, amount: 0.03 });
edit(missingProbability, 17, { prob: null });
assert.equal(analyze(missingProbability).rainWindows[0].end, null, 'missing probability is not zero');
const overnight = fixture();
for (let hour = 22; hour <= 25; hour++) edit(overnight, hour, { prob: 80, amount: 0.03 });
const overnightModel = analyze(overnight);
assert.equal(overnightModel.rainWindows[0].end, null);
assert(overnightModel.rainWindows[0].crossesMidnight);
assert.match(describe(overnightModel).detail, /extends into/);

const mixed = fixture();
for (const hour of [14,15,16]) edit(mixed, hour, { gust: 35, wind: 22 });
for (const hour of [19,20]) edit(mixed, hour, { prob: 80, code: 95, amount: 0.1 });
const mixedModel = analyze(mixed), mixedText = describe(mixedModel);
assert.equal(mixedModel.primary.kind, 'storm'); assert.equal(mixedModel.secondary.kind, 'wind');
assert(mixedText.title.indexOf('Gusty') < mixedText.title.indexOf('Thunderstorms'), 'mixed headline follows chronological sequence');
assert.match(mixedText.detail, /Gusts peak near 35 mph/);
assert.match(mixedText.detail, /Highest rain chance near 80%/);
assert(!/80%.*storm|storm.*80%|Thunderstorms likely|Thunderstorms expected/.test(mixedText.title), 'no invented storm probability');

for (const [kind, code] of [['ice', 66], ['snow', 73], ['fog', 45]]) {
  const typed = fixture();
  for (const hour of [6,7]) edit(typed, hour, { code, temp: kind === 'fog' ? 65 : 28, prob: kind === 'fog' ? 0 : 80, amount: kind === 'fog' ? 0 : 0.05 });
  const model = analyze(typed), text = describe(model);
  assert.equal(model.primary.kind, kind);
  if (kind === 'snow') { assert.match(text.detail, /accumulation is not available/); assert(!/in expected/.test(text.detail)); }
  if (kind === 'fog') assert(!/visibility.*\d+\s*(mile|meter)/i.test(text.detail));
}
const cold = fixture(); for (const hour of [0,1,2,3]) edit(cold, hour, { temp: 28, feels: 25 });
const freezing = analyze(cold);
assert.equal(freezing.primary.kind, 'freeze'); assert(!freezing.events.some(event => event.kind === 'ice'), 'cold alone does not imply icy roads');
assert.match(describe(freezing).detail, /rise above freezing around 4/);
const heat = fixture(); for (const hour of [13,14,15]) edit(heat, hour, { temp: 95, feels: 103 });
assert.equal(analyze(heat).primary.kind, 'heat'); assert.match(describe(analyze(heat)).detail, /Feels-like temperatures reach 103/);
const sustained = fixture(); edit(sustained, 14, { wind: 25, gust: null });
assert.match(describe(analyze(sustained)).title, /Windy/);
assert.match(describe(analyze(sustained)).detail, /Sustained winds peak near 25 mph around 14/);
const clouds = fixture(); for (let hour = 6; hour < 12; hour++) edit(clouds, hour, { code: 3 });
assert.equal(describe(analyze(clouds)).title, 'Cloudy morning, brighter afternoon');

const elapsed = fixture(); for (const hour of [8,9]) edit(elapsed, hour, { prob: 90, amount: 0.1 });
const rest = analyze(elapsed, { today: true, now: new Date(start.getTime() + 15.5 * HOUR) });
assert.equal(rest.dayPeak.value, 90); assert.equal(rest.rainPeak.value, 0);
assert.equal(describe(rest).title, 'Mostly dry for the rest of today', 'past peak is not announced as upcoming');
assert.match(describe(rest).detail, /Earlier rain chances have eased/);
const uncertain = weather.records({ time: [start.toISOString()], precipitation_probability: [null], weather_code: [null] });
assert.equal(uncertain[0].prob, null); assert.equal(uncertain[0].code, null);
assert.equal(describe(analyze(uncertain)).title, 'Forecast details limited');
console.log('Weather summary checks passed: whole-day peaks, onset/ending thresholds, multiple windows, missing data, midnight carryover, elapsed Today, storms/wind/heat/cold/fog/winter events, cloud transitions, and mixed-event priority. No API requests.');
