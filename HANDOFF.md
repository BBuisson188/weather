# Weather App Handoff

## What changed
- Official NWS notices now persist below the hero narrative regardless of Today/Tomorrow/Next. The two highest-priority notices are shown; View all retains every remaining notice. Warnings precede watches/advisories, with tornado/severe-thunderstorm/flash-flood warnings first. Tapping opens the full official description, affected area, timing, and instructions in the existing scrollable sheet.
- Radar alerts default to enabled. Regional alert requests cover the selected location's state (explicitly labeled); point-only fallback is labeled when state lookup fails. Flood watches/warnings are included in the Severe filter, with flood areas blue, other warnings red, and watches yellow. Missing alert polygons use NWS affected-zone boundaries, labeled as alert areas rather than observed inundation.
- Shared `nws-alerts.js` keeps updated notices, excludes canceled/expired/test notices, shares sorting and safe boundary lookup rules. Alert failures are visible, never silently treated as no alerts. Radar removes old coverage on request failure.
- Today/Tomorrow/Next and their supporting forecast cards now use the pure `weather-summary.js` engine. It evaluates the full day's precipitation peak, meaningful onset, separate windows, and a conservative final easing time; Today distinguishes elapsed weather from the remaining forecast. Rain, storms, winter precipitation, wind, heat/feels-like temperature, freezing/cold temperatures, fog, and cloud transitions have separate rules. No API, cache, or refresh policy changes.
- Headlines cover at most two distinct impactful event types, ordered by time after impact-based selection. Rain is not repeated as a second headline alongside storms/snow/ice; official NWS alert cards remain separately prioritized. Missing hours/probabilities are unknown, not dry. Numeric rain probability is never called thunderstorm probability; liquid precipitation is not converted into snow accumulation.
- iPhone popup safety: main-page location, rainfall/source, and daily-detail overlays share a page scroll lock that preserves/restores the scroll position and stays locked until all overlays close. The ocean beach picker also locks/restores page scrolling. Location and beach-picker headers stay fixed while their content scrolls; button sizes are unchanged.
- Daily tile animations stop the continuous frame loop when no tiles are in the visibility region and resume on return. Hidden-tab pauses preserve the observer; complete re-renders clean it up. These locally drawn graphics do not consume API/network bandwidth.
- Hero titles own the weather condition and daypart. Supporting explanations add precipitation amount, precise clock time, easing time, temperatures, or practical impact rather than restating the title. This applies to Today, Tomorrow, and Next; forecast selection and API/cache behavior are unchanged.
- Today/Tomorrow/Next hero text names the daypart before the clock time: "early Sunday morning, around midnight" versus "late Sunday night." Rain, storm, snow/ice, fog, wind, heat/cold, and supporting hazard-card wording follow this convention.
- Midnight carryover requires the preceding hour to support the same event; continuing storms require a preceding storm code. Separate later precipitation windows prevent a midday break from being described as the day's final ending.
- Rain recap fills saved-history gaps only when actually visible, with hourly-completeness checks, a 40-minute incomplete/failure cooldown, shared request locking, and a daily record allowance. Missing/stale totals offer a guarded "Retry missing hours" action using the same efficient collector, not the old full-history download path.
- The detailed 10-day chart keeps weekday labels in their original position and adds the day-of-month beneath the fourth visible daytime label onward; the first three remain weekday-only.
- Added a richer `Today` hero section in `index.html`.
- The hero narrative is forecast-led: it describes rain/storm timing rather than repeating official alert text.
- Active NWS alerts now appear as formatted items below the hero narrative, prioritized by severity.
- Added support for Flood Watch, Flash Flood Warning, Severe Thunderstorm Watch/Warning, Tornado Watch/Warning, general warnings, watches, and advisories.
- Added forecast hazard items for thunderstorms, heavier rain windows, and gusty periods.
- Fixed tomorrow/midnight wording: early-morning rain is clearly distinguished from late-night rain, with carryover described only when the preceding forecast hour supports it.
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
- Phase two: switching locations immediately restores only that location's cached core forecast, same-calendar-day daily tiles, and recap. Uncached locations show placeholders, never the previous location's weather. Saved forecasts remain visible while updating, with a small update/status line in the hero.
- Every screen load has a request guard, and every location view has its own generation. Late successes/failures cannot change a different view, including rapid A → B → A switches. In-flight core, daily, pollen, and history requests are shared per location; completed cache writes merge with the latest storage map so concurrent locations cannot overwrite one another.
- Pending responses for evicted locations cannot resurrect core/daily/pollen/history caches. Rain collection skips queued evicted locations and prunes all location caches again after completion.
- NWS alerts are checked independently on each location load/refresh and every five minutes only while the page is visible, including an aged check on return. These checks never trigger Google, Visual Crossing, rainfall, or forecast downloads. Main alerts are not persistently cached; retained notices after a failure are explicitly marked previously received.
- Radar reuses its five-minute in-memory alert snapshot when changing filters; manual radar Refresh bypasses that snapshot. State lookup is reused for the session. Static NWS zone outlines are cached for seven days, capped at 100 entries; each mapping pass makes at most 12 unique missing-boundary requests, stops starting requests after 18 seconds, and each request has a 12-second timeout. Incomplete coverage is visibly reported and Refresh retries missing outlines. No Google/Visual Crossing quota is used.
- All location-specific caches retain only the five locations shown in Recent Locations; adding a sixth evicts the oldest location and its cached data.
- Current conditions and the detailed 10-day graph share one forecast response cached for 30 minutes.
- The top Refresh button refreshes only the selected location's core forecast, with a two-minute guard against repeated network requests; it does not launch daily-outlook or quick-recap downloads or clear any other location's cache. It is disabled while that core request is pending.
- The 15-day daily outlook is cached for six hours and is invalidated when the local calendar day changes.
- Opening a daily detail sheet never makes a network request; it reads compact detail already stored with the daily-outlook cache.
- Google hourly detail is limited to the first 96 forecast hours (four 24-record pages) and is used only for days 1-3. Google day/night summaries cover later Google days. Visual Crossing and Open-Meteo detail reuses their already-downloaded hourly data.
- Forecast-change snapshots are stored only for the five recent locations and rotate with the normal daily-outlook cache; no long-term forecast history is accumulated.
- Quick recap data—rain history, freeze/history, and pollen—loads only when the section intersects the viewport; there is no preloading margin or scheduled background collection.
- Rain collection reuses a complete snapshot until a new completed UTC hour exists. Incomplete/failed/pending attempts wait 40 minutes before an automatic retry. Manual retries can bypass that wait after the two-minute repeated-tap guard, but never override the daily allowance. Checks require a visible recap plus a visit/scroll/visibility event; no scheduled or background requests.
- Saved complete totals survive incomplete updates for up to seven days, with a "Saved" label on the tile, per-total as-of time, and the latest missing-hour count in the popup. Newly missing provider hours do not move the collection window backwards or count as zero.
- Google requests only the recent missing span (up to the endpoint's 24-hour limit). Existing Google hours are kept rather than deliberately refreshed. Google cannot recover gaps older than 24 hours.
- Raw Google and Visual Crossing rainfall records are pruned to the last seven days when collection is accessed. Only completed UTC hours count; totals require all 24, 72, or 168 hours and never treat gaps as zero.
- Visual Crossing uses a dynamic-programming gap planner to minimize the conservative estimated record cost of at most three ranges (ties favor fewer requests). Nearby gaps may share a range if cheaper than separate day-expanded responses. The longest affordable total is selected, otherwise shorter totals are prioritized. Each range rechecks saved coverage before download, so wider provider responses can eliminate subsequent requests. Actual `queryCost` still reconciles the reservation; this is cost-aware planning, not a guarantee of exact provider cost.
- The shared 250-record daily browser allowance reserves a conservative whole-day cost before each Visual Crossing request and reconciles it with the actual returned `queryCost`. Failed requests retain their reservation to prevent free retries. This guards rainfall downloads on one browser, not the provider account or other devices/forecast requests.
- Pending collections are shared per location and serialized across locations. Web Locks additionally serialize tabs where supported; other browsers still get same-page serialization and the persistent cooldown.
- Rain popups identify Google/Visual Crossing coverage, the as-of time, provider errors, and why filling paused. "Retry missing hours" appears only for missing or stale totals; there is no allowance override. The top Refresh button remains core-only.
- Location selection now lets `loadWeather()` detect the change before replacing the active location; late supplemental responses cannot mutate the new location's recap.
- Pollen responses, including valid no-index/no-forecast responses, are cached for 24 hours.
- NWS alerts are intentionally not persistently cached.
- These caches live in browser `localStorage`; clearing site data or using another browser/device starts a separate history.

## Testing and Publishing Workflow (User Preference)
- Run `node scripts/check.cjs` for all page-script syntax checks, manifest parsing, whitespace checks, and all offline test suites. The local `.githooks/pre-push` runs it automatically and blocks a failed push. On another checkout, enable it with `git config --local core.hooksPath .githooks`; this repository-local setup is not shared automatically by Git.
- All main-page provider and location lookup requests use `fetchWeatherData`: a 20-second limit covers both connection and response-body download, aborts stalled requests, and preserves provider diagnostics. Existing fallback/cache behavior handles failures; no automatic retry loop is added. Radar/ocean/long-range request plumbing is unchanged.
- Removed the obsolete standalone Visual Crossing history-cache writer. Source-popup action plumbing is retained because the new guarded rainfall retry now uses it.
- Beau tests Google API behavior on the live GitHub Pages site; local Google API testing is not useful for his setup.
- When implementing requested changes that affect Google API requests or depend on Google data to verify, perform offline checks (syntax checks and mocked tests), then commit and push directly to GitHub `main` for live testing. This is standing user authorization for that workflow; do not stop to request another publishing confirmation.
- Do not make live Google API calls locally just to test a change. Keep checks quota-free whenever possible.
- Purely visual UI changes can be previewed and tested locally first. Publish them when the user requests it; the Google-dependent publishing rule does not automatically apply to visual-only changes.
- Mixed UI and Google API changes follow the live-testing workflow after offline validation.
- Publish to the main site, not a PR or separate GitHub testing environment. Verify GitHub Pages deployment and report any deployment failure.
- These preferences apply to implementing requested changes; review-only requests remain read-only.

## Unresolved Issues
- Radar regional coverage is limited to the selected location's state, not all states visible when panning. Missing boundaries may need another explicit Refresh after the bounded lookup allowance; the status reports incomplete coverage.
- No automated browser/UI regression test exists; offline rainfall integration checks are available with `node tests/rain-history.cjs` from the repo folder (fake responses only, no quota usage).
- No bundled build step or package manager; validation is mostly syntax checks and manual browser testing.
- Follow the Testing and Publishing Workflow above for standing authorization and local-versus-live testing.

## Next Recommended Steps
- User decision (phase three): keep current horizontal touch/scroll behavior exactly as-is. Consider vertical page swipes over horizontal strips only if the user later reports a problem; do not implement proactively.
- User decision (phase three): no tap-area/button-size changes approved. Identify the exact controls and discuss before changing them; user currently finds them easy to tap.
- Test the new hero section in-browser with a location that has active flood/severe alerts.
- Verify mobile layout with 0, 1, and multiple alert cards.
- Consider making forecast hazard cards tappable with source details, similar to alert cards.
- Consider showing alert expiration/end text more compactly when multiple alerts are active.

## Important Implementation Notes
- `renderHeroNarrative()` should remain forecast-led; do not let official alert text replace the main headline.
- `renderTodayOptions()` owns forecast-only supporting cards. `renderPersistentAlerts()` owns independent official alert cards and their full details.
- `getWeatherAlerts()` calls `https://api.weather.gov/alerts/active` with `point=lat,lon`.
- `alertPriority()` controls display priority for warning/watch/advisory ordering.
- `buildNextPrecipEvent()` now returns `start`, `end`, `startIndex`, `endIndex`, and `lastActiveIndex`.
- `weather-summary.js` owns hero event analysis, peak selection, carryover, wording, and forecast supporting cards. Legacy first-window hero helpers were removed; `buildNextPrecipEvent()` remains for existing detailed daily-outlook parsing and the independent rain line helper.
- Hero precipitation onset: at least two adjacent hours at 40%+, or one at 60%+; precipitation type/amount can support an event when probability is unavailable. Easing requires two known hours below 30% (without forecast accumulation), no later return, and known coverage through two hours after midnight. These are app heuristics, not meteorological guarantees. Tied contiguous peak hours are described as a range.
- Wind uses 20 mph sustained / 30 mph gust thresholds; heat uses 92°F actual / 100°F feels-like; freezing is 32°F or below, cold is 35°F or below. Forecast codes independently identify storms, snow, icy precipitation, and fog. These thresholds can be adjusted after user testing.
- For Next beyond day three, clock times become general dayparts. Daily-outlook provider/detail/cache behavior remains unchanged.
- Offline hero wording checks: `node tests/hero-wording.cjs`. No live provider requests are made.
- Offline location/cache checks: `node tests/location-cache.cjs`. Covers immediate/stale cache display, A/B/A switches, late failures, concurrent cache writes, request sharing, five-location eviction, and core-only refresh; no live provider requests.
- Offline popup/animation checks: `node tests/iphone-ui.cjs`. No live provider requests; actual iPhone Safari/keyboard behavior still needs user verification.
- Offline provider-timeout checks: `node tests/provider-timeout.cjs` covers connection and response-body stalls, abort/cleanup, and error-response preservation.
- Offline weather analysis checks: `node tests/weather-summary.cjs` covers true day peaks, onset/easing, repeated windows, missing data, carryover, mixed event priority, winter safety distinctions, wind/heat/cold/fog, and cloud transitions.
- Offline NWS checks: `node tests/nws-alerts.cjs` covers persistent cross-tab notices, priority/overflow, full details, updates/cancellations/expiry, visible failures, late-location guards, foreground checks, missing polygon zone resolution, and safe popup text. No live provider calls.
- Thunderstorm detection comes from normalized weather codes `95`, `96`, and `99`.
- Keep edits targeted; this is a single-file app with tightly coupled UI/data logic.
