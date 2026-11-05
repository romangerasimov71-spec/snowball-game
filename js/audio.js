// Звуковые эффекты — файлы Kenney (CC0) из assets/sfx; фоновая музыка пока синтезируется через WebAudio.
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
    this.loadSfx();
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
  setHidden(v) {
    this.hidden = v;
    this.applyVolume();
    // Свёрнуто — полностью останавливаем аудиодвижок (тишина и экономия батареи)
    if (this.ctx) { try { v ? this.ctx.suspend() : this.ctx.resume(); } catch (e) {} }
  },

  // ---------- Звуковые эффекты: файлы Kenney (CC0) из assets/sfx ----------
  // Каждый эффект — один или несколько вариантов; играют через sfxGain → master,
  // поэтому выключаются кнопкой «Звук», во время рекламы и при сворачивании игры.
  SFX: {
    click: ['click'], snow: ['snow1', 'snow2'], coin: ['coin'], hit: ['hit'],
    smash: ['smash'], smashBig: ['smash-big'], sizzle: ['sizzle'], power: ['power'],
    reward: ['reward'], win: ['win'], over: ['over'],
  },
  buffers: {},

  // ogg там, где браузер его умеет, иначе mp3 (старый Safari)
  sfxExt() {
    const a = document.createElement('audio');
    return a.canPlayType && a.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'mp3';
  },

  decode(buf) {
    // Старый Safari знает только вариант decodeAudioData с колбэками
    return new Promise((resolve, reject) => {
      const p = this.ctx.decodeAudioData(buf, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  },

  // Файлы скачиваем сразу при загрузке игры (звук для этого не нужен),
  // а раскодируем, когда после первого касания появится AudioContext.
  prefetchSfx() {
    if (this.raw) return;
    this.raw = {};
    const ext = this.sfxExt();
    const names = [...new Set(Object.values(this.SFX).flat())];
    for (const name of names) {
      this.raw[name] = (async () => {
        for (const e of ext === 'ogg' ? ['ogg', 'mp3'] : ['mp3']) {
          try {
            const res = await fetch(`assets/sfx/${name}.${e}`);
            if (res.ok) return await res.arrayBuffer();
          } catch (err) { /* пробуем следующий формат */ }
        }
        return null;   // без файла эффект просто не прозвучит
      })();
    }
  },

  loadSfx() {
    this.prefetchSfx();
    this.pending = [];
    for (const name in this.raw) {
      this.raw[name].then(buf => buf && this.decode(buf)).then(decoded => {
        if (!decoded) return;
        this.buffers[name] = decoded;
        // Звук, запрошенный до раскодирования (первое касание), играем, если он ещё уместен
        const now = performance.now();
        this.pending = this.pending.filter(([key, vol, rate, at]) => {
          if (!this.SFX[key].includes(name)) return true;
          if (now - at < 500) this.play(key, vol, rate);
          return false;
        });
      }).catch(() => {});
    }
  },

  play(key, vol = 1, rate = 1) {
    if (!this.ctx) return;
    const list = this.SFX[key].filter(n => this.buffers[n]);
    if (!list.length) { if (this.pending) this.pending.push([key, vol, rate, performance.now()]); return; }
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[list[(Math.random() * list.length) | 0]];
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g); g.connect(this.sfxGain);
    src.start();
  },

  snow() { this.play('snow', 0.8, 0.95 + Math.random() * 0.15); },
  coin() { this.play('coin', 0.7, 0.97 + Math.random() * 0.06); },
  smash(big) { this.play(big ? 'smashBig' : 'smash', big ? 1 : 0.85, 0.92 + Math.random() * 0.16); },
  hit() { this.play('hit', 1); },
  sizzle() { this.play('sizzle', 0.35); },
  power() { this.play('power', 0.8); },
  over() { this.play('over', 0.8); },
  win() { this.play('win', 0.8); },
  click() { this.play('click', 0.7); },
  buy() { this.play('reward', 0.75); },

  // Динамичный трек, 140 BPM, ля минор. 8 частей по 4 такта (~55 с) до повтора:
  // A A2 B C A D B2 C2. У каждой части своя гармония и мелодия; в меню — без барабанов.
  intensity: 0,
  setIntensity(v) { this.intensity = v; },

  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const c = this.ctx;
    const BPM = 140, SIX = 60 / BPM / 4;
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

    // Эхо для мелодии
    this.echo = c.createDelay(1);
    this.echo.delayTime.value = SIX * 3;
    const fb = c.createGain(); fb.gain.value = 0.3;
    const wet = c.createGain(); wet.gain.value = 0.35;
    this.echo.connect(fb); fb.connect(this.echo); this.echo.connect(wet); wet.connect(this.musicGain);
    const bassLP = c.createBiquadFilter(); bassLP.type = 'lowpass'; bassLP.frequency.value = 700; bassLP.connect(this.musicGain);
    const arpLP = c.createBiquadFilter(); arpLP.type = 'lowpass'; arpLP.frequency.value = 2600; arpLP.connect(this.musicGain);

    // Аккорды: корень (MIDI) и тип
    const CH = { Am: [57, 'm'], F: [53, 'M'], C: [48, 'M'], G: [55, 'M'], Em: [52, 'm'], Dm: [50, 'm'], E: [52, 'M'] };
    const tones = name => { const [r, q] = CH[name]; return q === 'm' ? [r, r + 3, r + 7] : [r, r + 4, r + 7]; };
    const SECTIONS = {
      A:  { prog: ['Am', 'F', 'C', 'G'], drums: 'full', lead: false, arp: true },
      A2: { prog: ['Am', 'F', 'C', 'G'], drums: 'full', lead: 'A', arp: true },
      B:  { prog: ['F', 'G', 'Em', 'Am'], drums: 'half', lead: 'B', arp: false, pad: true },
      C:  { prog: ['Dm', 'G', 'C', 'E'], drums: 'build', lead: 'C', arp: true },
      D:  { prog: ['C', 'G', 'Am', 'F'], drums: 'four', lead: 'D', arp: true, double: true },
      B2: { prog: ['F', 'G', 'Em', 'Am'], drums: 'full', lead: 'B2', arp: true, pad: true },
      C2: { prog: ['Dm', 'G', 'Am', 'E'], drums: 'build', lead: 'C2', arp: true },
    };
    const ORDER = ['A', 'A2', 'B', 'C', 'A', 'D', 'B2', 'C2'];

    // Мелодии генерируются из пентатоники детерминированно (сид = имя части)
    const PENTA = [69, 72, 74, 76, 79, 81, 84, 86, 88];
    const RHYTHMS = [
      [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0],
      [1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0],
      [1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0],
      [1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0],
    ];
    const melodies = {};
    const melody = key => {
      if (melodies[key]) return melodies[key];
      let seed = 0; for (const ch of key) seed = seed * 31 + ch.charCodeAt(0);
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const out = [];
      let idx = 2 + (rnd() * 3 | 0);
      for (let bar = 0; bar < 4; bar++) {
        const rh = RHYTHMS[(rnd() * RHYTHMS.length) | 0];
        const notes = [];
        for (let st = 0; st < 16; st++) {
          if (!rh[st]) { notes.push(null); continue; }
          idx = Math.max(0, Math.min(PENTA.length - 1, idx + ((rnd() * 5) | 0) - 2));
          notes.push(PENTA[idx]);
        }
        out.push(notes);
      }
      // Мотив = такт 1–2, повтор с изменённым концом — запоминается, но не надоедает
      out[2] = out[0].slice();
      return (melodies[key] = out);
    };

    const osc = (type, f, t0, dur, vol, dest, slide) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.02);
    };
    const noise = (t0, dur, vol, type, freq) => {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = c.createGain();
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(this.musicGain);
      src.start(t0, Math.random() * 0.3); src.stop(t0 + dur + 0.02);
    };
    const kick = t0 => osc('sine', 150, t0, 0.22, 0.55, this.musicGain, 42);
    const snare = t0 => { noise(t0, 0.16, 0.5, 'bandpass', 1900); osc('triangle', 210, t0, 0.08, 0.25, this.musicGain); };
    const hat = (t0, open) => noise(t0, open ? 0.18 : 0.035, open ? 0.16 : 0.12, 'highpass', 7500);

    const step = (pos, t0) => {
      const bar = Math.floor(pos / 16), st = pos % 16;
      const secName = ORDER[Math.floor(bar / 4) % ORDER.length];
      const sec = SECTIONS[secName], bIn = bar % 4;
      const chord = tones(sec.prog[bIn]);
      const full = this.intensity > 0;

      // Барабаны (только в забеге)
      if (full) {
        const d = sec.drums;
        if (d === 'four' ? st % 4 === 0 : d === 'half' ? st === 0 || st === 10 : st === 0 || st === 8 || (st === 14 && bIn % 2))
          kick(t0);
        if (d === 'half' ? st === 8 : st === 4 || st === 12) snare(t0);
        if (d === 'build' && bIn === 3 && st >= 8) snare(t0); // разгон перед следующей частью
        if (st % 2 === 0) hat(t0, d !== 'half' && st % 8 === 6);
      }
      // Бас: пульсирующие восьмые с октавным скачком
      if (st % 2 === 0) {
        const root = chord[0] - 24 + (st % 8 === 4 ? 12 : 0);
        osc('sawtooth', mtof(root), t0, SIX * 1.7, full ? 0.22 : 0.12, bassLP);
      }
      // Арпеджио шестнадцатыми
      if (sec.arp || !full) {
        const seq = [0, 1, 2, 1, 2, 0, 1, 2];
        const n = chord[seq[st % 8]] + 12 + (st >= 8 && bIn % 2 ? 12 : 0);
        osc('square', mtof(n), t0, SIX * 0.9, full ? 0.035 : 0.03, arpLP);
      }
      // Пэд в куплетах
      if (sec.pad && st === 0) for (const n of chord) osc('triangle', mtof(n), t0, SIX * 15, 0.05, this.musicGain);
      // Мелодия
      if (full && sec.lead) {
        const m = melody(sec.lead)[bIn][st];
        if (m) {
          osc('square', mtof(m), t0, SIX * 1.8, 0.06, this.echo);
          osc('square', mtof(m), t0, SIX * 1.8, 0.06, this.musicGain);
          if (sec.double) osc('triangle', mtof(m + 12), t0, SIX * 1.5, 0.05, this.musicGain);
        }
      }
    };

    this.pos = 0;
    this.nextT = c.currentTime + 0.1;
    this.musicTimer = setInterval(() => {
      const now = c.currentTime;
      if (this.nextT < now - 0.2) this.nextT = now + 0.05; // после сворачивания вкладки не «догоняем» пропущенное
      while (this.nextT < now + 0.12) {
        if (this.musicOn && !this.adMuted && !this.hidden) step(this.pos, this.nextT);
        this.nextT += SIX;
        this.pos++;
      }
    }, 25);
  },
};

// Скачиваем звуковые файлы заранее, пока игрок смотрит на загрузку и меню
Sfx.prefetchSfx();
