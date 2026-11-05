// Звук игры: эффекты (Kenney, CC0) из assets/sfx и фоновая музыка (3xBlast, CC0) из assets/music.
// Всё звучит через WebAudio: эффекты → sfxGain, музыка → musicGain, оба → master.
//  • кнопка «Звук» выключает всё, кнопка «Музыка» — только музыку;
//  • реклама и платформа приглушают master; при сворачивании аудиодвижок останавливается
//    (музыка замирает и потом продолжает с того же места).
const SFX_VOLUME = 1.0;
const MUSIC_VOLUME = 0.12;          // музыка заметно тише эффектов
const MUSIC_FILE = 'assets/music/christmas-synths';
const MUSIC_LOOP_SECONDS = 84;      // точная длина цикла трека — повтор без паузы на стыке

const Sfx = {
  ctx: null,
  master: null,
  musicGain: null,
  sfxGain: null,
  soundOn: true,
  musicOn: true,
  adMuted: false,
  hidden: false,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.connect(this.master);
    this.applyVolume();
    this.loadSfx();
    this.startMusic();
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended' && !this.hidden) this.ctx.resume();
  },

  applyVolume() {
    if (!this.ctx) return;
    const muted = this.adMuted || this.hidden;
    this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    this.sfxGain.gain.value = this.soundOn ? SFX_VOLUME : 0;
    this.musicGain.gain.value = this.soundOn && this.musicOn ? MUSIC_VOLUME : 0;
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

  // ---------- Фоновая музыка: файл, повтор через WebAudio ----------
  // Скачиваем трек только после старта игры, чтобы он не задерживал загрузку.
  prefetchMusic() {
    if (this.musicRaw) return;
    const exts = this.sfxExt() === 'ogg' ? ['ogg', 'mp3'] : ['mp3'];
    this.musicRaw = (async () => {
      for (const e of exts) {
        try {
          const res = await fetch(`${MUSIC_FILE}.${e}`);
          if (res.ok) return await res.arrayBuffer();
        } catch (err) { /* следующий формат */ }
      }
      return null;
    })();
    if (this.ctx) this.startMusic();
  },

  async startMusic() {
    if (!this.ctx || !this.musicRaw || this.musicStarted) return;
    this.musicStarted = true;
    try {
      const raw = await this.musicRaw;
      if (!raw) return;
      const buf = await this.decode(raw);
      // Некоторые декодеры mp3 оставляют в начале тишину кодировщика — пропускаем её,
      // а цикл задаём ровно по длине трека, чтобы стык был без паузы.
      const ch = buf.getChannelData(0), maxLead = Math.min(ch.length, Math.round(buf.sampleRate * 0.1));
      let lead = 0;
      while (lead < maxLead && Math.abs(ch[lead]) < 0.002) lead++;
      if (lead >= maxLead) lead = 0;
      const loopStart = lead / buf.sampleRate;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = loopStart;
      src.loopEnd = Math.min(buf.duration, loopStart + MUSIC_LOOP_SECONDS);
      src.connect(this.musicGain);
      src.start(0, loopStart);
      this.musicSrc = src;
    } catch (e) { this.musicStarted = false; }
  },
};

// Скачиваем звуковые файлы заранее, пока игрок смотрит на загрузку и меню
Sfx.prefetchSfx();
