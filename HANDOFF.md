# Weather App Handoff

## What changed
- Rain recap now automatically fills saved-history gaps only when actually visible, with a six-hour collection cooldown per location, shared request locking, and a daily record allowance. The manual rainfall fill button was removed.
- The detailed 10-day chart keeps weekday labels in their original position and adds the day-of-month beneath the fourth visible daytime label onward; the first three remain weekday-only.
- Added a richer `Today` hero section in `index.html`.
- The hero narrative is forecast-led: it describes rain/storm timing rather than repeating official alert text.
- Active NWS alerts now appear as formatted items below the hero narrative, prioritized by severity.
- Added support for Flood Watch, Flash Flood Warning, Severe Thunderstorm Watch/Warning, Tornado Watch/Warning, general warnings, watches, and advisories.
- Added forecast hazard items for thunderstorms, heavier rain windows, and gusty periods.
- Fixed tomorrow/midnight wording: rain or storms at `12 AM` are treated as continuing from the prior day, with taper/stop timing when available.
- Added HTML escaping for source-detail rows and today-option rendering.
- Replaced the Next 12 Hours strip with a compact 15-day daily outlook beginning tomorrow.
- Daily outlook tiles are now buttons that open a scrollable, mobile-safe forecast detail sheet with a plain-English summary, precipitation timing, amount, wind, and forecast source.
- Daily detail language becomes intentionally less precise with distance: exact windows for days 1-3, general dayparts for the middle range, and broad guidance for the longest range.
- Each six-hour daily-outlook refresh compares with the prior saved snapshot and reports meaningful timing, precipitation-chance, condition, source, or high-temperature changes.
- Removed the temporary Google/Visual Crossing rain comparison panel.

## Current Architecture
- Static, mobile-first weather app served from plain HTML files.
- Main page: `index.html`.
- Radar page: `radar.html`.
- Long-range page: `longrange.html`.
- Ocean page: `ocean.html`.
- Saved location and UI preferences use `localStorage`.
- Forecast source priority:
  - Visual Crossing Timeline API first.
  - Open-Meteo GFS fallback for forecast.
- Main-page active alerts use the National Weather Service active alerts API by point.
- Radar page also has NWS alert overlays, implemented separately.
- Recent rain recap combines saved hourly Google and Visual Crossing records, always preferring Google for overlapping hours. One automatic gap fill supplies the 24-hour, 3-day, and 7-day windows together.
- Daily outlook source order is Google for days 1-9, Visual Crossing for days 10-14, and Open-Meteo for day 15, with per-day fallback where available.

## Cache and Provider Policy
- All location-specific caches retain only the five locations shown in Recent Locations; adding a sixth evicts the oldest location and its cached data.
- Current conditions and the detailed 10-day graph share one forecast response cached for 30 minutes.
- The top Refresh button refreshes that core forecast, with a two-minute guard against repeated network requests; it does not invalidate the daily-outlook cache.
- The 15-day daily outlook is cached for six hours and is invalidated when the local calendar day changes.
- Opening a daily detail sheet never makes a network request; it reads compact detail already stored with the daily-outlook cache.
- Google hourly detail is limited to the first 96 forecast hours (four 24-record pages) and is used only for days 1-3. Google day/night summaries cover later Google days. Visual Crossing and Open-Meteo detail reuses their already-downloaded hourly data.
- Forecast-change snapshots are stored only for the five recent locations and rotate with the normal daily-outlook cache; no long-term forecast history is accumulated.
- Quick recap data—rain history, freeze/history, and pollen—loads only when the section intersects the viewport; there is no preloading margin or scheduled background collection.
- Rain collection has a persistent six-hour cooldown per location, including failed attempts. Repeated refreshes, revisits, and reloads reuse the saved result, with its "Totals through" timestamp in the popup.
- Google requests only the recent missing span (up to the endpoint's 24-hour limit). Existing Google hours are kept rather than deliberately refreshed. Google cannot recover gaps older than 24 hours.
- Raw Google and Visual Crossing rainfall records are pruned to the last seven days when collection is accessed. Only completed UTC hours count; totals require all 24, 72, or 168 hours and never treat gaps as zero.
- Visual Crossing fills contiguous missing ranges automatically, selecting the longest affordable window and otherwise prioritizing shorter totals. No more than three Visual Crossing requests are made in a collection. All valid returned completed-hour records are saved, even if the provider returns a wider range, to avoid downloading them again.
- The shared 250-record daily browser allowance reserves a conservative whole-day cost before each Visual Crossing request and reconciles it with the actual returned `queryCost`. Failed requests retain their reservation to prevent free retries. This guards rainfall downloads on one browser, not the provider account or other devices/forecast requests.
- Pending collections are shared per location and serialized across locations. Web Locks additionally serialize tabs where supported; other browsers still get same-page serialization and the persistent cooldown.
- Rain popups identify Google/Visual Crossing coverage, the as-of time, provider errors, and why automatic filling paused. There is no manual download action or allowance override.
- Location selection now lets `loadWeather()` detect the change before replacing the active location; late supplemental responses cannot mutate the new location's recap.
- Pollen responses, including valid no-index/no-forecast responses, are cached for 24 hours.
- NWS alerts are intentionally not persistently cached.
- These caches live in browser `localStorage`; clearing site data or using another browser/device starts a separate history.

## Unresolved Issues
- Main page and radar page duplicate some NWS alert logic; they could drift over time.
- Weather alert cards show active alerts for today only; tomorrow view remains forecast-only.
- Alert cards are concise and do not show the full NWS headline unless it is used as fallback text.
- No automated browser/UI regression test exists; offline rainfall integration checks are available with `node tests/rain-history.cjs` from the repo folder (fake responses only, no quota usage).
- No bundled build step or package manager; validation is mostly syntax checks and manual browser testing.
- GitHub publishing should avoid local `git push` unless explicitly requested by the user.

## Next Recommended Steps
- Extract shared alert helpers if alert behavior needs to evolve on both `index.html` and `radar.html`.
- Test the new hero section in-browser with a location that has active flood/severe alerts.
- Verify mobile layout with 0, 1, and multiple alert cards.
- Consider making forecast hazard cards tappable with source details, similar to alert cards.
- Consider showing alert expiration/end text more compactly when multiple alerts are active.

## Important Implementation Notes
- `renderHeroNarrative()` should remain forecast-led; do not let official alert text replace the main headline.
- `renderTodayOptions()` owns the alert/hazard cards below the hero narrative.
- `getWeatherAlerts()` calls `https://api.weather.gov/alerts/active` with `point=lat,lon`.
- `alertPriority()` controls display priority for warning/watch/advisory ordering.
- `buildNextPrecipEvent()` now returns `start`, `end`, `startIndex`, `endIndex`, and `lastActiveIndex`.
- Continuing precipitation detection currently checks tomorrow events where `startIndex === 0` and the first wet hour is midnight.
- Thunderstorm detection comes from normalized weather codes `95`, `96`, and `99`.
- Keep edits targeted; this is a single-file app with tightly coupled UI/data logic.
