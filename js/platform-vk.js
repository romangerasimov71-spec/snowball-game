// Платформа VK Игры и Одноклассники. Подключается только в VK-сборке.
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
