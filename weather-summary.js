/* Pure forecast analysis. No fetches, storage, timers, or generated prose services. */
(function (root) {
  'use strict';
  const HOUR = 3600000;
  const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const codes = {
    storm: [95, 96, 99], snow: [71, 73, 75, 77, 85, 86], ice: [56, 57, 66, 67], fog: [45, 48]
  };
  function records(hourly) {
    return (hourly?.time || []).map((time, index) => ({
      time: new Date(time), prob: number(hourly.precipitation_probability?.[index]),
      amount: number(hourly.precipitation?.[index]), code: number(hourly.weather_code?.[index]),
      temp: number(hourly.temperature_2m?.[index]), feels: number(hourly.apparent_temperature?.[index]),
      wind: number(hourly.wind_speed_10m?.[index]), gust: number(hourly.wind_gusts_10m?.[index])
    })).filter(item => Number.isFinite(item.time.getTime())).sort((a, b) => a.time - b.time);
  }
  function sky(items) {
    const valid = items.filter(item => item.code !== null);
    if (!valid.length) return 'unknown';
    const cloud = valid.filter(item => item.code === 3).length;
    const partial = valid.filter(item => item.code === 2).length;
    const clear = valid.filter(item => [0, 1].includes(item.code)).length;
    return cloud >= valid.length / 2 ? 'cloudy' : cloud + partial >= valid.length / 2 ? 'partly cloudy' : clear >= valid.length / 2 ? 'mostly clear' : 'mixed conditions';
  }
  function peak(items, key) {
    const valid = items.filter(item => item[key] !== null && Number.isFinite(item[key]));
    if (!valid.length) return null;
    const value = Math.max(...valid.map(item => item[key]));
    const matches = valid.filter(item => item[key] === value);
    const start = matches[0];
    let end = start;
    // Report a contiguous plateau, not a range that includes a lower-chance break.
    for (let index = 1; index < matches.length && matches[index].time - end.time === HOUR; index++) end = matches[index];
    return { value, start, end };
  }
  function analyze(all, { start, end, now = start, today = false, hourOf = date => date.getHours() }) {
    const day = all.filter(item => item.time >= start && item.time < end);
    const upcoming = day.filter(item => !today || item.time.getTime() + HOUR > now.getTime());
    const byHour = new Map(all.map(item => [item.time.getTime(), item]));
    const horizon = end.getTime() + 2 * HOUR;
    const activeRain = item => item.prob === null ? (item.amount !== null && item.amount >= 0.01 ? true : null) : item.prob >= 30 || (item.amount !== null && item.amount >= 0.01);
    const onsetRain = item => {
      if (item.prob === null) return item.amount !== null && item.amount >= 0.01 && [51,53,55,61,63,65,80,81,82].includes(item.code);
      const next = byHour.get(item.time.getTime() + HOUR);
      return item.prob >= 60 || (item.prob >= 40 && next?.prob !== null && next?.prob >= 40);
    };
    function windows(active, onset = item => active(item) === true) {
      const found = [];
      let current = null, firstDry = null, dryCount = 0;
      for (let time = start.getTime(); time < horizon; time += HOUR) {
        const item = byHour.get(time);
        const state = item ? active(item) : null;
        if (state === true) {
          if (!current && time < end.getTime() && onset(item)) {
            current = { start: item, last: item, gap: false, breakAt: null };
            found.push(current);
          }
          if (current) current.last = item;
          firstDry = null; dryCount = 0;
        } else if (state === false) {
          if (!firstDry) firstDry = item;
          dryCount++;
          if (current && dryCount >= 2) { current.breakAt = firstDry; current = null; }
        } else {
          if (current) current.gap = true;
          firstDry = null; dryCount = 0;
        }
      }
      const relevant = found.filter(window => !today || window.last.time.getTime() + HOUR > now.getTime());
      for (const window of relevant) {
        window.end = null;
        if (window.breakAt && !window.gap) {
          let dry = true;
          for (let time = window.breakAt.time.getTime(); time < horizon; time += HOUR) {
            const item = byHour.get(time);
            if (!item || active(item) !== false) { dry = false; break; }
          }
          if (dry) window.end = window.breakAt;
        }
        const prior = byHour.get(window.start.time.getTime() - HOUR);
        window.continuing = window.start.time.getTime() === start.getTime() && prior && active(prior) === true;
        window.underway = today && window.start.time <= now;
        window.crossesMidnight = window.last.time >= end;
      }
      return relevant;
    }
    const rainWindows = windows(activeRain, onsetRain);
    const rainPeak = peak(upcoming, 'prob');
    const dayPeak = peak(day, 'prob');
    const high = peak(upcoming, 'temp');
    const feels = peak(upcoming, 'feels');
    const validTemps = upcoming.filter(item => item.temp !== null);
    const lowItem = validTemps.reduce((best, item) => !best || item.temp < best.temp ? item : best, null);
    const gust = peak(upcoming, 'gust'), wind = peak(upcoming, 'wind');
    const expectedHours = Math.round((end - start) / HOUR);
    const probComplete = day.length === expectedHours && day.every(item => item.prob !== null);
    const amountsComplete = upcoming.length > 0 && upcoming.every(item => item.amount !== null)
      && upcoming.every((item, index) => index === 0 || item.time - upcoming[index - 1].time === HOUR)
      && upcoming[upcoming.length - 1].time.getTime() + HOUR === end.getTime();
    const total = amountsComplete ? upcoming.reduce((sum, item) => sum + item.amount, 0) : null;
    const events = [];
    function add(kind, list, priority, significance, extra = {}) {
      if (!list.length) return;
      events.push({ kind, windows: list, start: list[0].start, priority, significance, ...extra });
    }
    for (const kind of ['ice', 'storm', 'snow', 'fog']) {
      const active = item => item.code === null ? null : codes[kind].includes(item.code);
      add(kind, windows(active), { ice: 100, storm: 95, snow: 90, fog: 50 }[kind], kind === 'fog' ? 3 : 4);
    }
    const chance = rainPeak?.value ?? null;
    if (rainWindows.length || chance >= 20) {
      const fallback = rainPeak ? [{ start: rainPeak.start, last: rainPeak.end, end: null, uncertain: true }] : [];
      add('rain', rainWindows.length ? rainWindows : fallback, chance >= 60 ? 75 : chance >= 40 ? 45 : 15, chance >= 60 ? 4 : chance >= 40 ? 3 : 2,
        { chance, peak: rainPeak, total, timingUncertain: !rainWindows.length,
          widespread: upcoming.filter(item => item.prob !== null && item.prob >= 40).length >= 8 });
    }
    const windy = item => item.wind === null && item.gust === null ? null : (item.wind !== null && item.wind >= 20) || (item.gust !== null && item.gust >= 30);
    add('wind', windows(windy), (gust?.value >= 50 || wind?.value >= 35) ? 85 : 65, 3, { gust, wind });
    add('freeze', windows(item => item.temp === null ? null : item.temp <= 32), 80, 4, { low: lowItem });
    if (!events.some(event => event.kind === 'freeze')) add('cold', windows(item => item.temp === null ? null : item.temp <= 35), 40, 3, { low: lowItem });
    const hot = item => item.temp === null && item.feels === null ? null : (item.temp !== null && item.temp >= 92) || (item.feels !== null && item.feels >= 100);
    add('heat', windows(hot), 60, 3, { high, feels });
    // Rain is supporting context for storm/winter events, not a duplicate headline.
    const hasTypedPrecip = events.some(event => ['ice', 'snow', 'storm'].includes(event.kind));
    const headlineEvents = events.filter(event => !(hasTypedPrecip && event.kind === 'rain'));
    // Freezing temperatures support an icy/snowy event instead of repeating it.
    const ranked = headlineEvents.filter(event => !(events.some(other => ['ice', 'snow'].includes(other.kind)) && event.kind === 'freeze'))
      .sort((a, b) => b.priority - a.priority);
    const primary = ranked[0] || null;
    const secondary = ranked.find(event => event !== primary && event.significance >= 3) || null;
    return { day, upcoming, start, end, now, today, dayPeak, rainPeak, rainWindows, total, probComplete,
      high, low: lowItem, feels, sky: sky(upcoming), events, primary, secondary,
      significance: Math.max(0, ...events.map(event => event.significance)),
      earlierRain: today && day.some(item => item.time.getTime() + HOUR <= now.getTime() && item.prob !== null && item.prob >= 40),
      morningSky: sky(upcoming.filter(item => hourOf(item.time) >= 6 && hourOf(item.time) < 12)),
      afternoonSky: sky(upcoming.filter(item => hourOf(item.time) >= 12 && hourOf(item.time) < 18)) };
  }
  function describe(model, { when, clock, amount, precise = true, dayLabel = 'this day' }) {
    const time = date => precise ? clock(date) : when(date);
    function peakText(value, name) {
      if (!value) return '';
      const plateau = value.start.time.getTime() !== value.end.time.getTime() && time(value.start.time) !== time(value.end.time);
      if (!precise) return `${name} near ${Math.round(value.value)}%.`;
      return `${name} near ${Math.round(value.value)}% ${plateau ? 'from ' + time(value.start.time) + ' to ' + time(value.end.time) : 'around ' + time(value.start.time)}.`;
    }
    function title(event) {
      const window = event.windows[0], timing = when(window.underway ? model.now : event.start.time);
      const ongoing = window.continuing || window.underway;
      if (event.kind === 'rain') {
        if (event.windows.length > 1) return `Separate rain windows ${dayLabel}`;
        if (ongoing && !event.timingUncertain) return `${window.continuing ? 'Rain continuing' : 'Rain chances remain elevated'} ${timing}`;
        if (event.widespread) return `Periods of rain ${dayLabel}`;
        if (event.chance >= 60 && event.start.prob < 60) return `Rain chances build ${timing}`;
        const label = event.chance >= 60 ? (event.widespread ? 'Periods of rain' : 'Rain likely') : event.chance >= 40 || event.chance === null ? 'Showers possible' : 'Slight rain chance';
        return `${label} ${timing}`;
      }
      const label = { storm: ongoing ? 'Storms continuing' : 'Thunderstorms possible', snow: 'Snow possible', ice: 'Icy precipitation possible',
        wind: event.gust?.value >= 30 ? 'Gusty' : 'Windy', freeze: 'Freezing temperatures', cold: 'Cold', heat: 'Hot', fog: 'Fog possible' }[event.kind];
      return `${label} ${timing}`;
    }
    function ending(event) {
      const last = event.windows[event.windows.length - 1];
      const label = { rain: 'Rain chances may ease', storm: 'Storms may ease', wind: 'Winds may ease', fog: 'Visibility may improve', heat: 'Heat may ease', cold: 'Cold may ease', freeze: 'Temperatures', snow: 'Snow may taper off', ice: 'Icy precipitation may ease' }[event.kind];
      if (last.end) {
        if (event.kind === 'freeze') return `Temperatures rise above freezing around ${time(last.end.time)}.`;
        return `${label} around ${time(last.end.time)}.`;
      }
      if (last.crossesMidnight) return `The window extends into ${when(last.last.time)}.`;
      return '';
    }
    function detail(event) {
      const first = event.windows[0];
      const startText = first.underway || first.continuing ? 'Window already underway.' : `Starts around ${time(event.start.time)}.`;
      const finish = ending(event);
      let parts;
      if (event.kind === 'rain') {
        parts = [event.timingUncertain ? 'Start time uncertain.' : first.underway || first.continuing ? '' : `Chances increase around ${time(event.start.time)}.`,
          peakText(event.peak, model.today ? 'Highest remaining hourly chance' : 'Highest hourly chance')];
        if (event.windows.length > 1) parts.push(`Another window develops around ${time(event.windows[event.windows.length - 1].start.time)}.`);
        if (finish) parts.push(finish);
        if (event.total !== null) parts.push(amount(event.total).replace(/^./, letter => letter.toUpperCase()) + (model.today ? ' in the remaining forecast window.' : '.'));
      } else if (['storm', 'snow', 'ice'].includes(event.kind)) {
        parts = [startText];
        if (event.kind === 'storm') {
          parts.push(peakText(model.rainPeak, model.today ? 'Highest remaining hourly rain chance' : 'Highest hourly rain chance'));
          if (model.total !== null && !model.events.some(other => ['snow', 'ice'].includes(other.kind))) parts.push(amount(model.total).replace(/^./, letter => letter.toUpperCase()) + (model.today ? ' in the remaining forecast window.' : '.'));
        }
        else {
          if (model.low) parts.push(`Low near ${Math.round(model.low.temp)}°.`);
          parts.push(event.kind === 'snow' ? 'Snow accumulation is not available in this forecast.' : 'Ice accumulation is not available in this forecast.');
        }
        if (event.windows.length > 1) parts.push(`Another window develops around ${time(event.windows[event.windows.length - 1].start.time)}.`);
        if (finish) parts.push(finish);
      } else if (event.kind === 'wind') {
        parts = [startText];
        if (event.gust?.value >= 30) parts.push(`Gusts peak near ${Math.round(event.gust.value)} mph around ${time(event.gust.start.time)}.`);
        if (event.wind?.value >= 20) parts.push(`Sustained winds peak near ${Math.round(event.wind.value)} mph around ${time(event.wind.start.time)}.`);
        if (finish) parts.push(finish);
      } else if (event.kind === 'heat') {
        parts = [];
        if (event.high) parts.push(`High near ${Math.round(event.high.value)}° around ${time(event.high.start.time)}.`);
        if (event.feels) parts.push(`Feels-like temperatures reach ${Math.round(event.feels.value)}° around ${time(event.feels.start.time)}.`);
        if (finish) parts.push(finish);
      } else if (event.kind === 'freeze' || event.kind === 'cold') {
        parts = [startText];
        if (event.low) parts.push(`Low near ${Math.round(event.low.temp)}° around ${time(event.low.time)}.`);
        if (finish) parts.push(finish);
      } else {
        parts = [startText, 'Visibility may be reduced.'];
        if (finish) parts.push(finish);
      }
      return parts.filter(Boolean).join(' ');
    }
    const selected = [model.primary, model.secondary].filter(Boolean).sort((a, b) => a.start.time - b.start.time);
    function overview() {
      if (selected.length > 1) {
        const [first, second] = selected;
        if (selected.some(event => event.timingUncertain || event.windows.some(window => window.gap))) return 'Incomplete timing data limits how these weather periods can be compared.';
        const names = { rain: 'rain', storm: 'storm', snow: 'snow', ice: 'icy precipitation', wind: 'wind', fog: 'fog', heat: 'heat', freeze: 'freezing temperatures', cold: 'cold' };
        const overlap = first.windows.some(a => second.windows.some(b => a.start.time < new Date(b.last.time.getTime() + HOUR) && b.start.time < new Date(a.last.time.getTime() + HOUR)));
        if (overlap) return `The ${names[first.kind]} and ${names[second.kind]} periods overlap${first.windows.length > 1 || second.windows.length > 1 ? ' during part of the forecast' : ''}.`;
        const before = first.windows.every(window => window.last.time.getTime() + HOUR <= second.start.time.getTime());
        if (before) return `The ${names[first.kind]} period comes before the ${names[second.kind]} period.`;
        return 'These conditions develop in separate periods across the forecast.';
      }
      const event = selected[0], first = event.windows[0], last = event.windows[event.windows.length - 1];
      if (event.timingUncertain) return 'Hourly chances do not establish a clear starting window.';
      if (event.windows.length > 1) return event.kind === 'rain' ? 'A lower-chance break separates the main windows.' : 'Activity returns after a break, rather than lasting continuously.';
      if (first.gap) return 'Gaps in the hourly forecast limit confidence in when conditions improve.';
      if (event.kind === 'rain') {
        const peakLater = event.peak && event.peak.start.time.getTime() >= Math.max(first.start.time.getTime(), model.today ? model.now.getTime() : first.start.time.getTime()) + 2 * HOUR;
        if (peakLater) return last.end ? 'The best chance comes later in the window, followed by lower chances.' : 'The best chance comes later in the window; an ending is not yet clear.';
        if (last.end) return 'Lower chances follow the main window, with no later return indicated.';
        const prior = model.upcoming.filter(item => item.time < first.start.time);
        if (prior.length && prior.every(item => item.prob !== null && item.prob < 30 && item.amount !== null && item.amount < 0.01)) return 'Earlier hours look mostly dry before chances increase.';
        return '';
      }
      if (['freeze', 'cold'].includes(event.kind) && last.end) return 'Temperatures recover after the coldest part of the forecast.';
      if (event.kind === 'heat' && last.end) return 'Temperatures ease after the hottest part of the forecast.';
      if (event.kind === 'wind') {
        const strongest = event.gust?.value >= 30 ? event.gust : event.wind;
        if (strongest && strongest.start.time.getTime() >= Math.max(first.start.time.getTime(), model.today ? model.now.getTime() : first.start.time.getTime()) + 2 * HOUR) return 'The strongest winds come later in the window.';
        if (last.last.time - first.start.time >= 7 * HOUR) return 'Elevated winds extend across much of the forecast.';
      }
      if (event.kind === 'storm' && last.end) {
        const later = model.upcoming.filter(item => item.time >= last.end.time);
        if (later.length && later.every(item => item.prob !== null && item.prob < 30 && item.amount !== null && item.amount < 0.01)) return 'The later forecast is mostly dry.';
        if (later.some(item => item.amount !== null && item.amount >= 0.01)) return 'Rain may continue after the thunderstorm period.';
      }
      // Do not invent another sentence when the heading and measurements already cover the event.
      return '';
    }
    if (!model.upcoming.length) return { title: 'Forecast unavailable', detail: 'Hourly forecast data is missing for this period.', options: [] };
    const range = model.high && model.low ? `Temperatures from about ${Math.round(model.low.temp)}° to ${Math.round(model.high.value)}°.` : 'Temperature details are unavailable.';
    if (!selected.length) {
      const quiet = model.rainPeak?.value < 20 && model.probComplete;
      const transition = model.morningSky === 'cloudy' && model.afternoonSky === 'mostly clear';
      return { title: model.earlierRain && quiet ? 'Mostly dry for the rest of today' : transition ? 'Cloudy morning, brighter afternoon' : model.sky === 'unknown' ? 'Forecast details limited' : model.sky === 'cloudy' ? (quiet ? 'Cloudy but dry' : 'Cloudy skies') : model.sky === 'partly cloudy' ? 'Partly cloudy skies' : model.sky === 'mixed conditions' ? 'Mixed conditions' : 'Mostly clear skies',
        detail: `${model.earlierRain && quiet ? 'Earlier rain chances have eased. ' : ''}${range}${!model.probComplete ? ' Some precipitation timing data is missing.' : ''}`, options: [] };
    }
    const boxTitles = { rain: 'Timing and rainfall', storm: 'Storm timing and rain chance', ice: 'Timing and temperature', snow: 'Timing and temperature', wind: 'Wind speeds and timing', fog: 'Visibility and timing', heat: 'Temperature and feels-like', freeze: 'Temperature and timing', cold: 'Temperature and timing' };
    const options = model.events.filter(event => event.significance >= 3 || selected.includes(event)).sort((a, b) => b.priority - a.priority)
      .filter(event => !(event.kind === 'rain' && model.events.some(other => ['storm', 'snow', 'ice'].includes(other.kind))))
      .filter(event => !(event.kind === 'freeze' && model.events.some(other => ['snow', 'ice'].includes(other.kind))))
      .slice(0, 3).map(event => ({ type: 'forecast', title: boxTitles[event.kind], sub: detail(event), tag: { rain: 'Rain', storm: 'Storms', ice: 'Ice', snow: 'Snow', wind: 'Wind', fog: 'Fog', heat: 'Heat', freeze: 'Freeze', cold: 'Cold' }[event.kind] }));
    return { title: selected.map(title).join('; '), detail: overview(), options };
  }
  const api = { records, analyze, describe };
  root.WeatherSummary = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
