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
    this.musicGain.gain.value = 0.12;
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
    this.musicGain.gain.value = this.musicOn ? 0.12 : 0;
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

  // Оригинальная зимняя мелодия-арпеджио (колокольчики).
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const N = null;
    const mel = [76, N, 79, 76, 74, N, 72, N, 74, 76, N, 79, 81, N, 79, N,
                 76, N, 74, 72, 71, N, 72, N, 74, N, 71, 67, 69, N, N, N];
    const bass = [48, 48, 43, 43, 45, 45, 41, 43];
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    const beat = 0.2;
    this.musicTimer = setInterval(() => {
      if (!this.musicOn || this.adMuted || this.hidden) { this.step++; return; }
      const i = this.step % mel.length;
      if (mel[i]) {
        this.tone(mtof(mel[i]), 0.5, 'sine', 0.5, 0, 0, this.musicGain);
        this.tone(mtof(mel[i] + 12), 0.25, 'sine', 0.12, 0, 0, this.musicGain);
      }
      if (i % 4 === 0) this.tone(mtof(bass[(i / 4) % bass.length]), 0.7, 'triangle', 0.45, 0, 0, this.musicGain);
      this.step++;
    }, beat * 1000);
  },
};
