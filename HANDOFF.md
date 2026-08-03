# Weather App Handoff

## What changed
- Added a richer `Today` hero section in `index.html`.
- The hero narrative is forecast-led: it describes rain/storm timing rather than repeating official alert text.
- Active NWS alerts now appear as formatted items below the hero narrative, prioritized by severity.
- Added support for Flood Watch, Flash Flood Warning, Severe Thunderstorm Watch/Warning, Tornado Watch/Warning, general warnings, watches, and advisories.
- Added forecast hazard items for thunderstorms, heavier rain windows, and gusty periods.
- Fixed tomorrow/midnight wording: rain or storms at `12 AM` are treated as continuing from the prior day, with taper/stop timing when available.
- Added HTML escaping for source-detail rows and today-option rendering.
- Replaced the Next 12 Hours strip with a compact 15-day daily outlook beginning tomorrow.
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
- Recent rain recap prefers saved Google Weather hourly history for each complete rolling total; Visual Crossing is requested only when Google lacks sufficient coverage.
- Daily outlook source order is Google for days 1-9, Visual Crossing for days 10-14, and Open-Meteo for day 15, with per-day fallback where available.

## Cache and Provider Policy
- All location-specific caches retain only the five locations shown in Recent Locations; adding a sixth evicts the oldest location and its cached data.
- Current conditions and the detailed 10-day graph share one forecast response cached for 30 minutes.
- The top Refresh button refreshes that core forecast, with a two-minute guard against repeated network requests; it does not invalidate the daily-outlook cache.
- The 15-day daily outlook is cached for six hours and is invalidated when the local calendar day changes.
- Quick recap data—rain history, freeze/history, and pollen—is lazy-loaded only when the user approaches that section.
- Google rainfall history is refreshed at most every 12 hours and retains eight days of hourly records on that browser so 3-day and 7-day rolling totals can build over time.
- Visual Crossing rainfall is cached for 24 hours and remains limited to one new rain-history request per browser per day. It is only requested when one or more Google totals are incomplete or unavailable.
- Pollen responses, including valid no-index/no-forecast responses, are cached for 24 hours.
- NWS alerts are intentionally not persistently cached.
- These caches live in browser `localStorage`; clearing site data or using another browser/device starts a separate history.

## Unresolved Issues
- Main page and radar page duplicate some NWS alert logic; they could drift over time.
- Weather alert cards show active alerts for today only; tomorrow view remains forecast-only.
- Alert cards are concise and do not show the full NWS headline unless it is used as fallback text.
- No automated browser/UI regression test exists.
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
