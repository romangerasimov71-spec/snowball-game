// Обёртка над Yandex Games SDK v2. Локально (без /sdk.js) работает в режиме заглушки,
// чтобы игру можно было разрабатывать и тестировать в обычном браузере.
const YSDK = {
  sdk: null,
  player: null,
  local: true,
  platform: 'yandex',
  onPause: null,   // (paused:boolean) => void — пауза от платформы (реклама и т.п.)
  onHide: null,    // (hidden:boolean) => void — игру свернули / развернули
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
    // VK Игры: подменяем методы платформы на VK-версии
    if (window.IS_VK && window.vkBridge) {
      Object.assign(this, VKPlatform);
      await this.vkInit();
      return;
    }
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

// ---------- VK Игры (VK Bridge) ----------
// Каждый вызов моста ограничен по времени: вне VK (или при сбое клиента) мост может не ответить,
// и игра не должна из-за этого зависнуть.
const VKPlatform = {
  platform: 'vk',
  local: false,
  ads: { interstitial: false, reward: false },
  bannerShown: false,

  call(method, params = {}, timeout = 4000) {
    return Promise.race([
      vkBridge.send(method, params),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout: ' + method)), timeout)),
    ]);
  },

  async vkInit() {
    this.params = new URLSearchParams(location.search);
    vkBridge.subscribe(e => {
      const type = e && e.detail && e.detail.type;
      if (type === 'VKWebAppViewHide') this.onHide && this.onHide(true);
      if (type === 'VKWebAppViewRestore') this.onHide && this.onHide(false);
    });
    // Заранее проверяем наличие рекламы, чтобы показ был быстрым
    this.preloadAd('interstitial');
    this.preloadAd('reward');
  },

  lang() { return this.params.get('vk_language') || (navigator.language || 'ru').slice(0, 2); },

  // У VK нет аналогов LoadingAPI / GameplayAPI
  loadingReady() {},
  gameplayStart() {},
  gameplayStop() {},

  preloadAd(format) {
    return this.call('VKWebAppCheckNativeAds', { ad_format: format })
      .then(r => (this.ads[format] = !!(r && r.result)))
      .catch(() => (this.ads[format] = false));
  },

  async showFullscreen() {
    const now = Date.now();
    if (now - this.lastFullscreen < 65000) return false;
    this.lastFullscreen = now;
    if (!this.ads.interstitial) { this.preloadAd('interstitial'); return false; }
    Sfx.setAdMute(true);
    try {
      const r = await this.call('VKWebAppShowNativeAds', { ad_format: 'interstitial' }, 60000);
      return !!(r && r.result);
    } catch (e) { return false; }
    finally { Sfx.setAdMute(false); this.preloadAd('interstitial'); }
  },

  async showRewarded() {
    Sfx.setAdMute(true);
    try {
      if (!this.ads.reward) await this.preloadAd('reward');
      const r = await this.call('VKWebAppShowNativeAds', { ad_format: 'reward' }, 120000);
      return !!(r && r.result);
    } catch (e) { return false; }
    finally { Sfx.setAdMute(false); this.preloadAd('reward'); }
  },

  showBanner() {
    if (this.bannerShown) return;
    this.bannerShown = true;
    this.call('VKWebAppShowBannerAd', { banner_location: 'bottom', layout_type: 'resize' }).catch(() => { this.bannerShown = false; });
  },
  hideBanner() {
    if (!this.bannerShown) return;
    this.bannerShown = false;
    this.call('VKWebAppHideBannerAd').catch(() => {});
  },

  // Хранилище VK ограничено 4096 символами на ключ — звёзды упаковываем в строку цифр.
  pack(data) {
    const st = data.stars || {};
    const max = Math.max(0, ...Object.keys(st).map(Number));
    let str = '';
    for (let i = 1; i <= max; i++) str += st[i] || 0;
    return JSON.stringify({ ...data, stars: str });
  },
  unpack(text) {
    const d = JSON.parse(text);
    if (typeof d.stars === 'string') {
      const st = {};
      [...d.stars].forEach((c, i) => { if (c !== '0') st[i + 1] = +c; });
      d.stars = st;
    }
    return d;
  },

  async load() {
    let local = null, cloud = null;
    try { local = JSON.parse(localStorage.getItem('snowball_save') || 'null'); } catch (e) {}
    try {
      const r = await this.call('VKWebAppStorageGet', { keys: ['save'] }, 2500);
      const v = r && r.keys && r.keys[0] && r.keys[0].value;
      if (v) cloud = this.unpack(v);
    } catch (e) { /* нет ответа — работаем с локальным сохранением */ }
    if (cloud && local) return (cloud.t || 0) >= (local.t || 0) ? cloud : local;
    return cloud || local;
  },

  save(data) {
    data.t = Date.now();
    try { localStorage.setItem('snowball_save', JSON.stringify(data)); } catch (e) {}
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const value = this.pack(data);
      if (value.length <= 4096) this.call('VKWebAppStorageSet', { key: 'save', value }).catch(() => {});
    }, 800);
  },

  // Таблица рекордов VK открывается отдельным окном — во время игры его не показываем
  submitScore() {},
};
