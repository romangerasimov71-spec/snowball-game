// Обёртка над Yandex Games SDK v2. Локально (без /sdk.js) работает в режиме заглушки,
// чтобы игру можно было разрабатывать и тестировать в обычном браузере.
const YSDK = {
  sdk: null,
  player: null,
  local: true,
  onPause: null,   // (paused:boolean) => void — пауза от платформы
  gameplayActive: false,

  loadScript(src, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('timeout')), timeout);
    });
  },

  async init() {
    try {
      if (location.protocol === 'file:') throw new Error('file protocol');
      if (typeof YaGames === 'undefined') await this.loadScript('/sdk.js');
      this.sdk = await YaGames.init();
      this.local = false;
      try { this.player = await this.sdk.getPlayer({ scopes: false }); } catch (e) { /* без игрока */ }
      try {
        this.sdk.on('game_api_pause', () => this.onPause && this.onPause(true));
        this.sdk.on('game_api_resume', () => this.onPause && this.onPause(false));
      } catch (e) { /* старый SDK */ }
    } catch (e) {
      console.info('[YSDK] локальный режим:', e && e.message);
    }
  },

  lang() {
    try { if (this.sdk) return this.sdk.environment.i18n.lang; } catch (e) {}
    return (navigator.language || 'ru').slice(0, 2);
  },

  // Обязательный вызов: игра загружена и готова к взаимодействию.
  loadingReady() {
    try { this.sdk && this.sdk.features.LoadingAPI && this.sdk.features.LoadingAPI.ready(); } catch (e) {}
  },

  gameplayStart() {
    if (this.gameplayActive) return;
    this.gameplayActive = true;
    try { this.sdk && this.sdk.features.GameplayAPI && this.sdk.features.GameplayAPI.start(); } catch (e) {}
  },

  gameplayStop() {
    if (!this.gameplayActive) return;
    this.gameplayActive = false;
    try { this.sdk && this.sdk.features.GameplayAPI && this.sdk.features.GameplayAPI.stop(); } catch (e) {}
  },

  // Полноэкранная реклама (между забегами). Частоту дополнительно ограничивает сама платформа.
  lastFullscreen: 0,
  showFullscreen() {
    return new Promise(resolve => {
      const now = Date.now();
      if (!this.sdk || now - this.lastFullscreen < 65000) return resolve(false);
      this.lastFullscreen = now;
      try {
        this.sdk.adv.showFullscreenAdv({
          callbacks: {
            onOpen: () => Sfx.setAdMute(true),
            onClose: shown => { Sfx.setAdMute(false); resolve(shown); },
            onError: () => { Sfx.setAdMute(false); resolve(false); },
            onOffline: () => { Sfx.setAdMute(false); resolve(false); },
          },
        });
      } catch (e) { Sfx.setAdMute(false); resolve(false); }
    });
  },

  // Реклама за вознаграждение. resolve(true), только если игрок досмотрел.
  showRewarded() {
    return new Promise(resolve => {
      if (!this.sdk) {
        // Локальная заглушка: имитируем просмотр.
        Sfx.setAdMute(true);
        setTimeout(() => { Sfx.setAdMute(false); resolve(true); }, 600);
        return;
      }
      let rewarded = false;
      try {
        this.sdk.adv.showRewardedVideo({
          callbacks: {
            onOpen: () => Sfx.setAdMute(true),
            onRewarded: () => { rewarded = true; },
            onClose: () => { Sfx.setAdMute(false); resolve(rewarded); },
            onError: () => { Sfx.setAdMute(false); resolve(false); },
          },
        });
      } catch (e) { Sfx.setAdMute(false); resolve(false); }
    });
  },

  showBanner() { try { this.sdk && this.sdk.adv.showBannerAdv(); } catch (e) {} },
  hideBanner() { try { this.sdk && this.sdk.adv.hideBannerAdv(); } catch (e) {} },

  // Сохранения: облако Яндекса + localStorage как резерв.
  async load() {
    let local = null, cloud = null;
    try { local = JSON.parse(localStorage.getItem('snowball_save') || 'null'); } catch (e) {}
    try { if (this.player) cloud = await this.player.getData(['save']).then(d => d.save || null); } catch (e) {}
    if (cloud && local) return (cloud.t || 0) >= (local.t || 0) ? cloud : local;
    return cloud || local;
  },

  saveTimer: null,
  save(data) {
    data.t = Date.now();
    try { localStorage.setItem('snowball_save', JSON.stringify(data)); } catch (e) {}
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try { this.player && this.player.setData({ save: data }, false); } catch (e) {}
    }, 800);
  },

  // Лидерборд с техническим названием "score" нужно создать в консоли разработчика.
  async submitScore(score) {
    if (!this.sdk) return;
    try {
      if (this.sdk.leaderboards && this.sdk.leaderboards.setScore) {
        await this.sdk.leaderboards.setScore('score', score);
      } else if (this.sdk.getLeaderboards) {
        const lb = await this.sdk.getLeaderboards();
        await lb.setLeaderboardScore('score', score);
      }
    } catch (e) { /* игрок не авторизован или лидерборд не создан */ }
  },
};
