(() => {
'use strict';

// ---------- Константы и данные ----------
const BASE_W = 480, BASE_H = 820, MAX_LANE = 720;
const MIN_R = 9;          // меньше — ком растаял/разбился
const START_R = 20;       // 20 единиц = 40 см в диаметре
const SMASH_K = 0.92;     // ком сносит объекты, если r >= size * SMASH_K

const SKINS = [
  { id: 'classic', price: 0,    base: '#ffffff', shade: '#a9c8ea', spot: '#d7e7f7' },
  { id: 'ice',     price: 150,  base: '#d9f4ff', shade: '#5fb4e8', spot: '#9fe0ff' },
  { id: 'candy',   price: 300,  base: '#ffffff', shade: '#e6a6b4', spot: '#e8324a', stripes: true },
  { id: 'mint',    price: 450,  base: '#e8fff4', shade: '#7fd6b0', spot: '#3fbf8a', stripes: true },
  { id: 'night',   price: 700,  base: '#3a4f9a', shade: '#16204a', spot: '#ffe680', stars: true },
  { id: 'fire',    price: 1000, base: '#ffd27a', shade: '#e8542a', spot: '#ff8c1a' },
  { id: 'gold',    price: 1600, base: '#ffe680', shade: '#c98a12', spot: '#fff6c2' },
  { id: 'rainbow', price: 2500, base: '#ffffff', shade: '#b9a6e8', spot: '#ff5a5a', rainbow: true },
];

const UPGRADES = [
  { id: 'size',   max: 5, cost: l => 100 + l * 150, icon: '⬤' },
  { id: 'magnet', max: 5, cost: l => 120 + l * 160, icon: '🧲' },
  { id: 'shield', max: 5, cost: l => 120 + l * 160, icon: '🛡' },
  { id: 'coin',   max: 5, cost: l => 200 + l * 250, icon: '●' },
];

let save = {
  coins: 0, best: 0, skin: 'classic', owned: ['classic'],
  up: { size: 0, magnet: 0, shield: 0, coin: 0 },
  sound: true, music: true, daily: '', games: 0, hinted: false,
  level: 1, stars: {},
};

// Параметры уровня. Цели по размеру подобраны симуляцией бота (см. README).
function levelCfg(n) {
  const dur = Math.min(38 + n * 2, 70);              // секунды до финиша
  const speed = Math.min(300 + n * 6, 430);          // экранная скорость
  const hard = clamp(n / 25, 0, 1);
  const grow2 = 3.5 + Math.min(n, 30) * 0.17;        // во сколько раз вырасти для 2 звёзд
  const grow3 = 7 + Math.min(n, 30) * 0.35;          // ... для 3 звёзд
  return {
    n, dur, speed, hard, len: dur * speed,
    boss: n % 5 === 0,
    r2: START_R * grow2, r3: START_R * grow3,
    bossR: START_R * grow2 / SMASH_K,                // крепость: нужен размер как на 2 звезды
  };
}

// ---------- Canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let dpr = 1, scale = 1, W = BASE_W, H = BASE_H, FW = BASE_W, OX = 0, BALL_SY = 250;
let side = [];

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = window.innerWidth, ch = window.innerHeight;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  scale = Math.min(cw / BASE_W, ch / BASE_H);
  FW = cw / scale; H = ch / scale;
  W = Math.min(FW, MAX_LANE); OX = (FW - W) / 2;
  BALL_SY = H * 0.3;
  side = Array.from({ length: OX > 10 ? 30 : 0 }, () => ({ f: Math.random(), y: rand(-50, H + 100), s: rand(30, 60), left: Math.random() < 0.5 }));
}
window.addEventListener('resize', resize);

// ---------- Утилиты ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = arr => arr[(Math.random() * arr.length) | 0];
const $ = id => document.getElementById(id);
resize();

// Размер кома в метрах (диаметр): r=20 → 0.4 м
const meters = r => {
  const m = r * 2 / 100;
  return (m < 10 ? m.toFixed(1) : Math.round(m)) + ' ' + t('m');
};

// ---------- Состояние игры ----------
const S = {
  mode: 'menu',     // menu | shop | play | pause | revive | over | win
  run: 'level',     // level | endless
  cfg: levelCfg(1),
  t: 0, dist: 0, speed: 0, score: 0, coins: 0, z: 1,
  combo: 0, comboT: 0, shake: 0, flash: 0, maxR: START_R,
  revived: false, deathReason: 'melt', nextSpawn: 0, finishSpawned: false,
  reward: 0, doubled: false,
};
// Мировые координаты: x от центра трассы, y относительно кома (ком всегда в y=0).
const ball = { x: 0, y: 0, r: START_R, vx: 0, rot: 0, tilt: 0, inv: 0, magnet: 0, shield: 0, targetX: 0 };
let objs = [], parts = [], texts = [], trail = [], bumps = [];
const flakes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: rand(1, 3.2), v: rand(0.3, 1) }));

const halfW = () => W / 2 / S.z;               // половина ширины трассы в мире
const w2s = (x, y) => [W / 2 + x * S.z, BALL_SY + y * S.z];

// ---------- Ввод ----------
const keys = {};
let pointerDown = false, lastPX = 0;
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (S.mode === 'play') pauseGame(); else if (S.mode === 'pause') resumeGame();
  }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('pointerdown', e => {
  pointerDown = true; lastPX = e.clientX;
  Sfx.init(); Sfx.resume();
});
window.addEventListener('pointermove', e => {
  if (!pointerDown || S.mode !== 'play') return;
  const dx = (e.clientX - lastPX) / scale;
  lastPX = e.clientX;
  ball.targetX += dx * 1.25 / S.z;
});
window.addEventListener('pointerup', () => { pointerDown = false; });
window.addEventListener('pointercancel', () => { pointerDown = false; });
document.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('visibilitychange', () => {
  Sfx.setHidden(document.hidden);
  if (document.hidden && S.mode === 'play') pauseGame();
});

function persist() { YSDK.save(save); }

// ---------- Сообщения и частицы (в экранных координатах трассы) ----------
let toastTimer;
function toast(msg, ms = 2200) {
  const el = $('toast');
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
}

function floatText(wx, wy, str, color = '#fff', size = 26) {
  const [x, y] = w2s(wx, wy);
  texts.push({ x, y, str, color, size, life: 1 });
}

function burst(wx, wy, n, color, spd = 260, size = [3, 7], k = 1) {
  const [x, y] = w2s(wx, wy);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = rand(spd * 0.3, spd) * k;
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80 * k, r: rand(size[0], size[1]) * Math.sqrt(k), color, life: rand(0.5, 1), g: 500 });
  }
}

// ---------- Спавн ----------
const CR = { tree: 0.5, rock: 0.75, snowman: 0.6, sled: 0.8, skier: 0.45, house: 0.85, tower: 0.6, fire: 0.7, snow: 0.8, coin: 1, magnet: 1, shield: 1 };

function freeSpot(x, y, r) {
  const gap = 30 / S.z;
  for (const o of objs) {
    if (o.type === 'finish' || o.type === 'castle') continue;
    const dx = o.x - x, dy = o.y - y;
    if (dx * dx + dy * dy < (o.r + r + gap) ** 2) return false;
  }
  return true;
}

function add(type, x, y, size, extra = {}) {
  const cr = (CR[type] || 1) * size;
  if (!freeSpot(x, y, cr)) return null;
  const o = { type, x, y, size, r: cr, dead: false, seed: Math.random(), ...extra };
  if (type === 'house') o.color = pick(['#b5523b', '#c9a227', '#6b8fb5', '#8a5a3c', '#5f9e6e']);
  if (type === 'sled' || type === 'skier') {
    // Снегоходы и лыжники едут поперёк склона; скорость пропорциональна размеру
    o.color = pick(['#e8324a', '#2a7fd4', '#f0a01e', '#3fbf8a', '#7d4bd4']);
    o.jacket = pick(['#2a3a5a', '#e8324a', '#f0a01e', '#3fbf8a', '#ffffff']);
    o.dir = Math.random() < 0.5 ? -1 : 1;
    o.vx = o.dir * size * (type === 'skier' ? rand(1.8, 2.6) : rand(1.2, 2.0));
    o.wheel = 0;
  }
  objs.push(o);
  return o;
}

function hardness() {
  return S.run === 'level' ? S.cfg.hard : clamp(S.t / 120, 0, 1);
}

function obstacleSize() {
  // Часть препятствий меньше кома (можно снести), часть — больше (объезжай).
  const h = hardness();
  const k = Math.random() < 0.6 - h * 0.15 ? rand(0.45, 0.95) : rand(1.15, 1.7 + h * 0.3);
  return Math.max(10, ball.r * k);
}

// Мир «взрослеет» вместе с комом: ёлки → машины → дома → башни.
function typeFor(s) {
  if (s < 30) return pick(['tree', 'tree', 'rock', 'snowman', 'skier']);
  if (s < 70) return pick(['tree', 'snowman', 'rock', 'sled', 'skier']);
  if (s < 160) return pick(['sled', 'house', 'tree', 'house', 'snowman']);
  if (s < 400) return pick(['house', 'house', 'tower', 'tree', 'sled']);
  return pick(['tower', 'house', 'tree', 'tower']);
}

function spawnRow() {
  const z = S.z, hw = halfW(), m = 40 / z;
  const y = (H - BALL_SY + 120) / z;
  const rx = () => rand(-hw + m, hw - m);
  const h = hardness();
  const roll = Math.random();

  if (roll < 0.30) {
    const n = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) add('snow', rx(), y + rand(0, 80) / z, rand(14, 22) / z);
  } else if (roll < 0.50) {
    const x = rand(-hw + m * 2, hw - m * 2);
    const curve = rand(-1, 1) * 60 / z;
    for (let i = 0; i < 6; i++) add('coin', x + Math.sin(i / 5 * Math.PI) * curve, y + i * 50 / z, 17 / z);
  } else if (roll < 0.88) {
    const n = 1 + (Math.random() < 0.35 + h * 0.4 ? 1 : 0) + (Math.random() < h * 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const s = obstacleSize();
      const type = typeFor(s);
      add(type, rx(), y + rand(0, 100) / z, type === 'rock' ? s * 0.85 : s);
    }
    if (Math.random() < 0.5) add('snow', rx(), y + rand(120, 180) / z, rand(14, 20) / z);
    if (Math.random() < 0.4) add('coin', rx(), y + rand(-40, 160) / z, 17 / z);
  } else if (roll < 0.95) {
    if (S.t > 12) add('fire', rx(), y, rand(26, 34) / z);
    else add('snow', rx(), y, 18 / z);
  } else {
    add(Math.random() < 0.5 ? 'magnet' : 'shield', rx(), y, 18 / z);
  }
  S.nextSpawn = rand(110, 170) - h * 30;
}

// ---------- Управление забегом ----------
function startRun(run, level) {
  Sfx.init(); Sfx.resume();
  S.run = run;
  if (run === 'level') S.cfg = levelCfg(level || save.level);
  objs = []; parts = []; texts = []; trail = [];
  bumps = Array.from({ length: 26 }, () => ({ x: rand(0, W), y: rand(0, H + 200), s: rand(10, 30) }));
  Object.assign(S, {
    t: 0, dist: 0, speed: 300, score: 0, coins: 0, z: 1, combo: 0, comboT: 0, shake: 0, flash: 0,
    revived: false, nextSpawn: 200, finishSpawned: false, reward: 0, doubled: false,
  });
  const r0 = START_R + save.up.size * 3;
  Object.assign(ball, { x: 0, targetX: 0, r: r0, vx: 0, rot: 0, tilt: 0, inv: 1, magnet: 0, shield: 0 });
  S.maxR = r0;
  for (let i = 0; i < 4; i++) add('snow', rand(-80, 80), (H * 0.3 + i * 140), 18);
  setMode('play');
  $('hudLevel').textContent = run === 'level' ? t('levelN', { n: S.cfg.n }) : '';
  if (!save.hinted) {
    save.hinted = true; persist();
    toast(t('hint'), 4500);
  } else if (run === 'level' && S.cfg.boss) {
    toast(t('bossLevel', { s: meters(S.cfg.bossR * SMASH_K) }), 3000);
  }
}

function setMode(m) {
  S.mode = m;
  ['menu', 'shop', 'pause', 'revive', 'over', 'win'].forEach(id => $(id).classList.toggle('show', id === m));
  $('hud').classList.toggle('show', m === 'play' || m === 'pause' || m === 'revive');
  $('hud').classList.toggle('endless', S.run === 'endless');
  if (m === 'play') YSDK.gameplayStart(); else YSDK.gameplayStop();
  if (m === 'menu' || m === 'over' || m === 'shop' || m === 'win') YSDK.showBanner(); else YSDK.hideBanner();
  if (m === 'menu') { S.z = 1; }
}

function pauseGame() { if (S.mode === 'play') setMode('pause'); }
function resumeGame() { if (S.mode === 'pause') { setMode('play'); last = performance.now(); } }

YSDK.onPause = paused => {
  if (paused) { Sfx.setAdMute(true); pauseGame(); } else Sfx.setAdMute(false);
};

function die(reason) {
  if (S.mode !== 'play') return;
  S.deathReason = reason;
  Sfx.over();
  S.shake = 18;
  burst(ball.x, ball.y, 40, '#fff', 420, [3, 9]);
  const progressed = S.run === 'level' ? S.dist > S.cfg.len * 0.25 : S.score > 150;
  if (!S.revived && reason !== 'boss' && progressed) showRevive();
  else finishRun();
}

let reviveInt;
function showRevive() {
  setMode('revive');
  $('reviveTitle').textContent = S.deathReason === 'melt' ? t('gameOver') : t('crashed');
  let n = 5;
  $('reviveTimer').textContent = n;
  clearInterval(reviveInt);
  reviveInt = setInterval(() => {
    n--;
    $('reviveTimer').textContent = n;
    if (n <= 0) { clearInterval(reviveInt); if (S.mode === 'revive') finishRun(); }
  }, 1000);
}

async function doRevive() {
  clearInterval(reviveInt);
  const ok = await YSDK.showRewarded();
  if (!ok) { toast(t('adFail')); finishRun(); return; }
  S.revived = true;
  ball.r = Math.max(START_R + 6, S.maxR * 0.6);
  ball.inv = 2.5;
  objs = objs.filter(o => o.y * S.z > 450 || o.type === 'coin' || o.type === 'snow' || o.type === 'finish' || o.type === 'castle');
  setMode('play');
  last = performance.now();
}

// Забег окончен неудачей (или выход в меню).
function finishRun() {
  clearInterval(reviveInt);
  save.coins += S.coins;
  save.games++;
  const score = Math.floor(S.score);
  let isBest = false;
  if (S.run === 'endless') {
    isBest = score > save.best;
    if (isBest) save.best = score;
    YSDK.submitScore(save.best);
  }
  persist();
  let title = S.deathReason === 'melt' ? t('gameOver') : S.deathReason === 'boss' ? t('bossFail') : t('crashed');
  if (isBest && score > 0) title = t('newBest');
  $('overTitle').textContent = title;
  $('overScoreRow').style.display = S.run === 'endless' ? '' : 'none';
  $('overBestRow').style.display = S.run === 'endless' ? '' : 'none';
  $('overSizeRow').style.display = S.run === 'level' ? '' : 'none';
  $('overScore').textContent = score;
  $('overBest').textContent = save.best;
  $('overSize').textContent = meters(S.maxR);
  $('overCoins').textContent = S.coins;
  $('doubleBtn').style.display = S.coins >= 5 ? '' : 'none';
  $('doubleBtn').disabled = false;
  S.reward = S.coins;
  setMode('over');
}

// Уровень пройден.
function levelComplete(bossWin) {
  const c = S.cfg, r = ball.r;
  const stars = 1 + (r >= c.r2 ? 1 : 0) + (r >= c.r3 ? 1 : 0);
  const reward = 20 + c.n * 5 + stars * 10 + (bossWin ? 100 : 0);
  S.reward = reward + S.coins;
  save.coins += S.reward;
  save.stars[c.n] = Math.max(save.stars[c.n] || 0, stars);
  if (c.n >= save.level) save.level = c.n + 1;
  save.games++;
  persist();
  Sfx.win();
  $('winTitle').textContent = bossWin ? t('bossWin') : t('levelDone', { n: c.n });
  $('winSize').textContent = meters(r);
  $('winCoins').textContent = S.reward;
  const st = $('winStars').children;
  for (let i = 0; i < 3; i++) {
    st[i].className = '';
    if (i < stars) setTimeout(() => { st[i].className = 'on'; Sfx.coin(); }, 300 + i * 350);
  }
  $('winNext').textContent = t('levelN', { n: save.level });
  $('winDouble').style.display = '';
  $('winDouble').disabled = false;
  setMode('win');
}

// ---------- Столкновения ----------
function smash(o, bonus = 1) {
  o.dead = true;
  S.combo = S.comboT > 0 ? S.combo + 1 : 1;
  S.comboT = 2.2;
  const mult = Math.min(S.combo, 10);
  // Очки растут с «масштабом» объекта: снести дом ценнее, чем ёлку
  const rel = o.size / START_R;
  const pts = Math.round(10 * Math.sqrt(rel) * (o.type === 'snowman' ? 1.6 : 1) * mult * bonus);
  S.score += pts;
  ball.r += o.size * 0.035;
  const k = clamp(o.size * S.z / 30, 0.7, 3);
  Sfx.smash(k > 1.3);
  S.shake = Math.max(S.shake, 4 + k * 3);
  const col = { tree: '#2f7d4f', rock: '#7d8796', sled: o.color, skier: o.jacket, house: o.color, tower: '#8a8f9c', snowman: '#fff' }[o.type] || '#fff';
  burst(o.x, o.y, 14, col, 300, [3, 7], k);
  burst(o.x, o.y, 12, '#fff', 260, [3, 7], k);
  if (o.type === 'house') burst(o.x, o.y, 8, '#6b4325', 280, [3, 6], k);
  floatText(o.x, o.y - o.size * 0.5, '+' + pts, '#ffd34d', 24 + Math.min(mult, 6) * 2);
  if (S.combo >= 3) floatText(ball.x, -ball.r - 30 / S.z, t('combo', { n: mult }), '#7fe0ff', 26);
  if (o.type === 'snowman' || o.type === 'house') {
    const c = o.type === 'house' ? 5 : 3;
    S.coins += c; floatText(o.x + 20 / S.z, o.y, '+' + c + ' ●', '#ffd34d');
  }
}

function hitObstacle(o) {
  if (ball.shield > 0 || ball.r >= o.size * SMASH_K) { smash(o); return; }
  if (ball.inv > 0) return;
  Sfx.hit();
  S.shake = 16; S.flash = 0.35;
  S.combo = 0;
  burst(ball.x, ball.y, 22, '#fff', 340);
  ball.r *= 0.62;
  ball.inv = 1.2;
  const push = ball.x < o.x ? -1 : 1;
  ball.targetX = ball.x + push * (o.r + ball.r + 40 / S.z);
  ball.vx = push * 600 / S.z;
  if (ball.r < MIN_R) die('crash');
}

// ---------- Обновление ----------
function update(dt) {
  S.t += dt;
  const base = S.run === 'level' ? S.cfg.speed : 300 + clamp(S.t / 90, 0, 1) * 280;
  S.speed = base + Math.min(S.t, 120) * 1.0;
  const sdy = S.speed * dt;          // экранное смещение
  const z = S.z, wdy = sdy / z;      // мировое смещение
  S.dist += sdy;
  S.score += sdy * 0.02;
  const h = hardness();

  // Управление
  const hw = halfW();
  const kdir = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
  if (kdir) ball.targetX += kdir * 620 / z * dt;
  const lim = Math.max(0, hw - ball.r);
  ball.targetX = clamp(ball.targetX, -lim, lim);
  const prevX = ball.x;
  ball.x += (ball.targetX - ball.x) * Math.min(1, dt * 14) + ball.vx * dt;
  ball.vx *= Math.pow(0.02, dt);
  ball.x = clamp(ball.x, -lim, lim);
  ball.rot += wdy / ball.r;
  ball.tilt = clamp((ball.x - prevX) * z / dt / 900, -0.35, 0.35);

  // Таяние: ком постоянно уменьшается, нужно собирать снег
  ball.r -= (0.3 + ball.r * (0.011 + h * 0.006)) * dt;
  if (ball.r < MIN_R) { die('melt'); return; }
  S.maxR = Math.max(S.maxR, ball.r);

  // Камера отдаляется по мере роста кома
  const zt = Math.min(1, Math.pow(24 / ball.r, 0.7));
  S.z += (zt - S.z) * Math.min(1, dt * 1.5);

  ball.inv = Math.max(0, ball.inv - dt);
  ball.magnet = Math.max(0, ball.magnet - dt);
  ball.shield = Math.max(0, ball.shield - dt);
  S.comboT -= dt;
  S.shake = Math.max(0, S.shake - dt * 40);
  S.flash = Math.max(0, S.flash - dt);

  // След
  for (const p of trail) p.y -= wdy;
  trail.push({ x: ball.x, y: 0, r: ball.r });
  while (trail.length && trail[0].y * S.z < -BALL_SY - 100) trail.shift();
  scrollDecor(sdy);

  // Спавн и финиш
  const remaining = S.run === 'level' ? S.cfg.len - S.dist : Infinity;
  const ahead = H - BALL_SY + 150;
  if (remaining > ahead + 250) {
    S.nextSpawn -= sdy;
    if (S.nextSpawn <= 0) spawnRow();
  } else if (!S.finishSpawned && remaining <= ahead) {
    S.finishSpawned = true;
    objs.push({ type: S.cfg.boss ? 'castle' : 'finish', x: 0, y: ahead / S.z, size: S.cfg.bossR, r: 0, dead: false, seed: 0 });
  }

  // Объекты
  const magR = (200 + ball.r * 2 * S.z) / S.z;
  for (const o of objs) {
    o.y -= wdy;
    if (o.vx) moveMover(o, dt);
    if (o.dead) continue;
    if (o.type === 'finish' || o.type === 'castle') {
      if (o.y <= ball.r * 0.5) {
        if (o.type === 'finish') { levelComplete(false); return; }
        if (ball.r >= o.size * SMASH_K || ball.shield > 0) {
          o.dead = true;
          S.shake = 30;
          for (let i = -2; i <= 2; i++) burst(i * halfW() * 0.35, 0, 18, i % 2 ? '#bfe6ff' : '#fff', 500, [4, 10], 2);
          Sfx.smash(true);
          levelComplete(true);
          return;
        }
        die('boss');
        return;
      }
      continue;
    }
    const isPick = o.type === 'snow' || o.type === 'coin';
    if (ball.magnet > 0 && isPick) {
      const mx = ball.x - o.x, my = -o.y, md = Math.hypot(mx, my);
      if (md < magR && md > 1) { o.x += mx / md * 700 / z * dt; o.y += my / md * 700 / z * dt; }
    }
    const dx = o.x - ball.x, dy2 = o.y;
    const dist = Math.hypot(dx, dy2);
    if (o.type === 'fire') {
      if (dist < ball.r + o.r * 1.4) {
        if (ball.shield <= 0) {
          ball.r -= (12 + ball.r * 0.25) * dt;
          if (Math.random() < 0.5) {
            const [sx, sy] = w2s(ball.x + rand(-ball.r, ball.r) * 0.6, -ball.r * 0.5);
            parts.push({ x: sx, y: sy, vx: rand(-30, 30), vy: rand(-160, -90), r: rand(5, 10), color: 'rgba(230,240,255,0.7)', life: 0.6, g: -40 });
          }
          if (Math.random() < 0.1) Sfx.sizzle();
          if (ball.r < MIN_R) { die('melt'); return; }
        } else { o.dead = true; burst(o.x, o.y, 16, '#ff9a3c', 260); Sfx.smash(false); }
      }
      continue;
    }
    if (dist > ball.r + o.r) continue;
    switch (o.type) {
      case 'snow':
        o.dead = true;
        ball.r += 1.2 + ball.r * 0.028;
        S.score += 10;
        Sfx.snow();
        burst(o.x, o.y, 8, '#fff', 160, [2, 5]);
        break;
      case 'coin': {
        o.dead = true;
        const v = 1 + save.up.coin;
        S.coins += v;
        Sfx.coin();
        floatText(o.x, o.y - 10 / z, '+' + v, '#ffd34d', 22);
        burst(o.x, o.y, 6, '#ffd34d', 150, [2, 4]);
        break;
      }
      case 'magnet':
        o.dead = true; ball.magnet = 6 + save.up.magnet * 2;
        Sfx.power(); floatText(o.x, o.y, t('magnet'), '#ff7070', 28); break;
      case 'shield':
        o.dead = true; ball.shield = 4 + save.up.shield * 1.2;
        Sfx.power(); floatText(o.x, o.y, t('shield'), '#7fd0ff', 28); break;
      default:
        hitObstacle(o);
    }
  }
  const minY = (-BALL_SY - 250) / S.z;
  objs = objs.filter(o => !o.dead && o.y > minY);

  updateParts(dt, sdy);
  updateHud();
}

function updateParts(dt, sdy) {
  for (const p of parts) {
    p.x += p.vx * dt; p.y += p.vy * dt - sdy * 0.6; p.vy += p.g * dt; p.life -= dt * 1.4;
  }
  parts = parts.filter(p => p.life > 0);
  for (const tx of texts) { tx.y -= 60 * dt; tx.life -= dt * 0.9; }
  texts = texts.filter(tx => tx.life > 0);
}

let hudCache = {};
function updateHud() {
  const sc = Math.floor(S.score);
  if (hudCache.s !== sc) { $('hudScore').textContent = sc; hudCache.s = sc; }
  if (hudCache.c !== S.coins) { $('hudCoins').textContent = '● ' + S.coins; hudCache.c = S.coins; }
  const m = meters(ball.r);
  if (hudCache.m !== m) { $('hudSize').textContent = m; hudCache.m = m; }
  if (S.run === 'level') {
    const pct = clamp(S.dist / S.cfg.len * 100, 0, 100).toFixed(1);
    if (hudCache.p !== pct) { $('hudProg').style.width = pct + '%'; hudCache.p = pct; }
    // Звёзды, которые уже «набраны» по размеру
    const st = 1 + (ball.r >= S.cfg.r2 ? 1 : 0) + (ball.r >= S.cfg.r3 ? 1 : 0);
    if (hudCache.st !== st) {
      [...$('hudStars').children].forEach((el, i) => el.classList.toggle('on', i < st));
      hudCache.st = st;
    }
  }
}

function moveMover(o, dt) {
  o.x += o.vx * dt;
  o.wheel += Math.abs(o.vx) * dt / (o.size * 0.2);
  const lim = halfW() - o.size;
  if ((o.x > lim && o.vx > 0) || (o.x < -lim && o.vx < 0)) { o.vx = -o.vx; o.dir = -o.dir; }
  // Снежная пыль из-под гусеницы / лыж
  if (Math.random() < dt * (o.type === 'sled' ? 10 : 5)) {
    const [sx, sy] = w2s(o.x - o.dir * o.size * 0.9, o.y + o.size * 0.1);
    parts.push({ x: sx, y: sy, vx: -o.dir * rand(20, 60), vy: rand(-50, -20), r: rand(3, 6) * Math.max(0.6, o.size * S.z / 40), color: 'rgba(255,255,255,0.85)', life: 0.6, g: 60 });
  }
}

function scrollDecor(dy) {
  for (const b of bumps) { b.y -= dy; if (b.y < -40) { b.y = H + rand(20, 200); b.x = rand(0, W); } }
  for (const t2 of side) { t2.y -= dy; if (t2.y < -80) { t2.y = H + rand(40, 160); t2.f = Math.random(); t2.s = rand(30, 60); } }
}

// ---------- Отрисовка ----------
function drawBackground() {
  // Чем больше ком, тем холоднее и «выше» становится небо/снег
  const g = ctx.createLinearGradient(0, 0, 0, H);
  const deep = clamp(1 - S.z, 0, 0.9);
  g.addColorStop(0, `rgb(${233 - deep * 25 | 0},${243 - deep * 15 | 0},255)`);
  g.addColorStop(1, `rgb(${207 - deep * 30 | 0},${226 - deep * 20 | 0},${247 - deep * 5 | 0})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(160,190,225,0.35)';
  for (const b of bumps) {
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.s, b.s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const edge = ctx.createLinearGradient(0, 0, 50, 0);
  edge.addColorStop(0, 'rgba(120,160,210,0.35)'); edge.addColorStop(1, 'rgba(120,160,210,0)');
  ctx.fillStyle = edge; ctx.fillRect(0, 0, 50, H);
  const edge2 = ctx.createLinearGradient(W, 0, W - 50, 0);
  edge2.addColorStop(0, 'rgba(120,160,210,0.35)'); edge2.addColorStop(1, 'rgba(120,160,210,0)');
  ctx.fillStyle = edge2; ctx.fillRect(W - 50, 0, 50, H);
}

function drawSides() {
  ctx.fillStyle = '#b9d0ea';
  ctx.fillRect(0, 0, FW, H);
  const list = side.slice().sort((a, b) => a.y - b.y);
  for (const t2 of list) {
    const x = t2.left ? t2.f * (OX - 10) : OX + W + 10 + t2.f * (OX - 10);
    drawTree({ x, y: t2.y, size: t2.s, r: 0, seed: 0, deco: true });
  }
}

function drawTrail() {
  if (trail.length < 2) return;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(170,198,232,0.35)';
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i];
    ctx.lineWidth = b.r * 1.2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
}

function shadow(x, y, rx, ry) {
  ctx.fillStyle = 'rgba(60,90,140,0.22)';
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}

function dangerMark(o) {
  // Подсказка: красное кольцо у того, что нельзя снести
  if (S.mode === 'menu' || S.mode === 'shop' || o.deco) return;
  const big = ball.shield <= 0 && ball.r < o.size * SMASH_K;
  ctx.strokeStyle = big ? 'rgba(230,60,60,0.55)' : 'rgba(60,200,110,0.45)';
  ctx.lineWidth = 3 / S.z;
  ctx.beginPath(); ctx.ellipse(o.x, o.y + o.r * 0.2, o.r * 1.3, o.r * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
}

function drawTree(o) {
  const s = o.size;
  shadow(o.x + s * 0.2, o.y + s * 0.15, s * 0.8, s * 0.28);
  dangerMark(o);
  ctx.fillStyle = '#6b4325';
  ctx.fillRect(o.x - s * 0.12, o.y - s * 0.4, s * 0.24, s * 0.5);
  const layers = 3;
  for (let i = 0; i < layers; i++) {
    const w = s * (1 - i * 0.22), base = o.y - s * 0.3 - i * s * 0.55, h = s * 0.9;
    ctx.fillStyle = i % 2 ? '#2f7d4f' : '#286b44';
    ctx.beginPath(); ctx.moveTo(o.x - w, base); ctx.lineTo(o.x, base - h); ctx.lineTo(o.x + w, base); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(o.x - w * 0.45, base - h * 0.55); ctx.lineTo(o.x, base - h); ctx.lineTo(o.x + w * 0.45, base - h * 0.55);
    ctx.quadraticCurveTo(o.x + w * 0.2, base - h * 0.45, o.x, base - h * 0.52);
    ctx.quadraticCurveTo(o.x - w * 0.2, base - h * 0.45, o.x - w * 0.45, base - h * 0.55);
    ctx.fill();
  }
}

function drawRock(o) {
  const s = o.size;
  shadow(o.x + s * 0.15, o.y + s * 0.25, s * 0.95, s * 0.35);
  dangerMark(o);
  ctx.fillStyle = '#7d8796';
  ctx.beginPath();
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    const rr = s * (0.85 + Math.sin(i * 2.3 + o.seed * 10) * 0.12);
    ctx.lineTo(o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr * 0.9);
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5f6876';
  ctx.beginPath(); ctx.moveTo(o.x + s * 0.1, o.y); ctx.lineTo(o.x + s * 0.85, o.y); ctx.lineTo(o.x + s * 0.6, o.y - s * 0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(o.x - s * 0.1, o.y - s * 0.7, s * 0.5, s * 0.18, -0.1, 0, Math.PI * 2); ctx.fill();
}

function drawSnowman(o) {
  const s = o.size;
  shadow(o.x + s * 0.15, o.y + s * 0.3, s * 0.75, s * 0.25);
  dangerMark(o);
  const circ = (x, y, r) => {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#fff'); g.addColorStop(1, '#c4d8ef');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  circ(o.x, o.y, s * 0.6);
  circ(o.x, o.y - s * 0.8, s * 0.42);
  circ(o.x, o.y - s * 1.35, s * 0.3);
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(o.x - s * 0.1, o.y - s * 1.4, s * 0.04, 0, 7); ctx.arc(o.x + s * 0.1, o.y - s * 1.4, s * 0.04, 0, 7); ctx.fill();
  ctx.fillStyle = '#ff7a1a';
  ctx.beginPath(); ctx.moveTo(o.x, o.y - s * 1.34); ctx.lineTo(o.x + s * 0.3, o.y - s * 1.3); ctx.lineTo(o.x, o.y - s * 1.27); ctx.fill();
  ctx.fillStyle = '#d83a3a';
  ctx.fillRect(o.x - s * 0.32, o.y - s * 1.12, s * 0.64, s * 0.1);
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(o.x - s * 0.3, o.y - s * 1.62, s * 0.6, s * 0.08);
  ctx.fillRect(o.x - s * 0.2, o.y - s * 1.95, s * 0.4, s * 0.35);
}

function drawFire(o) {
  const s = o.size;
  ctx.fillStyle = 'rgba(255,170,60,0.18)';
  ctx.beginPath(); ctx.arc(o.x, o.y, s * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(120,170,230,0.5)';
  ctx.beginPath(); ctx.ellipse(o.x, o.y + s * 0.15, s * 1.1, s * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5a3418'; ctx.lineWidth = s * 0.22; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(o.x - s * 0.7, o.y + s * 0.15); ctx.lineTo(o.x + s * 0.7, o.y - s * 0.1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(o.x - s * 0.7, o.y - s * 0.1); ctx.lineTo(o.x + s * 0.7, o.y + s * 0.15); ctx.stroke();
  const tm = performance.now() / 1000;
  const flame = (k, col) => {
    const f = 1 + Math.sin(tm * 18 + o.seed * 9 + k) * 0.12;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(o.x - s * 0.5 * k, o.y);
    ctx.quadraticCurveTo(o.x - s * 0.55 * k, o.y - s * 0.8 * k * f, o.x, o.y - s * 1.4 * k * f);
    ctx.quadraticCurveTo(o.x + s * 0.55 * k, o.y - s * 0.8 * k * f, o.x + s * 0.5 * k, o.y);
    ctx.closePath(); ctx.fill();
  };
  flame(1, '#ff6a1a'); flame(0.7, '#ffb21a'); flame(0.4, '#fff1a0');
}

function drawSnowPile(o) {
  const s = o.size, tm = performance.now() / 1000;
  shadow(o.x, o.y + s * 0.3, s * 1.1, s * 0.3);
  const g = ctx.createRadialGradient(o.x - s * 0.3, o.y - s * 0.4, s * 0.1, o.x, o.y, s * 1.1);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#bcd6f2');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(o.x, o.y, s * 1.05, s * 0.6, 0, Math.PI, 0);
  ctx.ellipse(o.x, o.y, s * 1.05, s * 0.25, 0, 0, Math.PI);
  ctx.fill();
  // Искорка
  const sp = (Math.sin(tm * 5 + o.seed * 20) + 1) / 2;
  ctx.fillStyle = `rgba(120,200,255,${0.4 + sp * 0.6})`;
  star(o.x + s * 0.3, o.y - s * 0.35, 3 + sp * 4);
}

function star(x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, rr = i % 2 ? r * 0.35 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}

function drawCoin(o) {
  const tm = performance.now() / 1000;
  const w = Math.abs(Math.cos(tm * 4 + o.seed * 6));
  const s = o.size;
  shadow(o.x, o.y + s + 4, s * 0.8, s * 0.25);
  ctx.fillStyle = 'rgba(255,211,77,0.25)';
  ctx.beginPath(); ctx.arc(o.x, o.y, s * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c98a12';
  ctx.beginPath(); ctx.ellipse(o.x, o.y, s * Math.max(0.15, w), s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath(); ctx.ellipse(o.x, o.y, s * Math.max(0.1, w) * 0.78, s * 0.78, 0, 0, Math.PI * 2); ctx.fill();
  if (w > 0.4) { ctx.fillStyle = '#fff6c2'; star(o.x, o.y, s * 0.45 * w); }
}

function drawPower(o) {
  const tm = performance.now() / 1000, s = o.size;
  const bob = Math.sin(tm * 4 + o.seed * 6) * 5 / S.z;
  const col = o.type === 'magnet' ? '#ff5a5a' : '#4fb3ff';
  ctx.fillStyle = col + '44';
  ctx.beginPath(); ctx.arc(o.x, o.y + bob, s * 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(o.x, o.y + bob, s * 1.1, 0, Math.PI * 2); ctx.fill();
  if (o.type === 'magnet') {
    ctx.strokeStyle = '#e8324a'; ctx.lineWidth = s * 0.35; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(o.x, o.y + bob, s * 0.45, Math.PI, 0, true); ctx.stroke();
    ctx.strokeStyle = '#ccc';
    ctx.beginPath(); ctx.moveTo(o.x - s * 0.45, o.y + bob); ctx.lineTo(o.x - s * 0.45, o.y + bob - s * 0.3);
    ctx.moveTo(o.x + s * 0.45, o.y + bob); ctx.lineTo(o.x + s * 0.45, o.y + bob - s * 0.3); ctx.stroke();
  } else {
    ctx.fillStyle = '#4fb3ff';
    ctx.beginPath();
    ctx.moveTo(o.x, o.y + bob - s * 0.7); ctx.lineTo(o.x + s * 0.55, o.y + bob - s * 0.4);
    ctx.lineTo(o.x + s * 0.45, o.y + bob + s * 0.3); ctx.lineTo(o.x, o.y + bob + s * 0.7);
    ctx.lineTo(o.x - s * 0.45, o.y + bob + s * 0.3); ctx.lineTo(o.x - s * 0.55, o.y + bob - s * 0.4);
    ctx.closePath(); ctx.fill();
  }
}

// Отрисовка кома с данным скином (используется и в магазине).
function drawBallAt(c, x, y, r, rot, skinId, tilt = 0) {
  const sk = SKINS.find(s => s.id === skinId) || SKINS[0];
  c.save();
  c.translate(x, y);
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
  const g = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, sk.base); g.addColorStop(1, sk.shade);
  c.fillStyle = g;
  c.fillRect(-r, -r, r * 2, r * 2);
  // Узор на поверхности сдвигается — ощущение вращения
  if (sk.stripes || sk.rainbow) {
    const cols = sk.rainbow ? ['#ff5a5a', '#ffb21a', '#ffe14d', '#5fe07a', '#4fb3ff', '#9a6bff'] : [sk.spot];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const ph = ((rot * 0.5 + i / n * Math.PI * 2) % (Math.PI * 2));
      const yy = -Math.cos(ph) * r;
      if (Math.sin(ph) < 0) continue;
      const h = r * 0.28 * Math.sin(ph);
      c.fillStyle = cols[i % cols.length];
      c.globalAlpha = 0.85;
      c.fillRect(-r, yy - h / 2, r * 2, h);
    }
    c.globalAlpha = 1;
  } else {
    const spots = [[-0.4, 0], [0.35, 1.3], [0.05, 2.5], [-0.25, 3.7], [0.45, 4.9]];
    for (const [sx, p] of spots) {
      const ph = (rot * 0.5 + p) % (Math.PI * 2);
      if (Math.sin(ph) < 0.05) continue;
      const yy = -Math.cos(ph) * r * 0.9;
      const sz = r * (sk.stars ? 0.12 : 0.18) * Math.sin(ph);
      c.fillStyle = sk.spot;
      if (sk.stars) star(sx * r + tilt * r, yy, sz * 1.8);
      else { c.beginPath(); c.ellipse(sx * r + tilt * r, yy, sz, sz * Math.sin(ph) * 0.8 + 0.5, 0, 0, Math.PI * 2); c.fill(); }
    }
  }
  // Объёмная тень и блик
  const g2 = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.2, 0, 0, r * 1.05);
  g2.addColorStop(0, 'rgba(255,255,255,0.35)'); g2.addColorStop(0.6, 'rgba(255,255,255,0)'); g2.addColorStop(1, 'rgba(20,40,90,0.35)');
  c.fillStyle = g2; c.fillRect(-r, -r, r * 2, r * 2);
  c.restore();
}


// Снегоход с водителем, вид сбоку; смотрит по направлению движения
function drawSled(o) {
  const s = o.size, x = o.x, y = o.y;
  shadow(x, y + s * 0.3, s * 1.05, s * 0.28);
  dangerMark(o);
  ctx.save();
  if (o.dir < 0) { ctx.translate(x * 2, 0); ctx.scale(-1, 1); }
  // Лыжа спереди со стойкой
  ctx.strokeStyle = '#2a2a33'; ctx.lineWidth = s * 0.07; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x + s * 0.55, y - s * 0.15); ctx.lineTo(x + s * 0.6, y + s * 0.12); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + s * 0.2, y + s * 0.15); ctx.lineTo(x + s * 0.95, y + s * 0.15);
  ctx.quadraticCurveTo(x + s * 1.12, y + s * 0.13, x + s * 1.1, y - s * 0.02); ctx.stroke();
  // Гусеница с бегущими траками
  ctx.fillStyle = '#26262e';
  roundRect(x - s * 0.95, y - s * 0.12, s * 1.05, s * 0.3, s * 0.13); ctx.fill();
  ctx.fillStyle = '#4a4a55';
  const step = s * 0.15, off = ((o.wheel || 0) * s * 0.04) % step;
  for (let tx = x - s * 0.9 + off; tx < x + s * 0.05; tx += step) ctx.fillRect(tx, y + s * 0.1, s * 0.06, s * 0.06);
  ctx.fillStyle = '#777';
  for (const wx of [x - s * 0.78, x - s * 0.42, x - s * 0.08]) { ctx.beginPath(); ctx.arc(wx, y + s * 0.03, s * 0.08, 0, 7); ctx.fill(); }
  // Корпус
  ctx.fillStyle = o.color;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.95, y - s * 0.12); ctx.lineTo(x - s * 0.9, y - s * 0.38);
  ctx.lineTo(x + s * 0.2, y - s * 0.42); ctx.lineTo(x + s * 0.95, y - s * 0.2);
  ctx.quadraticCurveTo(x + s * 1.02, y - s * 0.08, x + s * 0.85, y - s * 0.05);
  ctx.lineTo(x + s * 0.1, y - s * 0.08); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.moveTo(x + s * 0.2, y - s * 0.4); ctx.lineTo(x + s * 0.9, y - s * 0.2); ctx.lineTo(x + s * 0.3, y - s * 0.28); ctx.closePath(); ctx.fill();
  // Фара и стекло
  ctx.fillStyle = '#fff6a0';
  ctx.beginPath(); ctx.ellipse(x + s * 0.86, y - s * 0.17, s * 0.06, s * 0.04, 0, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(170,220,255,0.75)';
  ctx.beginPath(); ctx.moveTo(x + s * 0.18, y - s * 0.42); ctx.lineTo(x + s * 0.3, y - s * 0.72); ctx.lineTo(x + s * 0.42, y - s * 0.68); ctx.lineTo(x + s * 0.4, y - s * 0.36); ctx.closePath(); ctx.fill();
  // Сиденье
  ctx.fillStyle = '#1d1d24';
  roundRect(x - s * 0.75, y - s * 0.5, s * 0.8, s * 0.1, s * 0.05); ctx.fill();
  // Водитель
  ctx.strokeStyle = '#2a3a5a'; ctx.lineWidth = s * 0.13;
  ctx.beginPath(); ctx.moveTo(x - s * 0.35, y - s * 0.52); ctx.lineTo(x - s * 0.02, y - s * 0.55); ctx.lineTo(x + s * 0.02, y - s * 0.3); ctx.stroke();
  ctx.fillStyle = o.jacket;
  ctx.beginPath(); ctx.ellipse(x - s * 0.3, y - s * 0.78, s * 0.17, s * 0.27, 0.35, 0, 7); ctx.fill();
  ctx.strokeStyle = o.jacket; ctx.lineWidth = s * 0.09;
  ctx.beginPath(); ctx.moveTo(x - s * 0.22, y - s * 0.9); ctx.lineTo(x + s * 0.05, y - s * 0.78); ctx.lineTo(x + s * 0.2, y - s * 0.66); ctx.stroke();
  // Шлем с визором
  ctx.fillStyle = o.color;
  ctx.beginPath(); ctx.arc(x - s * 0.18, y - s * 1.1, s * 0.16, 0, 7); ctx.fill();
  ctx.fillStyle = '#1d2a44';
  ctx.beginPath(); ctx.ellipse(x - s * 0.07, y - s * 1.1, s * 0.07, s * 0.08, 0, 0, 7); ctx.fill();
  ctx.restore();
}

// Лыжник: шапка с помпоном, шарф и палки
function drawSkier(o) {
  const s = o.size, x = o.x, y = o.y;
  shadow(x, y + s * 0.1, s * 0.9, s * 0.2);
  dangerMark(o);
  ctx.save();
  if (o.dir < 0) { ctx.translate(x * 2, 0); ctx.scale(-1, 1); }
  const bob = Math.sin((o.wheel || 0) * 0.5) * s * 0.04;
  // Лыжи
  ctx.strokeStyle = o.color; ctx.lineWidth = s * 0.07; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - s * 0.8, y); ctx.lineTo(x + s * 0.75, y);
  ctx.quadraticCurveTo(x + s * 0.92, y, x + s * 0.9, y - s * 0.1); ctx.stroke();
  // Ноги (полуприсед)
  ctx.strokeStyle = '#2a3a5a'; ctx.lineWidth = s * 0.14;
  ctx.beginPath(); ctx.moveTo(x - s * 0.1, y - s * 0.05); ctx.lineTo(x + s * 0.12, y - s * 0.4 + bob); ctx.lineTo(x - s * 0.08, y - s * 0.7 + bob); ctx.stroke();
  // Палки
  ctx.strokeStyle = '#555'; ctx.lineWidth = s * 0.035;
  ctx.beginPath(); ctx.moveTo(x + s * 0.1, y - s * 0.9 + bob); ctx.lineTo(x - s * 0.55, y - s * 0.05); ctx.stroke();
  // Куртка и руки
  ctx.fillStyle = o.jacket;
  ctx.beginPath(); ctx.ellipse(x - s * 0.02, y - s * 0.95 + bob, s * 0.17, s * 0.3, 0.4, 0, 7); ctx.fill();
  ctx.strokeStyle = o.jacket; ctx.lineWidth = s * 0.09;
  ctx.beginPath(); ctx.moveTo(x + s * 0.02, y - s * 1.05 + bob); ctx.lineTo(x + s * 0.12, y - s * 0.88 + bob); ctx.stroke();
  // Шарф
  ctx.strokeStyle = o.color; ctx.lineWidth = s * 0.08;
  ctx.beginPath(); ctx.moveTo(x + s * 0.02, y - s * 1.2 + bob); ctx.quadraticCurveTo(x - s * 0.25, y - s * 1.2 + bob, x - s * 0.4, y - s * 1.08 + bob * 2); ctx.stroke();
  // Голова, шапка, помпон
  ctx.fillStyle = '#f5c9a5';
  ctx.beginPath(); ctx.arc(x + s * 0.08, y - s * 1.33 + bob, s * 0.13, 0, 7); ctx.fill();
  ctx.fillStyle = o.color;
  ctx.beginPath(); ctx.arc(x + s * 0.07, y - s * 1.38 + bob, s * 0.14, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x + s * 0.05, y - s * 1.55 + bob, s * 0.06, 0, 7); ctx.fill();
  ctx.restore();
}

function drawHouse(o) {
  const s = o.size, x = o.x, y = o.y;
  shadow(x + s * 0.2, y + s * 0.2, s * 1.15, s * 0.35);
  dangerMark(o);
  const w = s * 1.6, h = s * 1.0;
  // Стены
  ctx.fillStyle = o.color;
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(x + w * 0.1, y - h, w * 0.4, h);
  // Крыша со снегом
  ctx.fillStyle = '#5a3a2a';
  ctx.beginPath(); ctx.moveTo(x - w * 0.62, y - h); ctx.lineTo(x, y - h - s * 0.75); ctx.lineTo(x + w * 0.62, y - h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(x - w * 0.64, y - h + s * 0.02); ctx.lineTo(x, y - h - s * 0.78); ctx.lineTo(x + w * 0.64, y - h + s * 0.02);
  ctx.lineTo(x + w * 0.5, y - h + s * 0.08); ctx.lineTo(x, y - h - s * 0.55); ctx.lineTo(x - w * 0.5, y - h + s * 0.08);
  ctx.closePath(); ctx.fill();
  // Труба
  ctx.fillStyle = '#7a4a3a';
  ctx.fillRect(x + w * 0.22, y - h - s * 0.6, s * 0.18, s * 0.35);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + w * 0.2, y - h - s * 0.64, s * 0.22, s * 0.07);
  // Окна с тёплым светом и дверь
  ctx.fillStyle = '#ffd56a';
  ctx.fillRect(x - w * 0.38, y - h * 0.72, w * 0.2, h * 0.28);
  ctx.fillRect(x + w * 0.18, y - h * 0.72, w * 0.2, h * 0.28);
  ctx.strokeStyle = '#5a3a2a'; ctx.lineWidth = s * 0.03;
  ctx.strokeRect(x - w * 0.38, y - h * 0.72, w * 0.2, h * 0.28);
  ctx.strokeRect(x + w * 0.18, y - h * 0.72, w * 0.2, h * 0.28);
  ctx.fillStyle = '#5a3a2a';
  ctx.fillRect(x - w * 0.08, y - h * 0.5, w * 0.16, h * 0.5);
  // Сугроб у стены
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(x, y, w * 0.6, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
}

function drawTower(o) {
  const s = o.size, x = o.x, y = o.y;
  shadow(x + s * 0.3, y + s * 0.15, s * 0.9, s * 0.3);
  dangerMark(o);
  const w = s * 0.9, h = s * 2.2;
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, '#a3a9b7'); g.addColorStop(1, '#6f7686');
  ctx.fillStyle = g;
  ctx.fillRect(x - w / 2, y - h, w, h);
  // Кладка
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = s * 0.02;
  for (let i = 1; i < 8; i++) {
    const yy = y - h * i / 8;
    ctx.beginPath(); ctx.moveTo(x - w / 2, yy); ctx.lineTo(x + w / 2, yy); ctx.stroke();
  }
  // Крыша
  ctx.fillStyle = '#2a5a9a';
  ctx.beginPath(); ctx.moveTo(x - w * 0.65, y - h); ctx.lineTo(x, y - h - s * 1.0); ctx.lineTo(x + w * 0.65, y - h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(x - w * 0.25, y - h - s * 0.6); ctx.lineTo(x, y - h - s * 1.0); ctx.lineTo(x + w * 0.25, y - h - s * 0.6); ctx.closePath(); ctx.fill();
  // Флажок и окна
  ctx.strokeStyle = '#333'; ctx.lineWidth = s * 0.03;
  ctx.beginPath(); ctx.moveTo(x, y - h - s); ctx.lineTo(x, y - h - s * 1.35); ctx.stroke();
  ctx.fillStyle = '#e8324a';
  ctx.beginPath(); ctx.moveTo(x, y - h - s * 1.35); ctx.lineTo(x + s * 0.3, y - h - s * 1.27); ctx.lineTo(x, y - h - s * 1.19); ctx.fill();
  ctx.fillStyle = '#ffd56a';
  ctx.fillRect(x - w * 0.12, y - h * 0.8, w * 0.24, h * 0.12);
  ctx.fillRect(x - w * 0.12, y - h * 0.45, w * 0.24, h * 0.12);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawFinish(o) {
  const hw = halfW() + 20 / S.z, cell = 26 / S.z;
  // Клетчатая лента поперёк трассы
  for (let row = 0; row < 2; row++) {
    for (let i = 0, x = -hw; x < hw; i++, x += cell) {
      ctx.fillStyle = (i + row) % 2 ? '#1d2a44' : '#ffffff';
      ctx.fillRect(x, o.y + row * cell - cell, cell, cell);
    }
  }
  // Столбы и растяжка
  const px = halfW() - 30 / S.z, ph = 200 / S.z;
  ctx.fillStyle = '#e8324a';
  ctx.fillRect(-px - 6 / S.z, o.y - ph, 12 / S.z, ph);
  ctx.fillRect(px - 6 / S.z, o.y - ph, 12 / S.z, ph);
  ctx.fillStyle = '#e8324a';
  roundRect(-px, o.y - ph, px * 2, 50 / S.z, 10 / S.z); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${34 / S.z}px 'Trebuchet MS', Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(t('finish'), 0, o.y - ph + 25 / S.z);
}

function drawCastle(o) {
  const s = o.size, hw = halfW() + 20 / S.z;
  const can = ball.r >= s * SMASH_K || ball.shield > 0;
  const wallH = s * 1.2;
  shadow(0, o.y + s * 0.1, hw, s * 0.2);
  // Стена
  const g = ctx.createLinearGradient(0, o.y - wallH, 0, o.y);
  g.addColorStop(0, '#e6f7ff'); g.addColorStop(1, '#8fc8ec');
  ctx.fillStyle = g;
  ctx.fillRect(-hw, o.y - wallH, hw * 2, wallH);
  // Зубцы
  const tooth = s * 0.3;
  for (let x = -hw; x < hw; x += tooth * 2) ctx.fillRect(x, o.y - wallH - tooth * 0.7, tooth, tooth * 0.7);
  // Ледяные блоки
  ctx.strokeStyle = 'rgba(80,140,200,0.35)'; ctx.lineWidth = s * 0.02;
  for (let r = 1; r < 4; r++) {
    const yy = o.y - wallH * r / 4;
    ctx.beginPath(); ctx.moveTo(-hw, yy); ctx.lineTo(hw, yy); ctx.stroke();
  }
  // Башни
  for (const tx of [-hw * 0.55, hw * 0.55]) {
    ctx.fillStyle = '#cdeeff';
    ctx.fillRect(tx - s * 0.35, o.y - wallH * 1.6, s * 0.7, wallH * 1.6);
    ctx.fillStyle = '#5fb4e8';
    ctx.beginPath(); ctx.moveTo(tx - s * 0.45, o.y - wallH * 1.6); ctx.lineTo(tx, o.y - wallH * 1.6 - s * 0.8); ctx.lineTo(tx + s * 0.45, o.y - wallH * 1.6); ctx.closePath(); ctx.fill();
  }
  // Ворота
  ctx.fillStyle = '#3a6f9a';
  ctx.beginPath();
  ctx.moveTo(-s * 0.4, o.y); ctx.lineTo(-s * 0.4, o.y - wallH * 0.55);
  ctx.arc(0, o.y - wallH * 0.55, s * 0.4, Math.PI, 0); ctx.lineTo(s * 0.4, o.y); ctx.closePath(); ctx.fill();
  // Подпись с требуемым размером
  ctx.font = `bold ${30 / S.z}px 'Trebuchet MS', Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const label = t('need', { s: meters(s * SMASH_K) });
  ctx.lineWidth = 6 / S.z; ctx.strokeStyle = 'rgba(13,35,64,0.85)';
  ctx.strokeText(label, 0, o.y - wallH * 1.6 - s * 1.0);
  ctx.fillStyle = can ? '#5fe07a' : '#ff6b6b';
  ctx.fillText(label, 0, o.y - wallH * 1.6 - s * 1.0);
}

function drawBall() {
  const r = ball.r, z = S.z;
  shadow(ball.x + r * 0.2, r * 0.85, r * 0.9, r * 0.28);
  if (ball.inv > 0 && Math.floor(ball.inv * 12) % 2 === 0 && ball.shield <= 0) ctx.globalAlpha = 0.5;
  drawBallAt(ctx, ball.x, 0, r, ball.rot, save.skin, ball.tilt || 0);
  ctx.globalAlpha = 1;
  if (ball.shield > 0) {
    const a = ball.shield < 1.5 ? (Math.sin(performance.now() / 60) + 1) / 2 : 1;
    ctx.strokeStyle = `rgba(90,190,255,${0.8 * a})`; ctx.lineWidth = 5 / z;
    ctx.fillStyle = `rgba(150,220,255,${0.2 * a})`;
    ctx.beginPath(); ctx.arc(ball.x, 0, r + 10 / z, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  if (ball.magnet > 0) {
    const tm = performance.now() / 1000;
    ctx.strokeStyle = 'rgba(255,90,90,0.35)'; ctx.lineWidth = 2 / z;
    for (let i = 0; i < 2; i++) {
      const rr = r + (20 + ((tm * 60 + i * 30) % 60)) / z;
      ctx.beginPath(); ctx.arc(ball.x, 0, rr, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

const DRAW = {
  tree: drawTree, rock: drawRock, snowman: drawSnowman, fire: drawFire, snow: drawSnowPile, coin: drawCoin,
  magnet: drawPower, shield: drawPower, sled: drawSled, skier: drawSkier, house: drawHouse, tower: drawTower,
  finish: drawFinish, castle: drawCastle,
};
const FLAT = { fire: 1, snow: 1, coin: 1, finish: 1 };

function render() {
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  if (S.shake > 0) ctx.translate(rand(-S.shake, S.shake) * 0.5, rand(-S.shake, S.shake) * 0.5);
  if (OX > 0) drawSides();
  ctx.save();
  ctx.translate(OX, 0);
  drawBackground();

  // Мировой слой с камерой
  ctx.save();
  ctx.translate(W / 2, BALL_SY);
  ctx.scale(S.z, S.z);
  drawTrail();
  for (const o of objs) if (FLAT[o.type]) DRAW[o.type](o);
  const list = objs.filter(o => !FLAT[o.type]);
  const showBall = S.mode === 'play' || S.mode === 'pause';
  if (showBall) list.push({ type: 'ball', y: 0 });
  list.sort((a, b) => a.y - b.y);
  for (const o of list) o.type === 'ball' ? drawBall() : DRAW[o.type](o);
  ctx.restore();

  for (const p of parts) {
    ctx.globalAlpha = clamp(p.life, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const tx of texts) {
    ctx.globalAlpha = clamp(tx.life * 1.5, 0, 1);
    ctx.font = `bold ${tx.size}px 'Trebuchet MS', Arial, sans-serif`;
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(13,35,64,0.85)';
    ctx.strokeText(tx.str, tx.x, tx.y);
    ctx.fillStyle = tx.color; ctx.fillText(tx.str, tx.x, tx.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const f of flakes) {
    ctx.beginPath(); ctx.arc(f.x * FW, f.y * H, f.s, 0, Math.PI * 2); ctx.fill();
  }
  const v = ctx.createRadialGradient(FW / 2, H / 2, Math.min(FW, H) * 0.4, FW / 2, H / 2, Math.max(FW, H) * 0.75);
  v.addColorStop(0, 'rgba(30,70,140,0)'); v.addColorStop(1, 'rgba(30,70,140,0.25)');
  ctx.fillStyle = v; ctx.fillRect(-20, -20, FW + 40, H + 40);
  if (S.flash > 0) { ctx.fillStyle = `rgba(255,80,80,${S.flash * 0.6})`; ctx.fillRect(-20, -20, FW + 40, H + 40); }
}

function updateFlakes(dt) {
  for (const f of flakes) {
    f.y += (f.v * 0.12 + (S.mode === 'play' ? -S.speed / H * 0.35 : 0.02)) * dt;
    f.x += Math.sin(f.y * 10 + f.s) * 0.02 * dt;
    if (f.y > 1.02) f.y = -0.02;
    if (f.y < -0.02) f.y = 1.02;
    if (f.x > 1.02) f.x = -0.02;
    if (f.x < -0.02) f.x = 1.02;
  }
}

// Фон меню: медленный спуск декоративных объектов
function menuUpdate(dt) {
  const dy = 120 * dt;
  S.z = 1;
  for (const o of objs) { o.y -= dy; if (o.vx) moveMover(o, dt); }
  scrollDecor(dy);
  objs = objs.filter(o => o.y > -BALL_SY - 200);
  S.nextSpawn -= dy;
  if (S.nextSpawn <= 0) {
    const r = Math.random();
    const type = r < 0.4 ? 'tree' : r < 0.55 ? 'rock' : r < 0.7 ? 'snowman' : r < 0.8 ? 'house' : r < 0.9 ? 'skier' : 'sled';
    add(type, rand(-W / 2 + 30, W / 2 - 30), H - BALL_SY + 100, rand(25, 55));
    S.nextSpawn = rand(80, 160);
  }
  updateParts(dt, 0);
}

// ---------- Главный цикл ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.mode === 'play') update(dt);
  else if (S.mode === 'menu' || S.mode === 'shop') menuUpdate(dt);
  else if (S.mode !== 'pause') updateParts(dt, 0);
  updateFlakes(dt);
  render();
  requestAnimationFrame(loop);
}

// ---------- Меню и магазин ----------
function refreshMenu() {
  $('menuBest').textContent = save.best;
  $('menuCoins').textContent = '● ' + save.coins;
  $('shopCoins').textContent = '● ' + save.coins;
  $('playBtn').textContent = t('play') + ' · ' + t('levelN', { n: save.level });
  const total = Object.values(save.stars).reduce((a, b) => a + b, 0);
  $('menuStars').textContent = total;
  refreshToggles();
}

function refreshToggles() {
  for (const [id, on, icOn, icOff] of [['sndBtn', save.sound, '🔊', '🔇'], ['pSndBtn', save.sound, '🔊', '🔇'], ['musBtn', save.music, '🎵', '🎵'], ['pMusBtn', save.music, '🎵', '🎵']]) {
    const el = $(id);
    el.classList.toggle('off', !on);
    const ic = el.querySelector('.ic');
    if (ic) ic.textContent = on ? icOn : icOff; else el.textContent = on ? icOn : icOff;
  }
}

function applyTexts() {
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  document.title = t('title');
  $('freeCoinsBtn').textContent = t('freeCoins', { n: 50 });
}

let shopTab = 'skins';
function renderShop() {
  $('tabSkins').classList.toggle('off', shopTab !== 'skins');
  $('tabUps').classList.toggle('off', shopTab !== 'ups');
  const list = $('shopList');
  list.innerHTML = '';
  if (shopTab === 'skins') {
    for (const sk of SKINS) {
      const owned = save.owned.includes(sk.id), sel = save.skin === sk.id;
      const card = document.createElement('div');
      card.className = 'card' + (sel ? ' sel' : '');
      const cv = document.createElement('canvas');
      cv.width = 128; cv.height = 128;
      drawBallAt(cv.getContext('2d'), 64, 64, 56, 1.2, sk.id);
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = t('sk_' + sk.id);
      const b = document.createElement('button'); b.className = 'btn' + (owned ? (sel ? ' ghost' : ' green') : ' gold');
      b.textContent = owned ? (sel ? t('selected') : t('select')) : '● ' + sk.price;
      b.disabled = sel || (!owned && save.coins < sk.price);
      b.onclick = () => {
        if (!owned) {
          if (save.coins < sk.price) return;
          save.coins -= sk.price; save.owned.push(sk.id); Sfx.buy();
        } else Sfx.click();
        save.skin = sk.id; persist(); refreshMenu(); renderShop();
      };
      card.append(cv, nm, b);
      list.append(card);
    }
  } else {
    for (const up of UPGRADES) {
      const lv = save.up[up.id], maxed = lv >= up.max, cost = up.cost(lv);
      const card = document.createElement('div'); card.className = 'card';
      const ic = document.createElement('div'); ic.style.fontSize = '36px'; ic.textContent = up.icon;
      if (up.id === 'coin') ic.style.color = '#ffd34d';
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = t('up_' + up.id);
      const ds = document.createElement('div'); ds.className = 'ds'; ds.textContent = t('up_' + up.id + '_d');
      const lvl = document.createElement('div'); lvl.className = 'lvl';
      for (let i = 0; i < up.max; i++) { const p = document.createElement('i'); if (i < lv) p.className = 'on'; lvl.append(p); }
      const b = document.createElement('button'); b.className = 'btn gold';
      b.textContent = maxed ? t('max') : '● ' + cost;
      b.disabled = maxed || save.coins < cost;
      b.onclick = () => {
        if (maxed || save.coins < cost) return;
        save.coins -= cost; save.up[up.id]++; Sfx.buy(); persist(); refreshMenu(); renderShop();
      };
      card.append(ic, nm, ds, lvl, b);
      list.append(card);
    }
  }
}

function bind(id, fn) {
  $(id).addEventListener('click', e => { Sfx.init(); Sfx.resume(); fn(e); });
}

let starting = false;
async function playWithAd(run, level) {
  if (starting) return;
  starting = true;
  Sfx.click();
  // Полноэкранная реклама — только между забегами, не чаще раза в ~минуту.
  if (save.games > 0) await YSDK.showFullscreen();
  starting = false;
  last = performance.now();
  startRun(run, level);
}

async function doubleReward(btn, onDone) {
  if (btn.disabled) return;
  btn.disabled = true;
  const ok = await YSDK.showRewarded();
  if (ok) {
    save.coins += S.reward; persist();
    Sfx.buy();
    btn.style.display = 'none';
    onDone(S.reward * 2);
  } else { toast(t('adFail')); btn.disabled = false; }
}

function setupUI() {
  bind('playBtn', () => playWithAd('level', save.level));
  bind('endlessBtn', () => playWithAd('endless'));
  bind('againBtn', () => playWithAd(S.run, S.cfg.n));
  bind('winNext', () => playWithAd('level', save.level));
  bind('winMenu', () => { Sfx.click(); refreshMenu(); setMode('menu'); });
  bind('shopBtn', () => { Sfx.click(); renderShop(); refreshMenu(); setMode('shop'); });
  bind('shopBack', () => { Sfx.click(); refreshMenu(); setMode('menu'); });
  bind('tabSkins', () => { shopTab = 'skins'; Sfx.click(); renderShop(); });
  bind('tabUps', () => { shopTab = 'ups'; Sfx.click(); renderShop(); });
  bind('pauseBtn', () => { Sfx.click(); pauseGame(); });
  bind('resumeBtn', () => { Sfx.click(); resumeGame(); });
  bind('pauseMenuBtn', () => { Sfx.click(); finishRun(); refreshMenu(); setMode('menu'); });
  bind('overMenuBtn', () => { Sfx.click(); refreshMenu(); setMode('menu'); });
  bind('reviveBtn', doRevive);
  bind('reviveSkip', () => { Sfx.click(); finishRun(); });
  bind('doubleBtn', () => doubleReward($('doubleBtn'), v => { $('overCoins').textContent = v; }));
  bind('winDouble', () => doubleReward($('winDouble'), v => { $('winCoins').textContent = v; }));
  bind('freeCoinsBtn', async () => {
    const b = $('freeCoinsBtn');
    if (b.disabled) return;
    b.disabled = true;
    const ok = await YSDK.showRewarded();
    b.disabled = false;
    if (ok) { save.coins += 50; persist(); Sfx.buy(); refreshMenu(); renderShop(); }
    else toast(t('adFail'));
  });
  // Звук и музыка: кнопки в меню и на паузе управляют одной настройкой
  const toggleSound = () => { save.sound = !save.sound; Sfx.soundOn = save.sound; Sfx.applyVolume(); persist(); refreshToggles(); Sfx.click(); };
  const toggleMusic = () => { save.music = !save.music; Sfx.musicOn = save.music; Sfx.applyVolume(); persist(); refreshToggles(); };
  bind('sndBtn', toggleSound); bind('pSndBtn', toggleSound);
  bind('musBtn', toggleMusic); bind('pMusBtn', toggleMusic);
}

function checkDaily() {
  const today = new Date().toISOString().slice(0, 10);
  if (save.daily !== today) {
    const first = !save.daily;
    save.daily = today;
    const n = first ? 100 : 50;
    save.coins += n;
    persist();
    setTimeout(() => toast(t('daily', { n })), 400);
  }
}

// ---------- Запуск ----------
async function boot() {
  await YSDK.init();
  setLang(YSDK.lang());
  const loaded = await YSDK.load();
  if (loaded) {
    save = { ...save, ...loaded, up: { ...save.up, ...(loaded.up || {}) }, stars: { ...(loaded.stars || {}) } };
    if (!Array.isArray(save.owned) || !save.owned.includes('classic')) save.owned = ['classic', ...(save.owned || [])];
    if (!(save.level >= 1)) save.level = 1;
  }
  Sfx.soundOn = save.sound; Sfx.musicOn = save.music;
  applyTexts();
  setupUI();
  refreshMenu();
  bumps = Array.from({ length: 26 }, () => ({ x: rand(0, W), y: rand(0, H + 200), s: rand(10, 30) }));
  for (let i = 0; i < 8; i++) add(i % 3 ? 'tree' : 'rock', rand(-W / 2 + 30, W / 2 - 30), rand(-BALL_SY, H - BALL_SY), rand(25, 55));
  setMode('menu');
  checkDaily();
  $('loading').style.display = 'none';
  YSDK.loadingReady();
  requestAnimationFrame(loop);
}

boot();

// Для отладки и автотестов
window.__game = {
  S, ball, update, startRun, levelCfg, add,
  get objs() { return objs; },
  get save() { return save; },
};
})();
