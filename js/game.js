(() => {
'use strict';

// ---------- Константы и данные ----------
const BASE_W = 480, BASE_H = 820, MAX_LANE = 720;
const MIN_R = 9, MAX_R = 72;

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
};

// ---------- Canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let dpr = 1, scale = 1, W = BASE_W, H = BASE_H, FW = BASE_W, OX = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = window.innerWidth, ch = window.innerHeight;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  scale = Math.min(cw / BASE_W, ch / BASE_H);
  FW = cw / scale; H = ch / scale;
  W = Math.min(FW, MAX_LANE); OX = (FW - W) / 2;
  side = Array.from({ length: OX > 10 ? 30 : 0 }, () => ({ f: Math.random(), y: rand(-50, H + 100), s: rand(30, 60), left: Math.random() < 0.5 }));
}
let side = [];
window.addEventListener('resize', resize);

// ---------- Утилиты ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = id => document.getElementById(id);
resize();

// ---------- Состояние игры ----------
const S = {
  mode: 'menu', // menu | play | pause | revive | over
  t: 0, dist: 0, speed: 0, score: 0, coins: 0,
  combo: 0, comboT: 0, shake: 0, flash: 0,
  revived: false, deathReason: 'melt', nextSpawn: 0, doubled: false,
};
const ball = { x: 300, y: 0, r: 20, vx: 0, rot: 0, inv: 0, magnet: 0, shield: 0, targetX: 300 };
let objs = [], parts = [], texts = [], trail = [], bumps = [];
const flakes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: rand(1, 3.2), v: rand(0.3, 1) }));

// ---------- Ввод ----------
const keys = {};
let pointerDown = false, lastPX = 0;
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if ((e.code === 'Escape' || e.code === 'KeyP') && S.mode === 'play') pauseGame();
  else if ((e.code === 'Escape' || e.code === 'KeyP') && S.mode === 'pause') resumeGame();
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
  ball.targetX = clamp(ball.targetX + dx * 1.25, ball.r, W - ball.r);
});
window.addEventListener('pointerup', () => { pointerDown = false; });
window.addEventListener('pointercancel', () => { pointerDown = false; });
document.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('visibilitychange', () => {
  Sfx.setHidden(document.hidden);
  if (document.hidden && S.mode === 'play') pauseGame();
});

// ---------- Сохранение ----------
function persist() { YSDK.save(save); }

// ---------- Экранные сообщения ----------
let toastTimer;
function toast(msg, ms = 2200) {
  const el = $('toast');
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
}

function floatText(x, y, str, color = '#fff', size = 26) {
  texts.push({ x, y, str, color, size, life: 1 });
}

function burst(x, y, n, color, spd = 260, size = [3, 7]) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = rand(spd * 0.3, spd);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, r: rand(size[0], size[1]), color, life: rand(0.5, 1), g: 500 });
  }
}

// ---------- Спавн объектов ----------
function difficulty() { return clamp(S.t / 90, 0, 1); }

function freeSpot(x, y, r) {
  for (const o of objs) {
    const dx = o.x - x, dy = o.y - y;
    if (dx * dx + dy * dy < (o.r + r + 30) ** 2) return false;
  }
  return true;
}

function add(type, x, y, size, extra = {}) {
  const cr = { tree: 0.5, rock: 0.75, snowman: 0.6, fire: 0.7, snow: 0.8, coin: 1, magnet: 1, shield: 1 }[type] * size;
  if (!freeSpot(x, y, cr)) return null;
  const o = { type, x, y, size, r: cr, dead: false, seed: Math.random(), ...extra };
  objs.push(o);
  return o;
}

function obstacleSize() {
  // Размер препятствий подстраивается под ком: часть можно снести, часть — нет.
  const d = difficulty();
  const k = Math.random() < 0.55 - d * 0.15 ? rand(0.45, 0.95) : rand(1.15, 1.7 + d * 0.3);
  return clamp(ball.r * k, 12, 95);
}

function spawnRow() {
  const y = H + 120;
  const d = difficulty();
  const roll = Math.random();
  const margin = 40;

  if (roll < 0.30) {
    const n = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) add('snow', rand(margin, W - margin), y + rand(0, 80), rand(14, 22));
  } else if (roll < 0.52) {
    const x = rand(margin + 20, W - margin - 20);
    const curve = rand(-1, 1) * 60;
    for (let i = 0; i < 6; i++) add('coin', x + Math.sin(i / 5 * Math.PI) * curve, y + i * 50, 17);
  } else if (roll < 0.88) {
    const n = 1 + (Math.random() < 0.35 + d * 0.4 ? 1 : 0) + (Math.random() < d * 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const s = obstacleSize();
      const r2 = Math.random();
      const type = r2 < 0.55 ? 'tree' : r2 < 0.85 ? 'rock' : 'snowman';
      add(type, rand(margin, W - margin), y + rand(0, 100), type === 'rock' ? s * 0.85 : s);
    }
    if (Math.random() < 0.5) add('snow', rand(margin, W - margin), y + rand(120, 180), rand(14, 20));
    if (Math.random() < 0.4) add('coin', rand(margin, W - margin), y + rand(-40, 160), 17);
  } else if (roll < 0.95) {
    if (S.t > 20) add('fire', rand(margin, W - margin), y, rand(26, 34));
    else add('snow', rand(margin, W - margin), y, 18);
  } else {
    add(Math.random() < 0.5 ? 'magnet' : 'shield', rand(margin + 20, W - margin - 20), y, 18);
  }
  S.nextSpawn = rand(110, 170) - d * 30;
}

// ---------- Управление забегом ----------
function startRun() {
  Sfx.init(); Sfx.resume();
  objs = []; parts = []; texts = []; trail = [];
  bumps = Array.from({ length: 26 }, () => ({ x: rand(0, W), y: rand(0, H + 200), s: rand(10, 30) }));
  Object.assign(S, { t: 0, dist: 0, speed: 300, score: 0, coins: 0, combo: 0, comboT: 0, shake: 0, flash: 0, revived: false, nextSpawn: 200, doubled: false });
  Object.assign(ball, { x: W / 2, targetX: W / 2, y: H * 0.3, r: 20 + save.up.size * 3, vx: 0, rot: 0, inv: 1, magnet: 0, shield: 0 });
  for (let i = 0; i < 4; i++) add('snow', W / 2 + rand(-80, 80), H * 0.6 + i * 140, 18);
  setMode('play');
  if (!save.hinted) {
    save.hinted = true; persist();
    toast(t('hint'), 4500);
  }
}

function setMode(m) {
  S.mode = m;
  ['menu', 'shop', 'pause', 'revive', 'over'].forEach(id => $(id).classList.toggle('show', id === m));
  $('hud').classList.toggle('show', m === 'play' || m === 'pause' || m === 'revive');
  if (m === 'play') YSDK.gameplayStart(); else YSDK.gameplayStop();
  if (m === 'menu' || m === 'over' || m === 'shop') YSDK.showBanner(); else YSDK.hideBanner();
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
  if (!S.revived && S.score > 150) showRevive();
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
  ball.r = Math.max(26, 20 + save.up.size * 3);
  ball.inv = 2.5;
  objs = objs.filter(o => o.y > ball.y + 400 || o.type === 'coin' || o.type === 'snow');
  setMode('play');
  last = performance.now();
}

function finishRun() {
  clearInterval(reviveInt);
  const score = Math.floor(S.score);
  const isBest = score > save.best;
  if (isBest) save.best = score;
  save.coins += S.coins;
  save.games++;
  persist();
  YSDK.submitScore(save.best);
  $('overTitle').textContent = isBest && score > 0 ? t('newBest') : (S.deathReason === 'melt' ? t('gameOver') : t('crashed'));
  $('overScore').textContent = score;
  $('overBest').textContent = save.best;
  $('overCoins').textContent = S.coins;
  $('doubleBtn').style.display = S.coins >= 5 ? '' : 'none';
  $('doubleBtn').disabled = false;
  setMode('over');
}

// ---------- Обновление ----------
function hitObstacle(o) {
  const canSmash = ball.shield > 0 || ball.r >= o.size * 0.92;
  if (canSmash) {
    o.dead = true;
    S.combo = S.comboT > 0 ? S.combo + 1 : 1;
    S.comboT = 2.2;
    const mult = Math.min(S.combo, 10);
    const pts = Math.round(o.size * (o.type === 'snowman' ? 4 : 2.5) * mult);
    S.score += pts;
    ball.r = Math.min(MAX_R, ball.r + o.size * 0.06);
    const big = o.size > 40;
    Sfx.smash(big);
    S.shake = Math.max(S.shake, big ? 10 : 5);
    const col = o.type === 'tree' ? '#2f7d4f' : o.type === 'rock' ? '#7d8796' : '#fff';
    burst(o.x, o.y, 14, col, 300);
    burst(o.x, o.y, 12, '#fff', 260);
    floatText(o.x, o.y - 20, '+' + pts, '#ffd34d', 24 + Math.min(mult, 6) * 2);
    if (S.combo >= 3) floatText(ball.x, ball.y - ball.r - 30, t('combo', { n: mult }), '#7fe0ff', 26);
    if (o.type === 'snowman') { S.coins += 3; floatText(o.x + 20, o.y, '+3 ●', '#ffd34d'); }
  } else if (ball.inv <= 0) {
    Sfx.hit();
    S.shake = 16; S.flash = 0.35;
    S.combo = 0;
    burst(ball.x, ball.y, 22, '#fff', 340);
    ball.r *= 0.62;
    ball.inv = 1.2;
    const push = ball.x < o.x ? -1 : 1;
    ball.targetX = clamp(ball.x + push * (o.r + ball.r + 40), ball.r, W - ball.r);
    ball.vx = push * 600;
    if (ball.r < MIN_R) die('crash');
  }
}

function update(dt) {
  S.t += dt;
  const d = difficulty();
  S.speed = 300 + d * 280 + Math.min(S.t, 300) * 0.4;
  const dy = S.speed * dt;
  S.dist += dy;
  S.score += dy * 0.02;

  // Управление
  const kdir = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
  if (kdir) ball.targetX = clamp(ball.targetX + kdir * 620 * dt, ball.r, W - ball.r);
  ball.targetX = clamp(ball.targetX, ball.r, W - ball.r);
  const prevX = ball.x;
  ball.x += (ball.targetX - ball.x) * Math.min(1, dt * 14) + ball.vx * dt;
  ball.vx *= Math.pow(0.02, dt);
  ball.x = clamp(ball.x, ball.r, W - ball.r);
  ball.rot += dy / ball.r;
  ball.tilt = clamp((ball.x - prevX) / dt / 900, -0.35, 0.35);

  // Таяние: ком медленно уменьшается, нужно собирать снег
  ball.r -= (0.35 + d * 0.5 + ball.r * 0.012) * dt;
  if (ball.r < MIN_R) { die('melt'); return; }

  ball.inv = Math.max(0, ball.inv - dt);
  ball.magnet = Math.max(0, ball.magnet - dt);
  ball.shield = Math.max(0, ball.shield - dt);
  S.comboT -= dt;
  S.shake = Math.max(0, S.shake - dt * 40);
  S.flash = Math.max(0, S.flash - dt);

  // След кома в снегу
  for (const p of trail) p.y -= dy;
  trail.push({ x: ball.x, y: ball.y, r: ball.r });
  while (trail.length && trail[0].y < -100) trail.shift();
  scrollDecor(dy);

  // Спавн
  S.nextSpawn -= dy;
  if (S.nextSpawn <= 0) spawnRow();

  // Объекты
  const magR = 200 + ball.r * 2;
  for (const o of objs) {
    o.y -= dy;
    if (o.dead) continue;
    const isPick = o.type === 'snow' || o.type === 'coin';
    if (ball.magnet > 0 && isPick) {
      const mx = ball.x - o.x, my = ball.y - o.y, md = Math.hypot(mx, my);
      if (md < magR && md > 1) { o.x += mx / md * 700 * dt; o.y += my / md * 700 * dt; }
    }
    const dx = o.x - ball.x, dy2 = o.y - ball.y;
    const dist = Math.hypot(dx, dy2);
    if (o.type === 'fire') {
      if (dist < ball.r + o.r * 1.4) {
        if (ball.shield <= 0) {
          ball.r -= 22 * dt;
          if (Math.random() < 0.5) parts.push({ x: ball.x + rand(-ball.r, ball.r) * 0.6, y: ball.y - ball.r * 0.5, vx: rand(-30, 30), vy: rand(-160, -90), r: rand(5, 10), color: 'rgba(230,240,255,0.7)', life: 0.6, g: -40 });
          if (Math.random() < 0.1) Sfx.sizzle();
          if (ball.r < MIN_R) { die('melt'); return; }
        } else { o.dead = true; burst(o.x, o.y, 16, '#ff9a3c', 260); Sfx.smash(false); }
      }
      continue;
    }
    if (dist > ball.r + o.r) continue;
    switch (o.type) {
      case 'snow': {
        o.dead = true;
        const g = 2.6 * (1 - (ball.r / MAX_R) * 0.55);
        if (ball.r < MAX_R - 0.5) ball.r = Math.min(MAX_R, ball.r + g);
        S.score += 10;
        Sfx.snow();
        burst(o.x, o.y, 8, '#fff', 160, [2, 5]);
        break;
      }
      case 'coin': {
        o.dead = true;
        const v = 1 + save.up.coin;
        S.coins += v;
        Sfx.coin();
        floatText(o.x, o.y - 10, '+' + v, '#ffd34d', 22);
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
  objs = objs.filter(o => !o.dead && o.y > -200);

  for (const p of parts) {
    p.x += p.vx * dt; p.y += p.vy * dt - dy * 0.6; p.vy += p.g * dt; p.life -= dt * 1.4;
  }
  parts = parts.filter(p => p.life > 0);
  for (const tx of texts) { tx.y -= 60 * dt; tx.life -= dt * 0.9; }
  texts = texts.filter(tx => tx.life > 0);

  updateHud();
}

let hudCache = {};
function updateHud() {
  const sc = Math.floor(S.score);
  if (hudCache.s !== sc) { $('hudScore').textContent = sc; hudCache.s = sc; }
  if (hudCache.c !== S.coins) { $('hudCoins').textContent = '● ' + S.coins; hudCache.c = S.coins; }
  const pct = Math.round((ball.r - MIN_R) / (MAX_R - MIN_R) * 100);
  if (hudCache.p !== pct) { $('hudSize').style.width = clamp(pct, 0, 100) + '%'; hudCache.p = pct; }
}

function scrollDecor(dy) {
  for (const b of bumps) { b.y -= dy; if (b.y < -40) { b.y = H + rand(20, 200); b.x = rand(0, W); } }
  for (const t2 of side) { t2.y -= dy; if (t2.y < -80) { t2.y = H + rand(40, 160); t2.f = Math.random(); t2.s = rand(30, 60); } }
}

// ---------- Отрисовка ----------
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#e9f3ff');
  g.addColorStop(1, '#cfe2f7');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Бугорки на снегу для ощущения скорости
  ctx.fillStyle = 'rgba(160,190,225,0.35)';
  for (const b of bumps) {
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.s, b.s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Края трассы
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
  if (S.mode === 'menu' || o.deco) return;
  const big = ball.shield <= 0 && ball.r < o.size * 0.92;
  ctx.strokeStyle = big ? 'rgba(230,60,60,0.55)' : 'rgba(60,200,110,0.45)';
  ctx.lineWidth = 3;
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
  const bob = Math.sin(tm * 4 + o.seed * 6) * 5;
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

function drawBall() {
  const r = ball.r;
  shadow(ball.x + r * 0.2, ball.y + r * 0.85, r * 0.9, r * 0.28);
  if (ball.inv > 0 && Math.floor(ball.inv * 12) % 2 === 0 && ball.shield <= 0) ctx.globalAlpha = 0.5;
  drawBallAt(ctx, ball.x, ball.y, r, ball.rot, save.skin, ball.tilt || 0);
  ctx.globalAlpha = 1;
  if (ball.shield > 0) {
    const a = ball.shield < 1.5 ? (Math.sin(performance.now() / 60) + 1) / 2 : 1;
    ctx.strokeStyle = `rgba(90,190,255,${0.8 * a})`; ctx.lineWidth = 5;
    ctx.fillStyle = `rgba(150,220,255,${0.2 * a})`;
    ctx.beginPath(); ctx.arc(ball.x, ball.y, r + 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  if (ball.magnet > 0) {
    const tm = performance.now() / 1000;
    ctx.strokeStyle = 'rgba(255,90,90,0.35)'; ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      const rr = r + 20 + ((tm * 60 + i * 30) % 60);
      ctx.beginPath(); ctx.arc(ball.x, ball.y, rr, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

const DRAW = { tree: drawTree, rock: drawRock, snowman: drawSnowman, fire: drawFire, snow: drawSnowPile, coin: drawCoin, magnet: drawPower, shield: drawPower };

function render() {
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  if (S.shake > 0) ctx.translate(rand(-S.shake, S.shake) * 0.5, rand(-S.shake, S.shake) * 0.5);
  if (OX > 0) drawSides();
  ctx.save();
  ctx.translate(OX, 0);
  drawBackground();
  drawTrail();

  // Плоские объекты — под всем остальным
  for (const o of objs) if (o.type === 'fire' || o.type === 'snow' || o.type === 'coin') DRAW[o.type](o);
  // Высокие объекты и ком сортируем по глубине
  const list = objs.filter(o => !(o.type === 'fire' || o.type === 'snow' || o.type === 'coin'));
  const showBall = S.mode !== 'menu' && S.mode !== 'shop' && !(S.mode === 'over' || S.mode === 'revive');
  if (showBall) list.push({ type: 'ball', y: ball.y });
  list.sort((a, b) => a.y - b.y);
  for (const o of list) o.type === 'ball' ? drawBall() : DRAW[o.type](o);

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

  // Падающий снег (экранный слой)
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const f of flakes) {
    ctx.beginPath(); ctx.arc(f.x * FW, f.y * H, f.s, 0, Math.PI * 2); ctx.fill();
  }
  // Голубоватая виньетка
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
  for (const o of objs) o.y -= dy;
  scrollDecor(dy);
  objs = objs.filter(o => o.y > -200);
  S.nextSpawn -= dy;
  if (S.nextSpawn <= 0) {
    const r = Math.random();
    const type = r < 0.5 ? 'tree' : r < 0.7 ? 'rock' : r < 0.85 ? 'snowman' : 'snow';
    add(type, rand(30, W - 30), H + 100, type === 'snow' ? 18 : rand(25, 55));
    S.nextSpawn = rand(80, 160);
  }
  for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.life -= dt * 1.4; }
  parts = parts.filter(p => p.life > 0);
  for (const tx of texts) { tx.y -= 60 * dt; tx.life -= dt * 0.9; }
  texts = texts.filter(tx => tx.life > 0);
}

// ---------- Главный цикл ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.mode === 'play') update(dt);
  else if (S.mode !== 'pause') menuUpdate(dt);
  updateFlakes(dt);
  render();
  requestAnimationFrame(loop);
}

// ---------- Меню и магазин ----------
function refreshMenu() {
  $('menuBest').textContent = save.best;
  $('menuCoins').textContent = '● ' + save.coins;
  $('shopCoins').textContent = '● ' + save.coins;
  $('sndBtn').classList.toggle('off', !save.sound);
  $('musBtn').classList.toggle('off', !save.music);
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
async function playWithAd() {
  if (starting) return;
  starting = true;
  Sfx.click();
  // Полноэкранная реклама — только между забегами, не чаще раза в ~минуту.
  if (save.games > 0) await YSDK.showFullscreen();
  starting = false;
  last = performance.now();
  startRun();
}

function setupUI() {
  bind('playBtn', playWithAd);
  bind('againBtn', playWithAd);
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
  bind('doubleBtn', async () => {
    const b = $('doubleBtn');
    if (b.disabled) return;
    b.disabled = true;
    const ok = await YSDK.showRewarded();
    if (ok) {
      save.coins += S.coins; persist();
      $('overCoins').textContent = S.coins * 2;
      Sfx.buy();
      b.style.display = 'none';
    } else { toast(t('adFail')); b.disabled = false; }
  });
  bind('freeCoinsBtn', async () => {
    const b = $('freeCoinsBtn');
    if (b.disabled) return;
    b.disabled = true;
    const ok = await YSDK.showRewarded();
    b.disabled = false;
    if (ok) { save.coins += 50; persist(); Sfx.buy(); refreshMenu(); renderShop(); }
    else toast(t('adFail'));
  });
  bind('sndBtn', () => { save.sound = !save.sound; Sfx.soundOn = save.sound; Sfx.applyVolume(); persist(); refreshMenu(); Sfx.click(); });
  bind('musBtn', () => { save.music = !save.music; Sfx.musicOn = save.music; Sfx.applyVolume(); persist(); refreshMenu(); });
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
    save = { ...save, ...loaded, up: { ...save.up, ...(loaded.up || {}) } };
    if (!Array.isArray(save.owned) || !save.owned.includes('classic')) save.owned = ['classic', ...(save.owned || [])];
  }
  Sfx.soundOn = save.sound; Sfx.musicOn = save.music;
  applyTexts();
  setupUI();
  refreshMenu();
  bumps = Array.from({ length: 26 }, () => ({ x: rand(0, W), y: rand(0, H + 200), s: rand(10, 30) }));
  for (let i = 0; i < 8; i++) add(i % 3 ? 'tree' : 'rock', rand(30, W - 30), rand(0, H), rand(25, 55));
  setMode('menu');
  checkDaily();
  $('loading').style.display = 'none';
  YSDK.loadingReady();
  requestAnimationFrame(loop);
}

boot();

// Для отладки в консоли
window.__game = { S, ball, get save() { return save; }, startRun };
})();
