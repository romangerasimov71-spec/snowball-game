// Звук синтезируется через WebAudio — никаких файлов, игра весит копейки.
const Sfx = {
  ctx: null,
  master: null,
  musicGain: null,
  sfxGain: null,
  soundOn: true,
  musicOn: true,
  adMuted: false,
  hidden: false,
  musicTimer: null,
  step: 0,
  noiseBuf: null,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.5;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.25;
    this.musicGain.connect(this.master);
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolume();
    this.startMusic();
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  applyVolume() {
    if (!this.ctx) return;
    const muted = this.adMuted || this.hidden;
    this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    this.sfxGain.gain.value = this.soundOn ? 0.5 : 0;
    this.musicGain.gain.value = this.musicOn ? 0.25 : 0;
  },

  setAdMute(v) { this.adMuted = v; this.applyVolume(); },
  setHidden(v) { this.hidden = v; this.applyVolume(); },

  tone(freq, dur, type = 'sine', vol = 1, slide = 0, delay = 0, dest) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest || this.sfxGain);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  },

  noise(dur, vol = 1, freq = 1200, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxGain);
    s.start(t0);
    s.stop(t0 + dur + 0.05);
  },

  snow() { this.tone(500 + Math.random() * 200, 0.12, 'sine', 0.4, 400); },
  coin() { this.tone(988, 0.08, 'square', 0.15); this.tone(1319, 0.2, 'square', 0.15, 0, 0.07); },
  smash(big) { this.noise(big ? 0.4 : 0.25, 0.8, big ? 900 : 1600); this.tone(big ? 90 : 140, 0.25, 'triangle', 0.6, -60); },
  hit() { this.noise(0.35, 1, 500); this.tone(110, 0.4, 'sawtooth', 0.4, -70); },
  sizzle() { this.noise(0.15, 0.25, 4000); },
  power() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.15, 'triangle', 0.35, 0, i * 0.07)); },
  over() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.4, 0, i * 0.15)); },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.35, 0, i * 0.1)); },
  click() { this.tone(700, 0.06, 'sine', 0.3); },
  buy() { [659, 880, 1175].forEach((f, i) => this.tone(f, 0.12, 'square', 0.12, 0, i * 0.06)); },

  // Спокойный зимний эмбиент: мягкие аккорды + редкие колокольчики с эхом.
  // Ноты колокольчиков выбираются случайно из аккорда, поэтому музыка не надоедает.
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const c = this.ctx;
    // Мягкий фильтр для аккордов
    this.padFilter = c.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1100;
    this.padFilter.connect(this.musicGain);
    // Эхо для колокольчиков
    this.echo = c.createDelay(1);
    this.echo.delayTime.value = 0.42;
    const fb = c.createGain(); fb.gain.value = 0.35;
    const wet = c.createGain(); wet.gain.value = 0.5;
    this.echo.connect(fb); fb.connect(this.echo);
    this.echo.connect(wet); wet.connect(this.musicGain);

    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    // Cmaj9 → Am9 → Fmaj7 → G6sus — светлая «снежная» последовательность
    const chords = [
      [48, 55, 59, 62, 64],
      [45, 52, 55, 59, 60],
      [41, 48, 52, 55, 57],
      [43, 50, 52, 57, 59],
    ];
    const TICK = 0.25, BAR = 16; // 16 тиков = 4 секунды на аккорд

    const pad = (m, t0) => {
      for (const [type, det, vol] of [['sine', 0, 0.09], ['triangle', 4, 0.04]]) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.value = mtof(m); o.detune.value = det;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 1.5);
        g.gain.setValueAtTime(vol, t0 + 3.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 5.2);
        o.connect(g); g.connect(this.padFilter);
        o.start(t0); o.stop(t0 + 5.3);
      }
    };
    const bell = (m, t0, vol) => {
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = mtof(m);
      o2.type = 'sine'; o2.frequency.value = mtof(m) * 3.01; // лёгкий «стеклянный» обертон
      const g2 = c.createGain(); g2.gain.value = 0.15;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
      o.connect(g); o2.connect(g2); g2.connect(g);
      g.connect(this.musicGain); g.connect(this.echo);
      o.start(t0); o2.start(t0); o.stop(t0 + 2.3); o2.stop(t0 + 2.3);
    };

    this.step = 0;
    this.musicTimer = setInterval(() => {
      const i = this.step++;
      if (!this.musicOn || this.adMuted || this.hidden) return;
      const t0 = c.currentTime + 0.05;
      const ch = chords[Math.floor(i / BAR) % chords.length];
      if (i % BAR === 0) {
        for (const m of ch.slice(1, 4)) pad(m, t0);
        pad(ch[0] - 12, t0); // низкий бас
      }
      // Колокольчики: редко, по сильным долям чаще
      const p = i % 4 === 0 ? 0.35 : 0.08;
      if (Math.random() < p) bell(pick(ch) + 24, t0, 0.07 + Math.random() * 0.05);
    }, TICK * 1000);

    function pick(a) { return a[(Math.random() * a.length) | 0]; }
  },
};
