const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const main = read('index.html'), ocean = read('ocean.html');
for (const html of [main, ocean]) for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(script);
function extract(html, name) {
  const start = html.search(new RegExp('^    (?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const tail = html.slice(start), next = tail.slice(1).search(/^    (?:async )?function /m);
  return tail.slice(0, next + 1);
}
function classes(hidden = true) {
  const values = new Set(hidden ? ['hidden'] : []);
  return { contains: key => values.has(key), add: key => values.add(key), remove: key => values.delete(key), toggle: (key, on) => on ? values.add(key) : values.delete(key) };
}
function modalEnvironment(html, fn, positionName, overlayNames) {
  const restored = [], body = { style: {}, classList: classes(false) };
  const c = { document: { body }, window: { scrollY: 456, scrollTo: (...args) => restored.push(args) }, els: {}, [positionName]: null };
  for (const name of overlayNames) c.els[name] = { classList: classes() };
  vm.createContext(c); vm.runInContext(extract(html, fn), c);
  const first = c.els[overlayNames[0]];
  first.classList.remove('hidden'); c[fn]();
  assert.equal(body.style.position, 'fixed'); assert.equal(body.style.top, '-456px');
  c.window.scrollY = 0; c[fn](); assert.equal(body.style.top, '-456px', 'repeated opens retain original scroll position');
  if (overlayNames.length > 1) {
    const second = c.els[overlayNames[1]];
    second.classList.remove('hidden'); first.classList.add('hidden'); c[fn]();
    assert.equal(body.style.position, 'fixed', 'another open popup keeps page locked');
    second.classList.add('hidden');
  } else first.classList.add('hidden');
  c[fn](); assert.equal(body.style.position, ''); assert.deepEqual(restored, [[0, 456]]);
  c[fn](); assert.equal(restored.length, 1, 'redundant close does not move page');
}
modalEnvironment(main, 'syncModalScrollLock', 'modalScrollPosition', ['onboardingOverlay', 'sourceOverlay', 'dailyDetailOverlay']);
modalEnvironment(ocean, 'syncOverlayScrollLock', 'overlayScrollPosition', ['beachOverlay']);
for (const name of ['showOnboarding', 'hideOnboarding', 'showSourceDetail', 'hideSourceDetail', 'showDailyDetail', 'hideDailyDetail']) assert(extract(main, name).includes('syncModalScrollLock()'), name + ' synchronizes lock');
for (const name of ['showOverlay', 'hideOverlay']) assert(extract(ocean, name).includes('syncOverlayScrollLock()'));
assert(main.includes('.onboarding-body { min-height: 0; overflow-y: auto;'));
assert(ocean.includes('.modal-body { min-height: 0; overflow-y: auto;'));
const frames = new Map(), listeners = {}; let nextFrame = 0, draws = 0, disconnected = 0, observerCallback;
const canvas = { dataset: { weather: 'rain' }, getContext: () => ({}) };
const c = {
  dailyOutlookAnimationState: { frame: 0, scenes: [], observer: null, reducedMotion: false },
  document: { hidden: false, addEventListener: (name, callback) => { listeners[name] = callback; } },
  window: { IntersectionObserver: true },
  IntersectionObserver: class { constructor(callback) { observerCallback = callback; } observe() {} disconnect() { disconnected++; } },
  requestAnimationFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id; },
  cancelAnimationFrame: id => frames.delete(id), els: { dailyStrip: { querySelectorAll: () => [canvas] } },
  dailyAnimationRandom: () => () => 0.5, dailyAnimationHash: () => 1,
  drawDailyAnimation: () => { draws++; }
};
vm.createContext(c);
for (const name of ['stopDailyOutlookAnimations', 'runDailyOutlookAnimations', 'startDailyOutlookAnimationLoop', 'initDailyOutlookAnimations']) vm.runInContext(extract(main, name), c);
c.initDailyOutlookAnimations();
assert.equal(c.dailyOutlookAnimationState.frame, 0, 'no continuous loop before tiles are visible');
observerCallback([{ target: canvas, isIntersecting: true }]);
assert(c.dailyOutlookAnimationState.frame > 0, 'visible tiles start loop');
c.runDailyOutlookAnimations(100); assert.equal(draws, 1);
observerCallback([{ target: canvas, isIntersecting: false }]); c.runDailyOutlookAnimations(200);
assert.equal(c.dailyOutlookAnimationState.frame, 0, 'no visible tiles stops loop'); assert.equal(draws, 1);
observerCallback([{ target: canvas, isIntersecting: true }]); assert(c.dailyOutlookAnimationState.frame > 0);
c.document.hidden = true; listeners.visibilitychange();
assert.equal(c.dailyOutlookAnimationState.frame, 0); assert.equal(disconnected, 0, 'temporary pause retains visibility observer');
c.document.hidden = false; listeners.visibilitychange(); assert(c.dailyOutlookAnimationState.frame > 0);
c.stopDailyOutlookAnimations(); assert.equal(disconnected, 1); assert.equal(c.dailyOutlookAnimationState.scenes.length, 0);
c.dailyOutlookAnimationState.reducedMotion = true; c.dailyOutlookAnimationState.scenes = [{ visible: true }];
c.startDailyOutlookAnimationLoop(); assert.equal(c.dailyOutlookAnimationState.frame, 0);
console.log('iPhone UI checks passed: popup scroll locks/restore, overlapping popups, pinned-header structure, offscreen animation pause/resume, tab visibility, observer cleanup, and reduced motion. No API requests.');
