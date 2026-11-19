/*
 * Начало игры (решение Романа 19.11 — чтобы не бросали на первой минуте). Проверяет:
 *  - мягкий старт: на 1-м уровне модельные игроки выигрывают чаще, чем до правки, и первая победа — за 20–32 с;
 *    уровни с 4-го не изменились (levelCfg как раньше);
 *  - стартовый снег по ходу кома: даже без управления ком растёт в первые секунды;
 *  - первый запуск — сразу меню (подарок дня — только после первого забега, при возврате в меню);
 *  - межстраничная реклама: первое «Играть» без неё; не раньше конца 2-го уровня или после 4 забегов;
 *  - рука «тяни пальцем» на первом забеге до первого движения; текст внизу не закрывает ком (портрет и альбом);
 *  - первая победа: подарок до 150 монет и кнопка «Хватает на скин «Лёд» — открой в магазине»;
 *  - отметки статистики уходят через Bridge (подставной `window.__analyticsBridge`): progression_*, first_input,
 *    tutorial_completed, retry_pressed, shop_opened, skin_unlocked, performance_sample.
 *
 *   python3 -m http.server 8131 &            (из корня репозитория — исходники, режим заглушки без площадки)
 *   GAME_URL=http://127.0.0.1:8131/index.html NODE_PATH=$(npm root -g) node tests/start.js
 *
 * До правки (симуляция 30 попыток, 18.11): ур. 1 — новичок выигрывал 14/30, обычный 22/30, хороший 29/30;
 * победа через ~37–40 с, проигрыш на ~21-й секунде.
 */
const { chromium } = require('playwright');
const URL = process.env.GAME_URL || 'http://127.0.0.1:8131/index.html';
const TRIALS = +process.env.TRIALS || 40;
const results = [];
function check(name, ok, extra) { results.push((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + extra : '')); }

async function open(browser, viewport, { save } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'ru-RU', hasTouch: false, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(s => {
    window.__ev = [];
    window.__analyticsBridge = { analytics: { send(n, d) { window.__ev.push([n, d]); } } };
    if (s) localStorage.setItem('snowball_save', JSON.stringify(s));
  }, save || null);
  await page.goto(URL);
  await page.waitForFunction(() => window.SBGame && ['menu', 'daily'].includes(SBGame.debug().mode));
  // реклама: считаем вызовы межстраничной
  await page.evaluate(() => { window.__fs = 0; YSDK.showFullscreen = () => { window.__fs++; return Promise.resolve(false); }; });
  return { ctx, page, errors };
}
const mode = page => page.evaluate(() => SBGame.debug().mode);
const ev = (page, name) => page.evaluate(n => window.__ev.filter(e => e[0] === n).map(e => e[1]), name);
const tap = async (page, id) => { await page.click('#' + id); await page.waitForTimeout(150); };

(async () => {
  const browser = await chromium.launch();

  // ---------- 1. Симуляция модельных игроков (тот же код игры, фиксированный шаг) ----------
  {
    const { ctx, page } = await open(browser, { width: 390, height: 844 }, { save: { daily: 'x', hinted: true, games: 1 } });
    const sim = await page.evaluate(TRIALS => {
      const G = window.__game;
      const models = {
        novice: { react: 0.6, err: 0.35, look: 350, care: 0.5 },
        casual: { react: 0.35, err: 0.15, look: 500, care: 0.8 },
        good: { react: 0.08, err: 0, look: 900, care: 1 },
      };
      function choose(m) {
        const ball = G.ball, z = G.S.z, lim = Math.max(0, (innerWidth / 2) / z - ball.r);
        if (Math.random() < m.err) return (Math.random() * 2 - 1) * lim;
        let best = ball.x, bestV = -1e9;
        for (let i = 0; i <= 24; i++) {
          const x = -lim + (2 * lim) * i / 24;
          let v = -Math.abs(x - ball.x) * 0.002;
          for (const o of G.objs) {
            if (o.dead || o.y < -ball.r || o.y > m.look / z || Math.abs(o.x - x) >= ball.r + o.r + 6 / z) continue;
            const w = 1 / (1 + Math.max(0, o.y) * z / 300);
            if (o.type === 'snow') v += 3 * w; else if (o.type === 'coin') v += w;
            else if (o.type === 'magnet' || o.type === 'shield') v += 4 * w;
            else if (o.type === 'fire') v -= 40 * w * m.care;
            else if (o.type === 'finish' || o.type === 'boss') continue;
            else if (ball.shield > 0 || ball.r >= o.size * 0.92) v += 2 * w; else v -= 60 * w * m.care;
          }
          if (v > bestV) { bestV = v; best = x; }
        }
        return best;
      }
      const out = {};
      for (const [name, m] of Object.entries(models)) {
        let wins = 0, tWin = 0, fires = 0;
        for (let k = 0; k < TRIALS; k++) {
          G.startRun('level', 1);
          let tNext = 0;
          while (G.S.mode === 'play' && G.S.t < 200) {
            if (G.S.t >= tNext) { G.ball.targetX = choose(m); tNext = G.S.t + m.react; }
            G.update(1 / 60);
            fires += G.objs.filter(o => o.type === 'fire').length ? 1 : 0;
          }
          if (G.S.mode === 'win') { wins++; tWin += G.S.t; }
        }
        out[name] = { wins, tWin: wins ? tWin / wins : 0, fires };
      }
      // без управления: растёт ли ком в первые 3 секунды
      G.startRun('level', 1);
      const r0 = G.ball.r;
      let rMax = r0;
      while (G.S.t < 3 && G.S.mode === 'play') { G.update(1 / 60); rMax = Math.max(rMax, G.ball.r); }
      out.idleGrow = rMax / r0;
      // уровни с 4-го — как до правки
      const old = n => ({ dur: Math.min(38 + n * 2, 70), r2: 20 * (3.5 + Math.min(n, 30) * 0.17), r3: 20 * (7 + Math.min(n, 30) * 0.35) });
      out.sameAfter3 = [4, 5, 6, 10, 15, 25, 30].every(n => { const c = G.levelCfg(n), o = old(n); return c.ease === 0 && c.dur === o.dur && Math.abs(c.r2 - o.r2) < 1e-9 && Math.abs(c.r3 - o.r3) < 1e-9; });
      out.l1 = G.levelCfg(1).dur; out.l2 = G.levelCfg(2).dur; out.l3 = G.levelCfg(3).dur;
      return out;
    }, TRIALS);
    const pct = w => Math.round(w / TRIALS * 100);
    check('ур. 1: новичок выигрывает чаще, чем до правки (было 47%)', pct(sim.novice.wins) >= 80, pct(sim.novice.wins) + '%');
    check('ур. 1: обычный игрок выигрывает чаще, чем до правки (было 73%)', pct(sim.casual.wins) >= 90, pct(sim.casual.wins) + '%');
    check('ур. 1: хороший игрок выигрывает (было 97%)', pct(sim.good.wins) >= 95, pct(sim.good.wins) + '%');
    check('ур. 1: первая победа за 20–32 с (было ~37–40 с)', sim.casual.tWin >= 20 && sim.casual.tWin <= 32, sim.casual.tWin.toFixed(1) + ' с');
    check('ур. 1: костров нет', sim.novice.fires + sim.casual.fires + sim.good.fires === 0);
    check('ур. 1–3 короче, чем было (40/42/44 с)', sim.l1 < 30 && sim.l2 < 36 && sim.l3 < 42, [sim.l1, sim.l2, sim.l3].map(v => v.toFixed(1)).join(' / '));
    check('уровни с 4-го не изменились', sim.sameAfter3);
    check('без управления ком растёт в первые 3 с (снег по ходу)', sim.idleGrow > 1.3, '×' + sim.idleGrow.toFixed(2));
    await ctx.close();
  }

  // ---------- 2. Новый игрок: меню, реклама, рука, первая победа, статистика ----------
  for (const [tag, vp] of [['портрет', { width: 390, height: 844 }], ['альбом', { width: 844, height: 390 }]]) {
    const { ctx, page, errors } = await open(browser, vp);
    const full = tag === 'портрет';
    check(`${tag}: первый запуск — сразу меню, без подарка дня`, (await mode(page)) === 'menu', await mode(page));
    await tap(page, 'playBtn');
    check(`${tag}: первое «Играть» — без межстраничной рекламы`, (await page.evaluate(() => window.__fs)) === 0);
    check(`${tag}: забег начался, рука-подсказка показана`, (await mode(page)) === 'play' && await page.evaluate(() => __game.S.tutor === true));
    // текст подсказки внизу и не закрывает ком
    const geo = await page.evaluate(() => {
      const r = document.getElementById('toast').getBoundingClientRect();
      const s = Math.min(innerWidth / 480, innerHeight / 820);
      const by = innerHeight * 0.3, br = __game.ball.r * __game.S.z * s;
      return { shown: getComputedStyle(document.getElementById('toast')).display !== 'none', top: r.top, ballBottom: by + br, text: document.getElementById('toast').textContent };
    });
    check(`${tag}: текст «Тяни пальцем…» показан и ниже кома`, geo.shown && /Тяни/.test(geo.text) && geo.top > geo.ballBottom + 20, `toast top ${Math.round(geo.top)} > ball ${Math.round(geo.ballBottom)}`);
    if (full) await page.screenshot({ path: (process.env.SHOTS || '/tmp') + '/start-hand-portrait.png' });
    else await page.screenshot({ path: (process.env.SHOTS || '/tmp') + '/start-hand-landscape.png' });
    // ведём ком мышью — рука исчезает
    const cx = vp.width / 2, cy = vp.height * 0.6;
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 60, cy, { steps: 6 }); await page.mouse.move(cx - 40, cy, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(100);
    check(`${tag}: после движения рука убрана, подсказка запомнена`, await page.evaluate(() => __game.S.tutor === false && __game.save.hinted === true));
    if (full) {
      check('статистика: progression_started (ур. 1, «Играть»)', (await ev(page, 'progression_started')).some(d => d.level_id === '1' && d.step_index === 1 && d.source === 'play' && d.attempt === 1));
      check('статистика: first_input', (await ev(page, 'first_input')).length === 1);
      check('статистика: tutorial_completed (секунды от старта забега)', (await ev(page, 'tutorial_completed')).some(d => typeof d.seconds === 'number'));
      // выход в меню посреди уровня: progression_failed reason=quit, потом подарок дня
      await page.evaluate(() => document.getElementById('pauseBtn').click());
      await tap(page, 'pauseMenuBtn');
      check('статистика: progression_failed (quit, прогресс в %)', (await ev(page, 'progression_failed')).some(d => d.reason === 'quit' && d.level_id === '1' && typeof d.progress_pct === 'number'));
      check('после первого забега, в меню — подарок дня', (await mode(page)) === 'daily', await mode(page));
      await tap(page, 'dailyClaim');
      await tap(page, 'playBtn');
      check('второе «Играть» (1 забег, ур. 1) — без рекламы', (await page.evaluate(() => window.__fs)) === 0);
      check('рука не показывается снова', await page.evaluate(() => __game.S.tutor === false));
      // первая победа: доезжаем до финиша
      await page.evaluate(() => { __game.S.dist = __game.S.cfg.len - 200; __game.ball.r = 60; __game.ball.shield = 30; });
      await page.waitForFunction(() => SBGame.debug().mode === 'win', null, { timeout: 15000 });
      await page.waitForTimeout(300);
      const w = await page.evaluate(() => ({
        coins: __game.save.coins, bonus: !document.getElementById('winBonus').hidden, bonusText: document.getElementById('winBonus').textContent,
        shop: !document.getElementById('winShop').hidden, shopText: document.getElementById('winShop').textContent,
      }));
      check('первая победа: монет хватает на «Лёд» (150)', w.coins >= 150, w.coins);
      check('первая победа: строка «Подарок за первую победу»', w.bonus && /Подарок/.test(w.bonusText), w.bonusText);
      check('первая победа: кнопка «…открой в магазине»', w.shop && /Лёд/.test(w.shopText), w.shopText);
      check('статистика: progression_completed (звёзды, first_clear)', (await ev(page, 'progression_completed')).some(d => d.level_id === '1' && d.stars >= 1 && d.first_clear === true));
      await page.screenshot({ path: (process.env.SHOTS || '/tmp') + '/start-first-win.png' });
      await tap(page, 'winShop');
      check('кнопка ведёт в магазин', (await mode(page)) === 'shop');
      check('статистика: shop_opened (win_first)', (await ev(page, 'shop_opened')).some(d => d.source === 'win_first'));
      // покупаем «Лёд»
      await page.locator('#shopList .card').nth(1).locator('button').first().click();
      check('«Лёд» куплен', await page.evaluate(() => __game.save.owned.includes('ice')));
      check('статистика: skin_unlocked (ice, coins)', (await ev(page, 'skin_unlocked')).some(d => d.skin_id === 'ice' && d.how === 'coins'));
      await tap(page, 'shopBack');
      // реклама: ур. 2 после прохождения 1-го — ещё нет; после 2-го — да
      await tap(page, 'playBtn');
      check('ур. 2 (пройден только 1-й) — без рекламы', (await page.evaluate(() => window.__fs)) === 0);
      await page.evaluate(() => { __game.S.dist = __game.S.cfg.len - 200; __game.ball.r = 65; __game.ball.shield = 30; });
      await page.waitForFunction(() => SBGame.debug().mode === 'win', null, { timeout: 15000 });
      check('второй победе подарка и кнопки магазина нет', await page.evaluate(() => document.getElementById('winBonus').hidden && document.getElementById('winShop').hidden));
      await tap(page, 'winRetry');
      check('статистика: retry_pressed (с экрана победы)', (await ev(page, 'retry_pressed')).some(d => d.screen === 'win' && d.level_id === '2'));
      check('после конца 2-го уровня — межстраничная показывается', (await page.evaluate(() => window.__fs)) === 1, await page.evaluate(() => window.__fs));
      check('статистика: progression_started source=retry, attempt=2', (await ev(page, 'progression_started')).some(d => d.source === 'retry' && d.level_id === '2' && d.attempt === 2));
      // performance_sample: модуль собирает кадры только в игре; подаём ~31 с кадров
      await page.evaluate(() => { let ts = 1e6; for (let i = 0; i < 1900; i++) { ts += 16.7; GameAnalytics.frame(ts, true); } });
      const ps = await ev(page, 'performance_sample');
      check('статистика: performance_sample с версией 1.0.1', ps.length >= 1 && ps[0].target_fps === 60 && ps[0].frame_count > 0 && ps[0].game_version === '1.0.1', JSON.stringify(ps[0] || {}).slice(0, 120));
      const bad = (await page.evaluate(() => window.__ev)).filter(([n, d]) => /\d/.test(n) || Object.values(d).some(v => typeof v === 'object'));
      check('статистика: в именах нет номеров, данные плоские', bad.length === 0, JSON.stringify(bad).slice(0, 200));
    }
    check(`${tag}: нет ошибок в консоли`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- 3. Застрявший игрок: реклама после 4 забегов ----------
  {
    const { ctx, page } = await open(browser, { width: 390, height: 844 }, { save: { daily: 'x', hinted: true, games: 3, level: 1 } });
    if ((await mode(page)) === 'daily') await tap(page, 'dailyClaim');
    await tap(page, 'playBtn');
    check('3 забега на ур. 1 — ещё без рекламы', (await page.evaluate(() => window.__fs)) === 0);
    await page.evaluate(() => document.getElementById('pauseBtn').click());
    await tap(page, 'pauseMenuBtn');
    if ((await mode(page)) === 'daily') await tap(page, 'dailyClaim');
    await tap(page, 'playBtn');
    check('после 4 забегов (застрял на ур. 1) — межстраничная есть', (await page.evaluate(() => window.__fs)) === 1);
    await ctx.close();
  }

  // ---------- 4. Альбом: меню и кнопки «дальше» на победе и проигрыше видны целиком без прокрутки ----------
  for (const vp of [{ width: 844, height: 390 }, { width: 740, height: 360 }]) {
    const tag = vp.width + '×' + vp.height;
    const { ctx, page } = await open(browser, vp);
    const fits = id => page.evaluate(id => {
      const e = document.getElementById(id), r = e.getBoundingClientRect();
      return !e.hidden && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }, id);
    const win = async r => {
      await page.evaluate(r => { __game.S.dist = __game.S.cfg.len - 200; __game.ball.r = r; __game.ball.shield = 30; }, r);
      await page.waitForFunction(() => SBGame.debug().mode === 'win', null, { timeout: 15000 });
      await page.waitForTimeout(400);
    };
    // меню: все кнопки на экране и ничем не закрыты (и «Пригласить», как во ВК/ОК)
    const menuIds = ['playBtn', 'levelsBtn', 'shopBtn', 'endlessBtn', 'sndBtn', 'musBtn'];
    check(`${tag}: меню — все кнопки видны целиком`, (await Promise.all(menuIds.map(fits))).every(Boolean));
    await page.evaluate(() => { document.getElementById('inviteBtn').hidden = false; });
    check(`${tag}: меню с «Пригласить» (ВК/ОК) — все кнопки видны целиком`, (await Promise.all([...menuIds, 'inviteBtn'].map(fits))).every(Boolean));
    await page.evaluate(() => { document.getElementById('inviteBtn').hidden = true; });
    await tap(page, 'playBtn');
    await win(60);
    check(`${tag}: первая победа (с подарком) — «Уровень 2» видна целиком`, await fits('winNext'));
    check(`${tag}: первая победа — кнопка магазина видна целиком`, await fits('winShop'));
    await tap(page, 'winNext');
    await win(65);
    check(`${tag}: вторая победа — «Уровень 3» видна целиком`, await fits('winNext'));
    await tap(page, 'winNext');
    await page.evaluate(() => { __game.ball.r = 5; });
    await page.waitForFunction(() => ['over', 'revive'].includes(SBGame.debug().mode));
    if ((await mode(page)) === 'revive') await tap(page, 'reviveSkip');
    await page.waitForTimeout(300);
    check(`${tag}: проигрыш — «Ещё раз» видна целиком`, await fits('againBtn'));
    await ctx.close();
  }

  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
