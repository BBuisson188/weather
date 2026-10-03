const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
for (const [, source] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(source);
const names = ['formatShortTime', 'dayPartLabel', 'genericDayPart', 'dayOffsetWindow',
  'buildNarrativeItems', 'dominantSkyLabel', 'formatNarrativeWhen', 'narrativeClockLabel',
  'narrativeTimingLabel', 'narrativeRainExpectation', 'narrativePrecipDetail', 'isContinuingMidnightPrecip', 'summarizeDailyNarrative',
  'weekdayName', 'futureEventWhenLabel', 'titleCaseWeatherType',
  'summarizeFutureSignificantEvent', 'summarizeFutureSignificantDay',
  'scoreForecastSignificance', 'findNextSignificantWeatherEvent', 'buildNextPrecipEvent',
  'precipTypeLabel', 'formatRainAmount', 'forecastTodayOptions'];
const context = { Date, Math, Number };
vm.createContext(context);
for (const name of names) {
  const start = html.search(new RegExp('^    (?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const tail = html.slice(start);
  const next = tail.slice(1).search(/^    (?:async )?function /m);
  vm.runInContext(tail.slice(0, next + 1), context);
}
const sunday = hour => new Date(2026, 9, 4, hour);
assert.equal(context.futureEventWhenLabel(sunday(0)), 'early Sunday morning');
assert.equal(context.futureEventWhenLabel(sunday(5)), 'early Sunday morning');
assert.equal(context.futureEventWhenLabel(sunday(6)), 'Sunday morning');
assert.equal(context.futureEventWhenLabel(sunday(14)), 'Sunday afternoon');
assert.equal(context.futureEventWhenLabel(sunday(19)), 'Sunday evening');
assert.equal(context.futureEventWhenLabel(sunday(23)), 'late Sunday night');
assert.equal(context.narrativeTimingLabel(sunday(0)), 'early Sunday morning, around midnight');
assert.equal(context.narrativeTimingLabel(sunday(12)), 'Sunday afternoon, around noon');
assert.equal(context.formatNarrativeWhen(sunday(0), 1), 'early tomorrow morning');
assert.equal(context.formatNarrativeWhen(sunday(23), 1), 'late tomorrow night');
assert.equal(context.formatNarrativeWhen(sunday(0), 0), 'early this morning');
assert.equal(context.formatNarrativeWhen(sunday(23), 0), 'late tonight');
// Sunset no longer labels the entire evening as "overnight".
assert.equal(context.formatNarrativeWhen(sunday(19), 1, { sunset: [sunday(17).toISOString()] }), 'tomorrow evening');
const event = { start: { time: sunday(0) }, startIndex: 0, code: 61, total: 1.5, peakProb: 75 };
const next = context.summarizeFutureSignificantEvent(event);
assert.equal(next.title, 'Rain likely early Sunday morning');
assert.equal(next.detail, 'About 1.5 in expected, starting around midnight.');
assert.match(context.summarizeFutureSignificantEvent({ ...event, total: 0 }).detail, /Little accumulation expected/);
for (const code of [61, 95, 73, 66]) {
  const result = context.summarizeFutureSignificantEvent({ ...event, code });
  assert.match(result.detail, /around midnight/);
  assert(!result.detail.includes('early Sunday morning'), 'detail does not repeat the headline daypart');
  assert(!/overnight|12\s*AM|notable/i.test(result.title + result.detail));
}
function fixture(priorWet = false, code = 61, priorCode = code) {
  const hours = [new Date(2026, 9, 3, 23), sunday(0), sunday(1), sunday(2), sunday(3), sunday(14)];
  return {
    time: hours.map(date => date.toISOString()),
    temperature_2m: [65, 64, 63, 62, 62, 74],
    precipitation_probability: [priorWet ? 75 : 0, 75, 75, 0, 0, 0],
    precipitation: [priorWet ? 0.1 : 0, 0.3, 0.3, 0, 0, 0],
    weather_code: [priorWet ? priorCode : 0, code, code, 0, 0, 0]
  };
}
const now = new Date(2026, 9, 3, 15);
const newRain = context.summarizeDailyNarrative(fixture(false), {}, 1, now);
assert.equal(newRain.title, 'Rain likely early tomorrow morning');
assert(!/continu|previous/i.test(newRain.detail));
const carriedRain = context.summarizeDailyNarrative(fixture(true), {}, 1, now);
assert.match(carriedRain.title, /continuing early tomorrow morning/);
assert.match(carriedRain.detail, /expected during this window/);
assert.match(carriedRain.detail, /ease early tomorrow morning/);
const carriedStorm = context.summarizeDailyNarrative(fixture(true, 95), {}, 1, now);
assert.match(carriedStorm.title, /Storms continuing early tomorrow morning/);
const newStorm = context.summarizeDailyNarrative(fixture(true, 95, 61), {}, 1, now);
assert(!/continuing/.test(newStorm.title), 'new storms after earlier rain are not described as carrying over');
const options = context.forecastTodayOptions(fixture(false), {}, 1, now);
assert.match(options[0].sub, /early tomorrow morning, around midnight/);
assert(!/underway|continuing/.test(options[0].title));
assert(!/overnight/.test(options[0].sub));
const futureNow = new Date(2026, 9, 2, 15);
const actualNext = context.findNextSignificantWeatherEvent(fixture(false), futureNow);
assert.equal(actualNext.title, 'Rain likely early Sunday morning');
assert.equal(actualNext.detail, 'About 0.6 in expected, starting around midnight.');
assert(!newRain.detail.includes('early tomorrow morning'));
assert(!/Rain is likely|Showers are possible|Storms are possible/.test(newRain.detail));
for (const hour of [6, 14, 19, 23]) {
  const summary = context.summarizeFutureSignificantEvent({ ...event, start: { time: sunday(hour) } });
  assert(!summary.detail.includes(context.futureEventWhenLabel(sunday(hour))));
  assert(summary.detail.includes(context.narrativeClockLabel(sunday(hour))));
}
console.log('Hero wording checks passed: non-repeating headlines/details, midnight/noon, all dayparts, Today/Tomorrow/Next, precipitation types, real carryover versus new events, and supporting cards. No API requests.');
