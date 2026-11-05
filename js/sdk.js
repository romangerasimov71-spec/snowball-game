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
    if ((window.IS_VK || window.IS_OK) && window.vkBridge) {
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
  // Можно ли вообще предлагать рекламу за вознаграждение (false — кнопки «за рекламу» скрываются)
  rewardedSupported() { return true; },
  // На каких экранах показывать баннер
  bannerModes: ['menu', 'over', 'shop', 'win', 'levels'],
  // Социальные функции есть только в VK / OK
  can() { return false; },
  async invite() { return false; },
  async shareRecord() { return false; },
  async shareStory() { return false; },
  async addToFavorites() { return false; },
  async homeScreenAvailable() { return false; },
  async addToHomeScreen() { return false; },
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

// ---------- VK Игры и Одноклассники (VK Bridge) ----------
// Одна сборка для VK и OK. Что умеет каждая площадка — по таблице совместимости OK
// (dev.vk.ru/ru/ok/development/bridge). Каждый вызов моста ограничен по времени,
// поэтому вне VK/OK или при сбое клиента игра не зависает.
const FEATURES = {
  vk: { invite: true, wallpost: true, story: true, share: false, favorites: true, homescreen: true },
  // В OK нет ViewHide/Restore, WallPostBox, AddToFavorites, AddToHomeScreen, LeaderBoardBox
  ok: { invite: true, wallpost: false, story: true, share: true, favorites: false, homescreen: false },
};
const FULLSCREEN_COOLDOWN = 150000;   // межстраничная реклама — не чаще раза в 2,5 минуты

// Отказ пользователя (закрыл окно) — не ошибка клиента, повторять не нужно
const userCancelled = e => {
  const d = e && (e.error_data || e.data && e.data.error_data);
  if (!d) return false;
  return d.error_code === 4 || /cancel|denied|closed/i.test(d.error_reason || d.error_msg || '');
};

const VKPlatform = {
  local: false,
  ads: { interstitial: false, reward: false },
  bannerShown: false,
  bannerModes: ['menu'],      // баннер только в меню: он сдвигает экран (resize) и не закрывает кнопки

  call(method, params = {}, timeout = 4000) {
    return Promise.race([
      vkBridge.send(method, params),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout: ' + method)), timeout)),
    ]);
  },

  async vkInit() {
    this.platform = window.IS_OK ? 'ok' : 'vk';
    this.params = new URLSearchParams(location.search);
    this.appId = this.params.get('vk_app_id') || '54877124';
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
  can(feature) { return !!FEATURES[this.platform][feature]; },

  // Аналогов LoadingAPI / GameplayAPI нет
  loadingReady() {},
  gameplayStart() {},
  gameplayStop() {},

  // ---- Реклама ----
  preloadAd(format, timeout = 4000) {
    return this.call('VKWebAppCheckNativeAds', { ad_format: format }, timeout)
      .then(r => (this.ads[format] = !!(r && r.result)))
      .catch(() => (this.ads[format] = false));
  },

  async showFullscreen() {
    const now = Date.now();
    if (now - this.lastFullscreen < FULLSCREEN_COOLDOWN) return false;
    if (!this.ads.interstitial) { this.preloadAd('interstitial'); return false; }
    this.lastFullscreen = now;
    Sfx.setAdMute(true);
    try {
      const r = await this.call('VKWebAppShowNativeAds', { ad_format: 'interstitial' }, 60000);
      return !!(r && r.result);
    } catch (e) { return false; }
    finally { Sfx.setAdMute(false); this.ads.interstitial = false; this.preloadAd('interstitial'); }
  },

  async showRewarded() {
    // Реклама не подтвердилась даже повторной проверкой — сразу отказ («Реклама недоступна»)
    if (!this.ads.reward && !(await this.preloadAd('reward', 1500))) return false;
    Sfx.setAdMute(true);
    try {
      const r = await this.call('VKWebAppShowNativeAds', { ad_format: 'reward' }, 120000);
      return !!(r && r.result);
    } catch (e) { return false; }
    finally { Sfx.setAdMute(false); this.ads.reward = false; this.preloadAd('reward'); }
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

  // ---- Рост игроков ----
  // Приглашение друзей. На сайте OK параметр message обязателен.
  async invite(message) {
    if (!this.can('invite')) return false;
    try {
      const r = await this.call('VKWebAppShowInviteBox', this.platform === 'ok' ? { message } : {}, 120000);
      return !(r && r.success === false);
    } catch (e) { return false; }
  },

  // Поделиться рекордом. VK — пост на стену со ссылкой на игру; OK — VKWebAppShare без ссылок на VK.
  async shareRecord(text) {
    try {
      if (this.can('wallpost')) {
        const r = await this.call('VKWebAppShowWallPostBox', { message: text, attachments: 'https://vk.com/app' + this.appId }, 120000);
        return !!(r && (r.post_id || r.result));
      }
      if (this.can('share')) {
        const r = await this.call('VKWebAppShare', {}, 120000);   // без link — делится самой игрой в OK
        return !!r;
      }
    } catch (e) { /* закрыл окно или клиент не ответил */ }
    return false;
  },

  // История с картинкой рекорда. OK: только background_type image и attachment типа url —
  // ссылку не добавляем совсем (никаких переходов во ВКонтакте). Если клиент не принял
  // картинку-«blob», пробуем статичную картинку по url.
  async shareStory(blob, fallbackUrl) {
    if (!this.can('story')) return false;
    const base = { background_type: 'image' };
    if (this.platform === 'vk') base.attachment = { type: 'url', url: 'https://vk.com/app' + this.appId, text: 'play' };
    const tryStory = async params => {
      const r = await this.call('VKWebAppShowStoryBox', params, 180000);
      return !!(r && (r.result !== false));
    };
    try { return await tryStory({ ...base, blob }); }
    catch (e) {
      if (userCancelled(e) || !fallbackUrl) return false;
      try { return await tryStory({ ...base, url: fallbackUrl }); } catch (e2) { return false; }
    }
  },

  // Избранное и главный экран — только VK
  async addToFavorites() {
    if (!this.can('favorites')) return false;
    try { const r = await this.call('VKWebAppAddToFavorites', {}, 60000); return !!(r && r.result); }
    catch (e) { return false; }
  },
  async homeScreenAvailable() {
    if (!this.can('homescreen')) return false;
    try {
      const r = await this.call('VKWebAppAddToHomeScreenInfo', {}, 2500);
      return !!(r && r.is_feature_supported && !r.is_added_to_home_screen);
    } catch (e) { return false; }
  },
  async addToHomeScreen() {
    if (!this.can('homescreen')) return false;
    try { const r = await this.call('VKWebAppAddToHomeScreen', {}, 60000); return !!(r && r.result); }
    catch (e) { return false; }
  },

  // ---- Сохранения: VK и OK раздельно (облако + локальная копия) ----
  cloudKey() { return this.platform === 'ok' ? 'save_ok' : 'save'; },
  localKey() { return this.platform === 'ok' ? 'snowball_save_ok' : 'snowball_save_vk'; },

  // Хранилище ограничено 4096 символами на ключ — звёзды упаковываем в строку цифр.
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

  readLocal() {
    try {
      let v = localStorage.getItem(this.localKey());
      // Прогресс VK до разделения площадок лежал под общим ключом
      if (!v && this.platform === 'vk') v = localStorage.getItem('snowball_save');
      return JSON.parse(v || 'null');
    } catch (e) { return null; }
  },

  async load() {
    let cloud = null;
    const local = this.readLocal();
    try {
      const r = await this.call('VKWebAppStorageGet', { keys: [this.cloudKey()] }, 2500);
      const v = r && r.keys && r.keys[0] && r.keys[0].value;
      if (v) cloud = this.unpack(v);
    } catch (e) { /* облако недоступно — работаем с локальным сохранением */ }
    if (cloud && local) return (cloud.t || 0) >= (local.t || 0) ? cloud : local;
    return cloud || local;
  },

  save(data) {
    data.t = Date.now();
    try { localStorage.setItem(this.localKey(), JSON.stringify(data)); } catch (e) {}
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const value = this.pack(data);
      if (value.length <= 4096) this.call('VKWebAppStorageSet', { key: this.cloudKey(), value }).catch(() => {});
    }, 800);
  },

  // Таблица лидеров VK требует серверной записи результатов (secure.addAppEvent) — не используется
  submitScore() {},
};
