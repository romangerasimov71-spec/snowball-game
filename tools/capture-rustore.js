// Скриншоты карточки RuStore: телефон, книжные 1080×1920 PNG, русский, режим Android-приложения (без рекламы).
//   ./build.sh && mkdir -p /tmp/sb-vk && unzip -oq dist/snowball-vk.zip -d /tmp/sb-vk && (cd /tmp/sb-vk && python3 -m http.server 8126 &)
//   GAME_URL=http://127.0.0.1:8126/index.html NODE_PATH=/opt/node-tools/node_modules node tools/capture-rustore.js
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '..', 'release', 'rustore', 'screenshots');
require('fs').mkdirSync(OUT, { recursive: true });
const URL = process.env.GAME_URL || 'http://127.0.0.1:8126/index.html';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 SnowballAndroid/1.0.0';
const ONLY = process.env.ONLY || '';

(async () => {
  const browser = await chromium.launch();
  const open = async (save) => {
    const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, locale: 'ru-RU', userAgent: UA, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.addInitScript((s) => {
      const d = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
      localStorage.setItem('snowball_save', JSON.stringify(Object.assign({ daily: d, streak: 3, hinted: true, t: Date.now() }, s)));
    }, save);
    await page.goto(URL);
    await page.waitForFunction(() => window.SBGame && SBGame.debug().mode === 'menu');
    await page.waitForTimeout(600);
    return [ctx, page];
  };
  const shot = async (page, name) => {
    const bad = await page.evaluate(() => [...document.querySelectorAll('#freeCoinsBtn, #doubleBtn, #winDouble, #dailyX2, #reviveBtn, .btn.ad, #inviteBtn, #winShare, #overShare')]
      .filter(e => !e.hidden && getComputedStyle(e).display !== 'none' && e.offsetParent !== null).map(e => e.id || e.className));
    if (bad.length) throw new Error('ad / social button visible on ' + name + ': ' + bad.join(','));
    await page.screenshot({ path: `${OUT}/${name}-1080x1920.png` });
  };
  // простой «игрок»: каждые 80 мс выбирает полосу — к снегу, монетам и тому, что можно снести, мимо крупного и костров
  const steer = (page, ms, stopAtWin) => page.evaluate(([ms, stopAtWin]) => new Promise(res => {
    const t0 = performance.now();
    const step = () => {
      const { ball, objs, smashK, z } = SBGame.peek();
      const lim = Math.max(0, (innerWidth / 2) / z - ball.r);
      let best = ball.x, bestV = -1e9;
      for (let i = 0; i <= 24; i++) {
        const x = -lim + (2 * lim) * i / 24;
        let v = -Math.abs(x - ball.x) * 0.002;
        for (const o of objs) {
          if (o.dead || o.y < -ball.r || o.y > 900 / z) continue;
          const near = Math.abs(o.x - x) < ball.r + o.r + 6 / z;
          if (!near) continue;
          const w = 1 / (1 + Math.max(0, o.y) * z / 300);
          if (o.type === 'snow') v += 3 * w;
          else if (o.type === 'coin') v += 1 * w;
          else if (o.type === 'magnet' || o.type === 'shield') v += 4 * w;
          else if (o.type === 'fire') v -= 40 * w;
          else if (o.type === 'finish' || o.type === 'boss') continue;
          else if (ball.shield > 0 || ball.r >= o.size * smashK) v += 2 * w;
          else v -= 60 * w;
        }
        if (v > bestV) { bestV = v; best = x; }
      }
      ball.targetX = best;
      const m = SBGame.debug().mode;
      if (performance.now() - t0 < ms && m === 'play') setTimeout(step, 80); else res(m);
    };
    step();
  }), [ms, !!stopAtWin]);

  // играть до ms, каждую секунду снимать кадр; оставить кадр с самым большим комом
  const bestShot = async (page, name, ms) => {
    let best = null, bestR = 0;
    for (let t = 0; t < ms; t += 1000) {
      const m = await steer(page, 1000);
      if (m !== 'play') break;
      const r = await page.evaluate(() => SBGame.peek().ball.r * SBGame.peek().z);
      if (r > bestR) { bestR = r; best = await page.screenshot(); }
    }
    console.log(name, 'ball on screen', Math.round(bestR), 'px');
    require('fs').writeFileSync(`${OUT}/${name}-1080x1920.png`, best);
  };
  let ctx, page;
  if (!ONLY || ONLY === '1') {
    [ctx, page] = await open({ level: 7, coins: 1240, best: 18450, owned: ['classic', 'ice', 'candy', 'pine'], skin: 'candy', stars: { 1: 3, 2: 3, 3: 2, 4: 3, 5: 2, 6: 3 }, wins: 6, games: 9 });
    await shot(page, '1-menu');
    await ctx.close();
  }
  if (!ONLY || ONLY === '2') {
    [ctx, page] = await open({ level: 4, coins: 300, games: 3, up: { size: 2, magnet: 1, shield: 1, coin: 1 } });
    await page.click('#playBtn');
    await bestShot(page, '2-run', 30000);
    await ctx.close();
  }
  if (!ONLY || ONLY === '3') {
    [ctx, page] = await open({ level: 17, coins: 2400, games: 30, skin: 'night', owned: ['classic', 'night'], up: { size: 3, magnet: 2, shield: 2, coin: 2 } });
    await page.click('#playBtn');
    await bestShot(page, '3-city', 45000);
    await ctx.close();
  }
  if (!ONLY || ONLY === '4') {
    [ctx, page] = await open({ level: 2, coins: 500, games: 4, stars: { 1: 3 }, up: { size: 3, magnet: 2, shield: 2, coin: 2 } });
    await page.click('#playBtn');
    const m = await steer(page, 90000);
    console.log('4:', m);
    if (m !== 'win') throw new Error('level not finished: ' + m);
    await page.waitForTimeout(2200);
    await shot(page, '4-win');
    await ctx.close();
  }
  await browser.close();
  console.log('ok');
})();
