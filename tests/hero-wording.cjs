const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
for (const [, source] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(source);
const names = ['formatShortTime', 'dayPartLabel', 'genericDayPart', 'dayOffsetWindow',
  'formatNarrativeWhen', 'narrativeClockLabel', 'narrativeTimingLabel', 'narrativeRainExpectation',
  'isSameForecastDay', 'weatherDayAnalysis', 'describeWeatherDay', 'summarizeDailyNarrative',
  'weekdayName', 'futureEventWhenLabel', 'findNextSignificantWeatherEvent', 'formatRainAmount', 'forecastTodayOptions'];
const context = { Date, Math, Number, WeatherSummary: require('../weather-summary.js') };
vm.createContext(context);
for (const name of names) {
  const start = html.search(new RegExp('^    (?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const tail = html.slice(start), next = tail.slice(1).search(/^    (?:async )?function /m);
  vm.runInContext(tail.slice(0, next + 1), context);
}
const sunday = hour => new Date(2026, 9, 4, hour);
for (const [hour, expected] of [[0, 'early Sunday morning'], [5, 'early Sunday morning'], [6, 'Sunday morning'], [14, 'Sunday afternoon'], [19, 'Sunday evening'], [23, 'late Sunday night']]) {
  assert.equal(context.futureEventWhenLabel(sunday(hour)), expected);
}
assert.equal(context.narrativeTimingLabel(sunday(0)), 'early Sunday morning, around midnight');
assert.equal(context.narrativeTimingLabel(sunday(12)), 'Sunday afternoon, around noon');
assert.equal(context.formatNarrativeWhen(sunday(0), 1), 'early tomorrow morning');
assert.equal(context.formatNarrativeWhen(sunday(23), 1), 'late tomorrow night');
assert.equal(context.formatNarrativeWhen(sunday(0), 0), 'early this morning');
assert.equal(context.formatNarrativeWhen(sunday(23), 0), 'late tonight');
assert.equal(context.formatNarrativeWhen(sunday(19), 1, { sunset: [sunday(17).toISOString()] }), 'tomorrow evening');
function fixture(priorWet = false, code = 61, priorCode = code) {
  const hours = Array.from({ length: 28 }, (_, index) => sunday(index - 1));
  return {
    time: hours.map(date => date.toISOString()),
    temperature_2m: hours.map(() => 65),
    precipitation_probability: hours.map((_, index) => index === 0 ? (priorWet ? 75 : 0) : index <= 2 ? 75 : 0),
    precipitation: hours.map((_, index) => index === 0 ? (priorWet ? 0.1 : 0) : index <= 2 ? 0.3 : 0),
    weather_code: hours.map((_, index) => index === 0 ? (priorWet ? priorCode : 0) : index <= 2 ? code : 0)
  };
}
const now = new Date(2026, 9, 3, 15);
const newRain = context.summarizeDailyNarrative(fixture(false), {}, 1, now);
assert.equal(newRain.title, 'Rain likely early tomorrow morning');
assert.match(newRain.detail, /Chances increase around midnight/);
assert.match(newRain.detail, /About 0.6 in expected/);
assert(!newRain.detail.includes('early tomorrow morning'), 'headline daypart is not restated');
assert(!/Rain is likely|Showers are possible|Storms are possible/.test(newRain.detail));
const carriedRain = context.summarizeDailyNarrative(fixture(true), {}, 1, now);
assert.match(carriedRain.title, /continuing early tomorrow morning/);
assert.match(carriedRain.detail, /Chances remain elevated/);
assert.match(carriedRain.detail, /Rain chances may ease/);
const carriedStorm = context.summarizeDailyNarrative(fixture(true, 95), {}, 1, now);
assert.match(carriedStorm.title, /Storms continuing early tomorrow morning/);
const newStorm = context.summarizeDailyNarrative(fixture(true, 95, 61), {}, 1, now);
assert(!/continuing/.test(newStorm.title), 'earlier rain alone does not imply continuing storms');
assert(!/Thunderstorms likely|Thunderstorms expected/.test(newStorm.title), 'rain probability is not thunderstorm probability');
const options = context.forecastTodayOptions(fixture(false), {}, 1, now);
assert.equal(options[0].title, newRain.title);
assert.equal(options[0].sub, newRain.detail, 'supporting card uses same day analysis');
const actualNext = context.findNextSignificantWeatherEvent(fixture(false), new Date(2026, 9, 2, 15));
assert.equal(actualNext.title, 'Rain likely early Sunday morning');
assert.match(actualNext.detail, /About 0.6 in expected/);
assert(!actualNext.detail.includes('early Sunday morning'));
assert.equal(actualNext.options[0].sub, actualNext.detail);
assert(html.includes('<script src="weather-summary.js"></script>'));
console.log('Hero integration checks passed: shared Today/Tomorrow/Next and supporting summaries, unambiguous midnight/noon/dayparts, precipitation amount, and real storm/rain carryover. No API requests.');
