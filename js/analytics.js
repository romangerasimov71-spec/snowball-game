/*
 * Game analytics: a small module that sends the game's own events through the Playgama Bridge
 * analytics module (bridge.analytics.send). No other transport, no personal data, no own session id:
 * sessions, play time, ads and purchases are recorded by the Bridge itself and are not repeated here.
 * Without the Bridge (or without its analytics module) every call silently does nothing.
 *
 * Portable: nothing in here knows the game. The game says what happened:
 *   GameAnalytics.init(bridge, { gameVersion: '1.0.0', targetFps: 60 })
 *   GameAnalytics.ready()                       - the game is playable (call next to game_ready)
 *   GameAnalytics.event('progression_started', { level_id: '3', step_index: 3 })
 *   GameAnalytics.once('tutorial_completed')    - at most once per page load
 *   GameAnalytics.frame(timestampMs, active)    - every animation frame; active = visible gameplay
 * first_input (the player's first tap / click / key after ready()) and performance_sample (one
 * aggregated sample per ~30 s of active visible gameplay) are sent by the module itself.
 * The list of events and their fields: docs/analytics.md (copied from ornament-sort, the studio template).
 */
(function () {
  'use strict';

  var SAMPLE_ACTIVE_MS = 30000;   // one performance_sample per ~30 s of active gameplay
  var GAP_MS = 10000;             // a longer gap between two frames is a background gap, not a frozen frame

  var bridge = null;
  var opts = { gameVersion: '', targetFps: 60 };
  var sentOnce = {};
  var readyAt = -1;
  var firstInputDone = false;

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function r1(v) { return Math.round(v * 10) / 10; }

  function transport() {
    try {
      var a = bridge && bridge.analytics;
      return a && typeof a.send === 'function' ? a : null;
    } catch (e) { return null; }
  }

  // flat object with short strings, finite numbers and booleans only
  function clean(data) {
    var out = {};
    if (!data || typeof data !== 'object') return out;
    Object.keys(data).forEach(function (k) {
      var v = data[k];
      if (typeof v === 'string') out[k] = v.slice(0, 40);
      else if (typeof v === 'number' && isFinite(v)) out[k] = v;
      else if (typeof v === 'boolean') out[k] = v;
    });
    return out;
  }

  function event(name, data) {
    var a = transport();
    if (!a || typeof name !== 'string' || !name) return false;
    try { a.send(name, clean(data)); return true; } catch (e) { return false; }
  }

  function once(name, data) {
    if (sentOnce[name]) return false;
    sentOnce[name] = true;
    return event(name, data);
  }

  // ---------------------------------------------------------------- first_input
  function onFirstInput(kind) {
    if (firstInputDone || readyAt < 0) return;
    firstInputDone = true;
    var t = now();
    event('first_input', {
      input: kind,
      seconds: r1(t / 1000),                       // from the start of the page
      seconds_since_ready: r1((t - readyAt) / 1000)  // from the moment the game could be played
    });
  }
  function bindFirstInput() {
    window.addEventListener('pointerdown', function (e) {
      onFirstInput(e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'mouse');
    }, true);
    window.addEventListener('keydown', function () { onFirstInput('keyboard'); }, true);
  }

  // ---------------------------------------------------------------- performance_sample
  var perf = null, lastTs = 0, counters = { errors: 0, rejections: 0, lt: 0, ltTotal: 0, ltMax: 0 };
  var longTasks = false;

  function newWindow() {
    perf = { start: 0, active: 0, times: [] };
    counters.errors = 0; counters.rejections = 0;
    counters.lt = 0; counters.ltTotal = 0; counters.ltMax = 0;
  }
  function pct(sorted, p) {
    if (!sorted.length) return 0;
    var i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[i];
  }
  function flushSample() {
    var ts = perf.times, s = ts.slice().sort(function (a, b) { return a - b; });
    var over = function (ms) { var n = 0; for (var i = 0; i < ts.length; i++) if (ts[i] > ms) n++; return n; };
    var data = {
      target_fps: opts.targetFps,
      window_ms: Math.round(now() - perf.start),
      active_ms: Math.round(perf.active),
      frame_count: ts.length,
      fps_avg: r1(ts.length * 1000 / Math.max(1, perf.active)),
      fps_p10: r1(1000 / Math.max(0.1, pct(s, 0.9))),   // 10th percentile of per-frame fps
      frame_time_p50_ms: r1(pct(s, 0.5)),
      frame_time_p95_ms: r1(pct(s, 0.95)),
      frame_time_p99_ms: r1(pct(s, 0.99)),
      frame_time_max_ms: r1(s[s.length - 1] || 0),
      frames_over_50ms: over(50),
      frames_over_100ms: over(100),
      frames_over_250ms: over(250),
      frames_over_500ms: over(500),
      frames_over_1000ms: over(1000),
      js_error_count: counters.errors,
      unhandled_rejection_count: counters.rejections
    };
    if (longTasks) {
      data.long_task_count = counters.lt;
      data.long_task_total_ms = Math.round(counters.ltTotal);
      data.long_task_max_ms = Math.round(counters.ltMax);
    }
    if (opts.gameVersion) data.game_version = opts.gameVersion;
    event('performance_sample', data);
    newWindow();
  }

  // ts: the requestAnimationFrame timestamp; active: visible gameplay (no pause, no menu, no ad)
  function frame(ts, active) {
    if (!perf) return;
    if (!active || document.hidden) { lastTs = 0; return; }
    if (!perf.start) perf.start = now();
    if (lastTs) {
      var dt = ts - lastTs;
      if (dt > 0 && dt < GAP_MS) { perf.times.push(dt); perf.active += dt; }
    }
    lastTs = ts;
    if (perf.active >= SAMPLE_ACTIVE_MS) flushSample();
  }

  function bindPerf() {
    newWindow();
    document.addEventListener('visibilitychange', function () { lastTs = 0; });
    window.addEventListener('error', function () { counters.errors++; });
    window.addEventListener('unhandledrejection', function () { counters.rejections++; });
    try {
      if (window.PerformanceObserver && (PerformanceObserver.supportedEntryTypes || []).indexOf('longtask') >= 0) {
        new PerformanceObserver(function (list) {
          list.getEntries().forEach(function (e) {
            counters.lt++; counters.ltTotal += e.duration; counters.ltMax = Math.max(counters.ltMax, e.duration);
          });
        }).observe({ entryTypes: ['longtask'] });
        longTasks = true;
      }
    } catch (e) { longTasks = false; }
  }

  window.GameAnalytics = {
    init: function (b, o) {
      bridge = b || null;
      if (o) {
        if (o.gameVersion) opts.gameVersion = String(o.gameVersion);
        if (o.targetFps) opts.targetFps = o.targetFps;
      }
      if (!transport()) return false;   // nothing to send through: stay silent
      bindFirstInput();
      bindPerf();
      return true;
    },
    ready: function () { if (readyAt < 0) readyAt = now(); },
    event: event,
    once: once,
    frame: frame
  };
})();
