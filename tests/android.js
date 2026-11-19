/*
 * Режим Android-приложения (RuStore): WebView дописывает «SnowballAndroid/<версия>» к user agent.
 * Проверяет VK-сборку (именно она лежит в APK, `./build.sh` → dist/snowball-vk.zip):
 *  - быстрый запуск без параметров площадки и без SDK, площадка = android, мост VK не вызывается;
 *  - нет рекламы и бонусов за неё: «×2» подарка дня, «+50 монет», «бесплатно за рекламу» у скинов,
 *    «×2 монеты» и «Продолжить» (второй шанс) после забега; межстраничной тоже нет;
 *  - нет «Пригласить», «Поделиться», строки «Поддержка и новинки: vk.com/…», внешних запросов;
 *  - SBGame.back(): подарок — забрать, магазин/уровни/итог — в меню, игра — пауза, пауза — продолжить, меню — false;
 *  - SBGame.appPause(): пауза и тишина, потом звук возвращается;
 *  - прогресс переживает перезагрузку (localStorage); язык по телефону.
 * Контроль: та же сборка без признака — во ВК (подставной мост) реклама и строка поддержки на месте.
 *
 *   ./build.sh && mkdir -p /tmp/sb-vk && unzip -oq dist/snowball-vk.zip -d /tmp/sb-vk && (cd /tmp/sb-vk && python3 -m http.server 8126 &)
 *   GAME_URL=http://127.0.0.1:8126/index.html node tests/android.js
 */
const { chromium } = require('playwright');
const URL = process.env.GAME_URL || 'http://127.0.0.1:8126/index.html';
const UA_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36';
const UA = UA_PHONE + ' SnowballAndroid/1.0.0';
const results = [];
function check(name, ok, extra) { results.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); }

async function open(browser, { ua = UA, locale = 'ru-RU', query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua, locale, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('request', r => { if (!/^http:\/\/127\.0\.0\.1/.test(r.url()) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  await page.addInitScript(() => {
    // мост VK, который «умеет всё» (реклама есть): в приложении его всё равно нельзя трогать
    window.__vkCalls = [];
    const mock = {
      send(m, d) {
        window.__vkCalls.push(m + ' ' + JSON.stringify(d || {}));
        if (m === 'VKWebAppStorageGet') return Promise.resolve({ keys: (d.keys || []).map(k => ({ key: k, value: '' })) });
        return Promise.resolve({ result: true });
      },
      subscribe() {}, supports() { return true; }, isWebView() { return false; }
    };
    Object.defineProperty(window, 'vkBridge', { get: () => mock, set: () => {}, configurable: true });
  });
  const t0 = Date.now();
  await page.goto(URL + query);
  await page.waitForFunction(() => window.SBGame && ['menu', 'daily'].includes(SBGame.debug().mode), null, { timeout: 15000 });
  return { ctx, page, errors, external, ms: Date.now() - t0 };
}
const vis = (page, id) => page.evaluate(id => { const e = document.getElementById(id); if (!e || e.hidden) return false; const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.offsetParent !== null; }, id);
const dbg = page => page.evaluate(() => SBGame.debug());

(async () => {
  const browser = await chromium.launch();
  const { ctx, page, errors, external, ms } = await open(browser);
  check('запуск до меню без SDK (< 3 с)', ms < 3000, ms + ' ms');
  let d = await dbg(page);
  check('площадка android', d.platform === 'android');
  check('версия игры доступна (SBGame.version)', /^\d+\.\d+\.\d+$/.test(await page.evaluate(() => SBGame.version)));
  check('язык телефона ru → русский', (await page.textContent('#playBtn')).includes('Играть'));

  // первый запуск — сразу меню: подарок дня только со второго захода в меню (решение Романа 19.11)
  check('первый запуск: сразу меню, без подарка дня', d.mode === 'menu', d.mode);
  check('нет «Пригласить»', !(await vis(page, 'inviteBtn')));

  // магазин: ни «+50 монет», ни «бесплатно за рекламу» у скинов
  await page.click('#shopBtn'); await page.waitForTimeout(200);
  check('магазин: нет «+50 монет» за рекламу', !(await vis(page, 'freeCoinsBtn')));
  check('магазин: нет «бесплатно за рекламу» у скинов', (await page.locator('#shopList .btn.ad').count()) === 0);
  check('back() из магазина — в меню', (await page.evaluate(() => SBGame.back())) === true && (await dbg(page)).mode === 'menu');
  await page.click('#levelsBtn'); await page.waitForTimeout(200);
  check('back() из уровней — в меню', (await page.evaluate(() => SBGame.back())) === true && (await dbg(page)).mode === 'menu');
  check('back() в меню → false (приложение выходит)', (await page.evaluate(() => SBGame.back())) === false);

  // реклама напрямую: сразу «нет»
  check('showRewarded() → false сразу', (await page.evaluate(() => Promise.race([YSDK.showRewarded(), new Promise(r => setTimeout(() => r('timeout'), 300))]))) === false);
  check('showFullscreen() → false сразу', (await page.evaluate(() => Promise.race([YSDK.showFullscreen(), new Promise(r => setTimeout(() => r('timeout'), 300))]))) === false);

  // забег: пауза «Назад», сворачивание
  await page.click('#playBtn'); await page.waitForTimeout(500);
  check('уровень запущен', (await dbg(page)).mode === 'play');
  check('back() в игре — пауза', (await page.evaluate(() => SBGame.back())) === true && (await dbg(page)).mode === 'pause');
  check('нет строки «Поддержка и новинки: vk.com/…» в паузе', !(await vis(page, 'supportLine')) && !(await page.textContent('#supportLine')).includes('vk.com'));
  check('back() на паузе — продолжить', (await page.evaluate(() => SBGame.back())) === true && (await dbg(page)).mode === 'play');
  await page.evaluate(() => SBGame.appPause(true));
  d = await dbg(page);
  check('appPause(true): пауза и тишина', d.mode === 'pause' && d.silent, JSON.stringify(d));
  await page.evaluate(() => SBGame.appPause(false));
  d = await dbg(page);
  check('appPause(false): звук вернулся, пауза остаётся', d.mode === 'pause' && !d.silent, JSON.stringify(d));

  // бесконечный забег до конца (ком тает сам): без второго шанса и без «×2 монеты»
  await page.evaluate(() => SBGame.back()); // продолжить
  await page.evaluate(() => { document.querySelector('#pauseBtn').click(); });
  await page.click('#pauseMenuBtn'); await page.waitForTimeout(200);
  // второй заход в меню — подарок дня: без «×2 за рекламу»; «Назад» забирает подарок
  d = await dbg(page);
  check('второй заход в меню: подарок дня открыт', d.mode === 'daily', d.mode);
  check('нет «×2» за рекламу в подарке', !(await vis(page, 'dailyX2')));
  const c0 = d.coins;
  check('back() забирает подарок и открывает меню', (await page.evaluate(() => SBGame.back())) === true && (d = await dbg(page)).mode === 'menu' && d.coins === c0 + 50, JSON.stringify(d));
  await page.click('#endlessBtn'); await page.waitForTimeout(300);
  const tEnd = Date.now() + 150000;
  let modes = new Set();
  while (Date.now() < tEnd) {
    d = await dbg(page); modes.add(d.mode);
    if (d.mode !== 'play') break;
    await page.waitForTimeout(500);
  }
  check('забег закончился без «второго шанса» за рекламу', d.mode === 'over' && !modes.has('revive'), [...modes].join(','));
  check('итог: нет «×2 монеты» за рекламу', !(await vis(page, 'doubleBtn')));
  check('итог: нет «Поделиться»', !(await vis(page, 'overShare')));
  check('back() из итога — в меню', (await page.evaluate(() => SBGame.back())) === true && (await dbg(page)).mode === 'menu');

  // прогресс переживает перезагрузку
  const coins = (await dbg(page)).coins;
  await page.reload();
  await page.waitForFunction(() => window.SBGame && ['menu', 'daily'].includes(SBGame.debug().mode));
  d = await dbg(page);
  check('прогресс (монеты) сохранён после перезагрузки', d.coins === coins && coins > 0 && (await page.evaluate(() => !!localStorage.getItem('snowball_save'))), coins + ' -> ' + d.coins);

  check('мост VK ни разу не вызван', (await page.evaluate(() => window.__vkCalls.length)) === 0, (await page.evaluate(() => window.__vkCalls.join(' | '))));
  check('нет внешних запросов', external.length === 0, external.join(' '));
  check('нет ошибок и предупреждений в консоли', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // английский телефон
  const en = await open(browser, { locale: 'en-US' });
  check('язык телефона en → английский', (await en.page.textContent('#playBtn')).includes('Play'));
  await en.ctx.close();

  // контроль: та же сборка во ВК (без признака приложения) — всё как было
  const vk = await open(browser, { ua: UA_PHONE, query: '?vk_platform=mobile_android&vk_app_id=1&vk_language=ru' });
  d = await dbg(vk.page);
  check('ВК (без признака): площадка vk', d.platform === 'vk', d.platform);
  check('ВК: мост вызван (VKWebAppInit)', (await vk.page.evaluate(() => window.__vkCalls.some(c => c.startsWith('VKWebAppInit')))));
  check('ВК: первый запуск — меню без подарка дня', d.mode === 'menu', d.mode);
  // первый забег и выход в меню — подарок дня с «×2» за рекламу
  await vk.page.click('#playBtn'); await vk.page.waitForTimeout(400);
  await vk.page.evaluate(() => document.querySelector('#pauseBtn').click());
  await vk.page.click('#pauseMenuBtn'); await vk.page.waitForTimeout(200);
  d = await dbg(vk.page);
  check('ВК: второй заход в меню — подарок дня', d.mode === 'daily', d.mode);
  if (d.mode === 'daily') check('ВК: «×2» за рекламу в подарке есть', await vis(vk.page, 'dailyX2'));
  await vk.page.evaluate(() => SBGame.back());
  await vk.page.click('#shopBtn'); await vk.page.waitForTimeout(200);
  check('ВК: «+50 монет» за рекламу есть', await vis(vk.page, 'freeCoinsBtn'));
  check('ВК: строка поддержки vk.com есть', (await vk.page.textContent('#supportLine')).includes('vk.com'));
  await vk.ctx.close();

  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
