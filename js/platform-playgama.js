// Платформа Playgama. Подключается только в Playgama-сборке.
// ---------- Playgama Bridge SDK ----------
// Обязательные шаги Bridge: initialize до игры; язык из platform.language; сохранения только
// через storage; звук и пауза по событиям платформы (и начальному isAudioEnabled); game_ready;
// межстраничная реклама на каждой естественной паузе — частоту решает сам Bridge.
const PlaygamaPlatform = {
  platform: 'playgama',
  local: false,
  bannerModes: [],
  pgReady: false,

  withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
  },

  async pgInit() {
    try { await this.withTimeout(bridge.initialize(), 15000); this.pgReady = true; }
    catch (e) { console.warn('[Bridge] initialize failed:', e); return; }
    const P = bridge.platform, A = bridge.advertisement, EV = bridge.EVENT_NAME;
    // Платформа выключила звук — стартуем без звука; дальше следим за событиями
    Sfx.setAdMute(!P.isAudioEnabled);
    P.on(EV.AUDIO_STATE_CHANGED, enabled => Sfx.setAdMute(!enabled));
    P.on(EV.PAUSE_STATE_CHANGED, paused => this.onHide && this.onHide(paused));
    if (A.interstitialState === 'opened' || A.rewardedState === 'opened') this.onHide && this.onHide(true);
  },

  // Язык — только из Bridge; английский по умолчанию
  lang() { return (this.pgReady && bridge.platform.language) || 'en'; },

  loadingReady() { if (this.pgReady) bridge.platform.sendMessage('game_ready'); },
  gameplayStart() {},
  gameplayStop() {},

  restoreAudio() { if (this.pgReady) Sfx.setAdMute(!bridge.platform.isAudioEnabled); },

  rewardedSupported() { return this.pgReady && !!bridge.advertisement.isRewardedSupported; },

  // Награда — только если реклама дошла до состояния rewarded
  showRewarded() {
    if (!this.rewardedSupported()) return Promise.resolve(false);
    const A = bridge.advertisement, EV = bridge.EVENT_NAME;
    return new Promise(resolve => {
      let rewarded = false, done = false, timer;
      const finish = v => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (typeof A.off === 'function') A.off(EV.REWARDED_STATE_CHANGED, onState);
        this.restoreAudio();
        resolve(v);
      };
      const onState = state => {
        if (state === 'rewarded') rewarded = true;
        else if (state === 'closed') finish(rewarded);
        else if (state === 'failed') finish(false);
      };
      A.on(EV.REWARDED_STATE_CHANGED, onState);
      timer = setTimeout(() => finish(false), 180000);
      try { A.showRewarded('reward'); } catch (e) { finish(false); }
    });
  },

  // Межстраничная — на каждом переходе между забегами. Если Bridge решил не показывать
  // (рано или недоступно), состояние не меняется — продолжаем почти сразу.
  showFullscreen() {
    if (!this.pgReady || !bridge.advertisement.isInterstitialSupported) return Promise.resolve(false);
    const A = bridge.advertisement, EV = bridge.EVENT_NAME;
    return new Promise(resolve => {
      let started = false, opened = false, done = false, timer;
      const finish = v => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (typeof A.off === 'function') A.off(EV.INTERSTITIAL_STATE_CHANGED, onState);
        this.restoreAudio();
        resolve(v);
      };
      const onState = state => {
        if (state === 'loading' || state === 'opened') { started = true; clearTimeout(timer); timer = setTimeout(() => finish(opened), 60000); }
        if (state === 'opened') opened = true;
        if (state === 'closed' || state === 'failed') finish(opened);
      };
      A.on(EV.INTERSTITIAL_STATE_CHANGED, onState);
      timer = setTimeout(() => { if (!started) finish(false); }, 800);
      try { A.showInterstitial('level_transition'); } catch (e) { finish(false); }
    });
  },

  showBanner() {},
  hideBanner() {},

  // Сохранения — только через Bridge storage, одним ключом, без localStorage
  async load() {
    if (!this.pgReady) return null;
    try {
      const data = await this.withTimeout(bridge.storage.get(['save']), 8000);
      const v = data && data[0];
      if (!v) return null;
      return typeof v === 'string' ? JSON.parse(v) : v;
    } catch (e) { return null; }
  },

  save(data) {
    data.t = Date.now();
    if (!this.pgReady) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      bridge.storage.set(['save'], [JSON.stringify(data)]).catch(() => {});
    }, 400);
  },

  submitScore() {},
};
