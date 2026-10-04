/* Popup-only interpretation of already downloaded forecasts. No requests or storage. */
(function (root) {
  'use strict';
  const weather = root.WeatherSummary || (typeof require === 'function' ? require('./weather-summary.js') : null);
  const HOUR = 3600000;
  const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const dayPart = hour => hour < 6 ? 'early morning' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'late night';
  const clock = hour => hour === 0 ? 'midnight' : hour === 12 ? 'noon' : `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
  const chance = item => item.dailyChanceKnown === false ? null : number(item.precipProb);
  function windText(wind, gust, partial = false, coverage = 'available hours') {
    const parts = [gust === null ? 'Gusts unavailable' : `Gusts up to ${Math.round(gust)} mph`, wind === null ? 'Sustained wind unavailable' : `Sustained up to ${Math.round(wind)} mph`];
    return wind === null && gust === null ? 'Unavailable' : parts.join(' · ') + (partial ? ` (${coverage})` : '');
  }
  function hourly(records, item, offset, source, amount) {
    const start = new Date(`${item.date}T00:00:00Z`), end = new Date(start.getTime() + 24 * HOUR);
    // Analyze provider-local calendar hours on a UTC wall-clock axis. Device timezone
    // must not move a remote location's morning into a different daypart.
    const deduped = new Map(records.map(record => [record.time != null && Number.isFinite(new Date(record.time).getTime()) ? `${record.date || item.date}:${new Date(record.time).getTime()}` : `${record.date || item.date}:${record.hour}`, record]));
    const all = [...deduped.values()].map(record => ({ ...record,
      time: new Date(`${record.date || item.date}T${String(record.hour).padStart(2, '0')}:00:00Z`),
      prob: number(record.prob), amount: number(record.amount), code: number(record.code),
      temp: number(record.temp), feels: number(record.feels), wind: number(record.wind), gust: number(record.gust)
    })).filter(record => Number.isFinite(record.time.getTime()) && record.time >= new Date(start.getTime() - HOUR) && record.time < new Date(end.getTime() + 2 * HOUR));
    const day = all.filter(record => record.time >= start && record.time < end);
    if (!day.length) return null;
    const unique = new Set(day.map(record => record.time.getTime()));
    const complete = day.length === 24 && unique.size === 24;
    const model = weather.analyze(all, { start, end, hourOf: date => date.getUTCHours() });
    const summary = weather.describe(model, { when: date => dayPart(date.getUTCHours()), clock: date => clock(date.getUTCHours()), amount: value => `${amount(value)} expected`, precise: offset <= 3, dayLabel: '' });
    const precipComplete = complete && day.every(record => record.prob !== null && record.amount !== null);
    const amountComplete = complete && day.every(record => record.amount !== null);
    const amountKnown = day.filter(record => record.amount !== null);
    const total = amountKnown.reduce((sum, record) => sum + record.amount, 0);
    const peak = model.rainPeak;
    const windows = model.rainWindows.length ? model.rainWindows : model.events.find(event => ['ice', 'snow', 'storm'].includes(event.kind))?.windows || [];
    function windowText(window) {
      const hour = window.start.time.getUTCHours();
      if (offset > 3) {
        const last = window.last.time.getUTCHours();
        const nextDay = window.last.time >= end;
        return dayPart(hour) === dayPart(last) && !nextDay ? dayPart(hour) : `${dayPart(hour)} through ${dayPart(last)}${nextDay ? ' the following day' : ''}`;
      }
      if (window.gap || !window.breakAt) return `From ${clock(hour)}; ending uncertain`;
      const ending = window.breakAt.time;
      return `${clock(hour)}–${clock(ending.getUTCHours())}${ending >= end ? ' next day' : ''}`;
    }
    const timing = windows.length ? [...new Set(windows.map(windowText))].join(' · ')
      : precipComplete && (peak?.value ?? 0) < 20 && !model.events.some(event => ['storm', 'snow', 'ice'].includes(event.kind)) ? 'No meaningful precipitation window'
      : peak ? 'No clear starting window' : 'Unavailable';
    let peakText = 'Unavailable';
    if (peak) {
      const first = peak.start.time.getUTCHours(), last = peak.end.time.getUTCHours();
      const time = offset <= 3 ? first === last ? `around ${clock(first)}` : `from ${clock(first)} to ${clock(last)}` : `during the ${dayPart(first)}`;
      peakText = `${Math.round(peak.value)}% ${time}${complete && day.every(record => record.prob !== null) ? '' : ' (available hours)'}`;
    }
    let copy = summary.detail;
    if (!model.primary) copy = precipComplete ? 'No meaningful precipitation is indicated in the hourly forecast.' : 'Hourly coverage is incomplete; precipitation timing cannot be fully assessed.';
    if (!precipComplete && !/incomplete|gaps|missing/i.test(copy)) copy = [copy, 'Some hourly precipitation data is missing.'].filter(Boolean).join(' ');
    const winter = model.events.some(event => ['snow', 'ice'].includes(event.kind));
    const wind = model.events.find(event => event.kind === 'wind');
    const windValues = day.map(record => record.wind).filter(value => value !== null), gustValues = day.map(record => record.gust).filter(value => value !== null);
    const maxWind = windValues.length ? Math.max(...windValues) : null, maxGust = gustValues.length ? Math.max(...gustValues) : null;
    const dailyChance = chance(item);
    return { summaryVersion: 2, title: summary.title.trim(), copy,
      rainTiming: timing, timingFieldLabel: 'Precipitation timing',
      peakChance: peakText, peakChanceLabel: 'Peak hourly chance',
      dailyChance: dailyChance === null ? 'Unavailable' : `${Math.round(dailyChance)}%`,
      periodNote: item.source === 'google' || source === 'google' ? 'Hourly details cover this calendar date. Google daily chance covers 7 AM to 7 AM the following day.' : '',
      expectedRain: amountComplete ? total > 0 ? amount(total) : 'Little or none' : total > 0 ? `At least ${amount(total)} · incomplete data` : 'Unavailable · incomplete data',
      amountLabel: winter ? 'Liquid equivalent' : 'Expected precipitation',
      accumulationNote: winter ? 'Snow and ice accumulation cannot be inferred from liquid precipitation amounts.' : '',
      wind: windText(maxWind, maxGust, !complete || day.some(record => record.wind === null || record.gust === null)),
      windTiming: wind ? wind.windows.map(windowText).join(' · ') : '',
      timingLabel: windows.length ? [...new Set(windows.map(window => dayPart(window.start.time.getUTCHours())))].join(' and ') : precipComplete && (peak?.value ?? 0) < 20 && !model.events.some(event => ['storm', 'snow', 'ice'].includes(event.kind)) ? 'dry' : 'unknown',
      timingRank: windows.length ? Math.floor(windows[0].start.time.getUTCHours() / 6) : null,
      peakProb: dailyChance, rainTotal: amountComplete ? total : null, maxWind: maxWind === null ? maxGust : maxGust === null ? maxWind : Math.max(maxWind, maxGust),
      weatherKind: model.primary?.kind === 'storm' ? 'storms' : model.primary?.kind || model.sky,
      source, guidance: offset <= 3 ? complete ? 'Detailed timing' : 'Partial hourly coverage' : offset <= 7 ? 'General timing' : 'Broad guidance'
    };
  }
  function googleParts(item, offset, amount) {
    const day = item.dayParts?.daytime || {}, night = item.dayParts?.nighttime || {};
    const dp = number(day.probability), np = number(night.probability), da = number(day.amount), na = number(night.amount);
    const both = dp !== null && np !== null && da !== null && na !== null;
    const wetDay = (dp !== null && dp >= 20) || (da !== null && da >= .01), wetNight = (np !== null && np >= 20) || (na !== null && na >= .01);
    const winter = [56,57,66,67,71,73,75,77,85,86].includes(item.code);
    const storms = [95,96,99].includes(item.code) || [day.thunder, night.thunder].some(value => number(value) !== null && number(value) >= 20);
    const uncertain = !both;
    const title = winter ? 'Winter precipitation possible' : storms ? 'Thunderstorms possible' : wetDay || wetNight ? 'Precipitation possible' : uncertain ? 'Forecast details limited' : 'Mostly dry conditions';
    const copy = uncertain ? 'Some day/night measurements are missing; a complete precipitation outlook is not available.'
      : wetDay && wetNight ? 'Both daytime and nighttime show a precipitation signal.'
      : wetDay ? 'Nighttime chances are lower than daytime chances.'
      : wetNight ? 'Daytime chances are lower than nighttime chances.'
      : winter ? 'Condition guidance indicates winter precipitation, but its timing is not resolved.'
      : storms ? 'Condition guidance indicates possible thunderstorms, but their timing is not resolved.'
      : 'Neither forecast period shows a meaningful precipitation signal.';
    const total = da !== null && na !== null ? da + na : null;
    const max = key => [number(day[key]), number(night[key])].filter(value => value !== null);
    const winds = max('wind'), gusts = max('gust');
    const dailyChance = chance(item);
    const availablePart = dp !== null || np !== null;
    return { summaryVersion: 2, title, copy,
      rainTiming: wetDay && wetNight ? 'Daytime and night after this date' : wetDay ? 'Daytime' : wetNight ? 'Night after this date' : both && !winter && !storms ? 'No meaningful precipitation window' : 'Unavailable',
      timingFieldLabel: 'Precipitation timing',
      peakChanceLabel: 'Day/night chances', peakChance: availablePart ? `Day: ${dp === null ? 'unavailable' : `${Math.round(dp)}%`} · Night: ${np === null ? 'unavailable' : `${Math.round(np)}%`}` : 'Unavailable',
      dailyChance: dailyChance === null ? 'Unavailable' : `${Math.round(dailyChance)}%`,
      periodNote: 'Daytime: 7 AM–7 PM. Nighttime: 7 PM–7 AM the following day (location time).',
      expectedRain: total === null ? 'Unavailable · incomplete data' : total > 0 ? amount(total) : 'Little or none',
      amountLabel: winter ? 'Liquid equivalent' : 'Expected precipitation', accumulationNote: winter ? 'Snow and ice accumulation cannot be inferred from liquid precipitation amounts.' : '',
      wind: windText(winds.length ? Math.max(...winds) : null, gusts.length ? Math.max(...gusts) : null, winds.length < 2 || gusts.length < 2, 'available periods'),
      timingLabel: wetDay && wetNight ? 'daytime and nighttime' : wetDay ? 'daytime' : wetNight ? 'nighttime' : both && !winter && !storms ? 'dry' : 'unknown',
      timingRank: null, peakProb: dailyChance, rainTotal: total, maxWind: winds.length || gusts.length ? Math.max(...winds, ...gusts) : null,
      weatherKind: winter ? 'winter precipitation' : storms ? 'storms' : wetDay || wetNight ? 'rain' : uncertain ? 'unknown' : 'dry',
      source: 'google', guidance: offset <= 7 ? 'General timing · day/night only' : 'Broad guidance · day/night only'
    };
  }
  const api = { number, hourly, googleParts };
  root.DailyOutlookSummary = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
