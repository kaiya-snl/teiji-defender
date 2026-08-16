/* ==========================================================
   定時退社ディフェンダー - ゲーム本体
   Canvas 2D + バニラJSのみ（外部ライブラリなし）。
   内部解像度は 360x480 固定。CSS側で表示サイズを可変にし、
   タップ座標は getBoundingClientRect の比率で内部座標へ変換する。
   ========================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---------- 画面要素キャッシュ ----------
  const EL = {
    btnStart: $('btn-start'), titleBestday: $('title-bestday'), titleCoins: $('title-coins'),
    btnOpenShopTitle: $('btn-open-shop-title'),
    stageIntroDay: $('stage-intro-day'), stageIntroMsg: $('stage-intro-msg'), btnStageGo: $('btn-stage-go'),
    hudDay: $('hud-day'), hudClock: $('hud-clock'), hudCoins: $('hud-coins'),
    hpInner: $('hp-bar-inner'), hpLabel: $('hp-bar-label'), loadout: $('loadout-row'),
    canvas: $('game-canvas'),
    bossDialogue: $('boss-dialogue'), bossDialogueName: $('boss-dialogue-name'), bossDialogueText: $('boss-dialogue-text'),
    btnLectureSkip: $('btn-lecture-skip'),
    btnUltimate: $('btn-ultimate'), ultGauge: $('ult-gauge-inner'),
    btnOpenShop: $('btn-open-shop'), btnPause: $('btn-pause'),
    shopCoins: $('shop-coins'), shopList: $('shop-list'), btnShopClose: $('btn-shop-close'),
    btnResume: $('btn-resume'), btnOpenShopPause: $('btn-open-shop-pause'), btnQuitTitle: $('btn-quit-title'),
    clearMsg: $('stage-clear-msg'), clearCoins: $('clear-coins'), btnNextDay: $('btn-next-day'),
    allclearCoins: $('allclear-coins'), btnRestartWeek: $('btn-restart-week'),
    gameoverMsg: $('gameover-msg'), btnWatchAdContinue: $('btn-watch-ad-continue'),
    btnRetryDay: $('btn-retry-day'), btnGameoverTitle: $('btn-gameover-title'),
    adRewardModal: $('ad-reward-modal'), adRewardCountdown: $('ad-reward-countdown'),
  };

  const ctx = EL.canvas.getContext('2d');
  const CW = 360, CH = 480, COLS = 3, COL_W = CW / COLS;
  const DEFENSE_LINE_Y = 420; // 防衛ライン。ここを敵が越えるとダメージ
  EL.canvas.width = CW; EL.canvas.height = CH;

  const DAY_NAMES = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日'];
  const BOSS_TRIGGER_FRAC = 0.85; // 金曜のこの経過割合でボス出現

  // ---------- データテーブル ----------
  // speed は縦方向（上→下）の落下速度(px/s)。防衛ラインまでの距離は約440px。
  const ENEMY_TYPES = {
    spec:        { emoji: '📧', name: '急な仕様変更',     hp: 18, speed: 90,  dmg: 8,  coin: 4, w: 34 },
    nagabanashi: { emoji: '🗣️', name: '上司の長話',       hp: 70, speed: 35,  dmg: 16, coin: 14, w: 38 },
    error:       { emoji: '❓', name: '謎のエラー',       hp: 26, speed: 120, dmg: 10, coin: 7, w: 32, zigzag: true },
    denwa:       { emoji: '☎️', name: '鳴り止まない電話', hp: 12, speed: 100, dmg: 6,  coin: 3, w: 30 },
    cc:          { emoji: '📩', name: 'CC祭りメール',     hp: 6,  speed: 70,  dmg: 3,  coin: 2, w: 26 },
    kaigi:       { emoji: '📅', name: '至急ミーティング', hp: 34, speed: 25,  dmg: 12, coin: 6, w: 34 },
  };

  const ITEM_TYPES = {
    bento:  { emoji: '🍱', name: '手作りお弁当',     effect: 'heal', value: 35 },
    coffee: { emoji: '☕', name: '高級コーヒー',     effect: 'slow', value: 0.5, duration: 4000 },
    vision: { emoji: '🌅', name: '定時後のビジョン', effect: 'coinboost', value: 2, duration: 6000 },
    cat:    { emoji: '🐈', name: '癒しの猫',         effect: 'fullheal_invincible', duration: 2500 },
  };

  const UPGRADES = [
    { key: 'pc',        name: '高スペックPC',               icon: '💻', desc: '攻撃力アップ',                       baseCost: 20, costMul: 1.6, effectPerLv: 4,  maxLv: 12 },
    { key: 'monitor',   name: 'デュアルモニター',           icon: '🖥️', desc: '隣接レーンにも攻撃が波及する',       baseCost: 35, costMul: 1.8, maxLv: 3 },
    { key: 'tool',      name: '有償ツール',                 icon: '🛠️', desc: '会心の一撃（2倍ダメージ）の確率アップ', baseCost: 25, costMul: 1.7, effectPerLv: 8,  maxLv: 10 },
    { key: 'headphone', name: 'ノイズキャンセリングイヤホン', icon: '🎧', desc: '「上司の長話」の被ダメを軽減',       baseCost: 30, costMul: 1.7, effectPerLv: 10, maxLv: 8 },
  ];

  // 金曜ボス「帰り際の上司」: フェーズは hpAbove の降順で判定する
  const BOSS = {
    name: '帰り際の上司',
    maxHp: 480,
    phases: [
      { kind: 'rush',     hpAbove: 0.7,  line: 'あ、ちょっといい? 5分だけいい?',                 interval: 900, dmg: 5 },
      { kind: 'summon',   hpAbove: 0.4,  line: 'これ、一旦みんなで集まって認識合わせしよっか', count: 4 },
      { kind: 'lecture',  hpAbove: 0.15, line: 'いや、そもそも論になっちゃうんだけどさ' },
      { kind: 'finisher', hpAbove: 0,    line: 'これ、土曜出社とかできたりする…よね?',           dmg: 40 },
    ],
    defeatLine: '（真顔で）……了解、お疲れ様。良い週末を。',
  };

  const STAGE_INTRO_LINES = [
    '今週も始まった。まずは月曜を乗り切ろう。',
    '火曜日。昨日の疲れが残っているが、やるしかない。',
    '週の折り返し、水曜日。ここが踏ん張りどころ。',
    '木曜日。あと少しで週末……のはずだったが。',
    '金曜日。今日を乗り切れば週末だ。だが、何かが待っている気配がする……',
  ];
  const STAGE_CLEAR_LINES = [
    'よく耐えた。月曜はいつもキツい。',
    '週の折り返し前、まだいける。',
    '木曜の壁を、また一つ越えた。',
    '明日はいよいよ金曜日……。',
    '', // 金曜は allclear 画面を使うため未使用
  ];
  const GAMEOVER_LINES = [
    'メンタルが尽きてしまった。月曜から厳しい……。',
    'メンタルが尽きてしまった。火曜も油断できない。',
    'メンタルが尽きてしまった。折り返し地点で力尽きた。',
    'メンタルが尽きてしまった。木曜の壁は厚い。',
    '上司「よし、じゃあ夜ご飯奢るから」……いや、そういう話じゃない。',
  ];

  // ---------- 状態 ----------
  let S = null;
  let upgrades = { pc: 0, monitor: 0, tool: 0, headphone: 0 };
  let bestDay = 0; // 到達済みの最高クリア日数（1〜5）
  let bossLineTimeout = null;

  function freshState() {
    return {
      state: 'title', day: 0, hp: 100, maxHp: 100, coins: 0, runCoins: 0,
      elapsed: 0, stageDuration: 80000, lunchActive: false,
      entities: [], items: [], fx: [],
      ultGauge: 0, invincibleUntil: 0, slowUntil: 0, slowFactor: 1, coinBoostUntil: 0,
      spawnTimer: 600, itemTimer: 3000,
      bossActive: false, boss: null, bossPhaseIndex: -1,
      lectureActive: false, lectureTimer: 0,
      shopReturn: 'title', lastTime: 0,
    };
  }
  S = freshState();

  // ---------- セーブデータ（コイン・強化・最高記録のみ永続化） ----------
  function loadSave() {
    try {
      const c = localStorage.getItem('tdd_coins');
      S.coins = c ? (parseInt(c, 10) || 0) : 0;
      const u = localStorage.getItem('tdd_upgrades');
      if (u) upgrades = Object.assign(upgrades, JSON.parse(u));
      const b = localStorage.getItem('tdd_bestday');
      bestDay = b ? (parseInt(b, 10) || 0) : 0;
    } catch (e) {
      console.warn('セーブデータの読み込みに失敗しました（プライベートブラウズ等の可能性）', e);
    }
  }
  function saveProgress() {
    try {
      localStorage.setItem('tdd_coins', String(S.coins));
      localStorage.setItem('tdd_upgrades', JSON.stringify(upgrades));
      localStorage.setItem('tdd_bestday', String(bestDay));
    } catch (e) {
      console.warn('セーブデータの保存に失敗しました', e);
    }
  }

  // ---------- 画面切替 ----------
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
    $(id).classList.remove('hidden');
  }

  function goTitle() {
    S.state = 'title';
    EL.titleBestday.textContent = bestDay >= 5 ? '最高記録: 全クリア達成！'
      : bestDay > 0 ? `最高記録: ${DAY_NAMES[bestDay - 1]}クリア` : '最高記録: -';
    EL.titleCoins.textContent = `所持コイン: ${S.coins}`;
    showScreen('screen-title');
  }

  function goStageIntro() {
    S.state = 'intro';
    EL.stageIntroDay.textContent = DAY_NAMES[S.day];
    EL.stageIntroMsg.textContent = STAGE_INTRO_LINES[S.day];
    showScreen('screen-stage-intro');
  }

  function resetStageState() {
    const keepCoins = S.coins;
    const day = S.day;
    S = freshState();
    S.coins = keepCoins;
    S.day = day;
    EL.bossDialogue.classList.add('hidden');
    EL.btnLectureSkip.classList.add('hidden');
  }

  function beginStagePlay() {
    resetStageState();
    S.state = 'playing';
    showScreen('screen-playing');
    updateHUD();
  }

  // ---------- HUD ----------
  function updateHUD() {
    EL.hudDay.textContent = DAY_NAMES[S.day];
    EL.hudCoins.textContent = `💰${S.coins}`;
    const pct = Math.max(0, S.hp) / S.maxHp * 100;
    EL.hpInner.style.width = pct + '%';
    EL.hpInner.style.background = pct > 50 ? 'var(--color-hp-high)' : pct > 20 ? 'var(--color-hp-mid)' : 'var(--color-hp-low)';
    EL.hpLabel.textContent = `HP ${Math.max(0, Math.round(S.hp))}/${S.maxHp}`;
    EL.ultGauge.style.width = S.ultGauge + '%';
    EL.btnUltimate.disabled = S.ultGauge < 100;
    EL.loadout.innerHTML = UPGRADES.map((u) => {
      const lv = upgrades[u.key] || 0;
      return `<span class="${lv > 0 ? 'lv-active' : ''}">${u.icon}Lv.${lv}</span>`;
    }).join('');
  }

  function displayClock(hourFloat) {
    const h = Math.floor(hourFloat);
    const m = Math.floor((hourFloat - h) * 60);
    EL.hudClock.textContent = `${h}:${String(m).padStart(2, '0')}`;
  }

  function spawnFx(x, y, text, color, life) {
    life = life || 800;
    S.fx.push({ x, y, text, color, life, maxLife: life });
  }

  function flashScreenDamage() {
    EL.canvas.style.filter = 'brightness(1.6) saturate(0.3)';
    setTimeout(() => { EL.canvas.style.filter = ''; }, 120);
  }

  // ---------- 敵・アイテムのスポーン ----------
  function pickWeighted(pairs) {
    const total = pairs.reduce((s, p) => s + p[1], 0);
    let r = Math.random() * total;
    for (const [k, w] of pairs) { if (r < w) return k; r -= w; }
    return pairs[0][0];
  }

  function currentEnemyPool() {
    const pool = [['spec', 5], ['error', 3], ['denwa', 3], ['nagabanashi', 2]];
    if (S.day >= 2) pool.push(['kaigi', 2]);
    return pool;
  }

  function spawnOne(key) {
    const def = ENEMY_TYPES[key];
    const lane = Math.floor(Math.random() * COLS);
    const hpMul = 1 + S.day * 0.16;
    const spMul = 1 + S.day * 0.10;
    S.entities.push({
      key, lane, x: lane * COL_W + COL_W / 2, y: -24,
      hp: Math.round(def.hp * hpMul), maxHp: Math.round(def.hp * hpMul),
      speed: def.speed * spMul, dmg: def.dmg, coin: def.coin, w: def.w,
      zigzag: !!def.zigzag, zigT: Math.random() * Math.PI * 2, flash: 0,
    });
  }

  function spawnGroup(key, count) {
    for (let i = 0; i < count; i++) {
      setTimeout(() => { if (S.state === 'playing') spawnOne(key); }, i * 150);
    }
  }

  function maybeSpawnEnemy(dt) {
    if (S.lunchActive || S.bossActive) return;
    S.spawnTimer -= dt;
    if (S.spawnTimer <= 0) {
      if (Math.random() < 0.12) {
        spawnGroup('cc', 3 + Math.floor(Math.random() * 3));
      } else {
        spawnOne(pickWeighted(currentEnemyPool()));
      }
      const base = 1400 - S.day * 150;
      S.spawnTimer = Math.max(420, base + (Math.random() * 400 - 200));
    }
  }

  function spawnItem() {
    let key;
    const r = Math.random();
    if (r < 0.04) key = 'cat';
    else if (r < 0.40) key = 'bento';
    else if (r < 0.75) key = 'coffee';
    else key = 'vision';
    const lane = Math.floor(Math.random() * COLS);
    S.items.push({ key, lane, x: lane * COL_W + COL_W / 2, y: -24, speed: 65 });
  }

  function maybeSpawnItem(dt) {
    if (S.bossActive) return;
    S.itemTimer -= dt;
    if (S.itemTimer <= 0) {
      spawnItem();
      S.itemTimer = S.lunchActive ? (1800 + Math.random() * 800) : (6000 + Math.random() * 3000);
    }
  }

  // ---------- ダメージ計算 ----------
  function computeAttackDamage() {
    const pcU = UPGRADES.find((u) => u.key === 'pc');
    const toolU = UPGRADES.find((u) => u.key === 'tool');
    let dmg = 8 + upgrades.pc * pcU.effectPerLv;
    const critChance = Math.min(80, upgrades.tool * toolU.effectPerLv);
    let crit = false;
    if (Math.random() * 100 < critChance) { dmg *= 2; crit = true; }
    return { dmg: Math.round(dmg), crit };
  }

  function killEnemy(e) {
    let coin = e.coin;
    if (performance.now() < S.coinBoostUntil) coin *= 2;
    S.coins += coin; S.runCoins += coin;
    S.ultGauge = Math.min(100, S.ultGauge + 8);
    spawnFx(e.x, e.y, `+${coin}💰`, '#ffd54f');
    S.entities = S.entities.filter((x) => x !== e);
    updateHUD();
  }

  function splashAdjacent(e) {
    const pct = [0, 0.5, 0.75, 1.0][Math.min(upgrades.monitor, 3)];
    if (pct <= 0) return;
    for (const other of S.entities.slice()) {
      if (other === e || Math.abs(other.lane - e.lane) !== 1) continue;
      const { dmg } = computeAttackDamage();
      const splash = Math.round(dmg * pct);
      other.hp -= splash; other.flash = 100;
      spawnFx(other.x, other.y - 16, `-${splash}`, '#9fd8ff');
      if (other.hp <= 0) killEnemy(other);
    }
  }

  function hitEnemy(e) {
    const { dmg, crit } = computeAttackDamage();
    e.hp -= dmg; e.flash = 120;
    spawnFx(e.x, e.y - 16, crit ? `会心!-${dmg}` : `-${dmg}`, crit ? '#ffdd55' : '#fff');
    if (e.hp <= 0) killEnemy(e);
    if (upgrades.monitor > 0) splashAdjacent(e);
  }

  function collectItem(it) {
    const def = ITEM_TYPES[it.key];
    spawnFx(it.x, it.y, def.name, '#8fe3ff', 900);
    if (def.effect === 'heal') S.hp = Math.min(S.maxHp, S.hp + def.value);
    else if (def.effect === 'slow') { S.slowUntil = performance.now() + def.duration; S.slowFactor = def.value; }
    else if (def.effect === 'coinboost') S.coinBoostUntil = performance.now() + def.duration;
    else if (def.effect === 'fullheal_invincible') { S.hp = S.maxHp; S.invincibleUntil = performance.now() + def.duration; }
    updateHUD();
  }

  function applyDamageToPlayer(dmg) {
    if (performance.now() < S.invincibleUntil) return;
    S.hp = Math.max(0, S.hp - dmg);
    updateHUD();
    flashScreenDamage();
    if (S.hp <= 0) gameOver();
  }

  function useUltimate() {
    if (S.ultGauge < 100) return;
    S.ultGauge = 0;
    S.invincibleUntil = performance.now() + 5000;
    for (const e of S.entities) { const c = Math.ceil(e.coin / 2); S.coins += c; S.runCoins += c; }
    S.entities = [];
    spawnFx(CW / 2, CH / 2, 'ショートカットキー全開放!!', '#ffd54f', 1200);
    updateHUD();
  }

  // ---------- ボス ----------
  function showBossLine(name, text) {
    EL.bossDialogueName.textContent = name;
    EL.bossDialogueText.textContent = text;
    EL.bossDialogue.classList.remove('hidden');
    if (bossLineTimeout) clearTimeout(bossLineTimeout);
    bossLineTimeout = setTimeout(() => EL.bossDialogue.classList.add('hidden'), 4200);
  }

  function updateBossTrigger() {
    if (S.bossActive || S.boss) return;
    if (S.elapsed / S.stageDuration >= BOSS_TRIGGER_FRAC) startBoss();
  }

  function startBoss() {
    S.bossActive = true;
    displayClock(9 + BOSS_TRIGGER_FRAC * 9);
    S.boss = { hp: BOSS.maxHp, maxHp: BOSS.maxHp, timer: 0, finisherDone: false };
    S.bossPhaseIndex = -1;
    S.entities = []; // ボス突入時、雑魚は一旦クリア
    showBossLine(BOSS.name, BOSS.phases[0].line);
  }

  function spawnBossAdds(count) {
    for (let i = 0; i < count; i++) {
      setTimeout(() => { if (S.bossActive) spawnOne('kaigi'); }, i * 200);
    }
  }

  function enterBossPhase(idx) {
    S.bossPhaseIndex = idx;
    const p = BOSS.phases[idx];
    S.boss.timer = 0;
    S.boss.finisherDone = false;
    showBossLine(BOSS.name, p.line);
    if (p.kind === 'summon') spawnBossAdds(p.count);
    S.lectureActive = p.kind === 'lecture';
    if (S.lectureActive) {
      S.lectureTimer = 6000;
      EL.btnLectureSkip.classList.remove('hidden');
    } else {
      EL.btnLectureSkip.classList.add('hidden');
    }
  }

  function endLecture() {
    S.lectureActive = false;
    EL.btnLectureSkip.classList.add('hidden');
  }

  function updateBoss(dt) {
    const b = S.boss;
    const hpRatio = Math.max(b.hp, 0) / b.maxHp;
    let idx = BOSS.phases.findIndex((p) => hpRatio > p.hpAbove);
    if (idx === -1) idx = BOSS.phases.length - 1;
    if (idx !== S.bossPhaseIndex) enterBossPhase(idx);
    const p = BOSS.phases[idx];
    b.timer += dt;

    if (S.lectureActive) {
      S.lectureTimer -= dt;
      if (S.lectureTimer <= 0) endLecture();
      return;
    }
    if (p.kind === 'rush') {
      if (b.timer >= p.interval) { b.timer = 0; applyDamageToPlayer(p.dmg); }
    } else if (p.kind === 'finisher' && !b.finisherDone && b.timer >= 2200) {
      b.finisherDone = true;
      if (performance.now() < S.invincibleUntil) spawnFx(CW / 2, 60, '無効化！', '#8fe3ff', 1000);
      else applyDamageToPlayer(p.dmg);
    }
  }

  function hitBoss() {
    if (!S.boss || S.boss.hp <= 0) return;
    if (S.lectureActive && Math.random() < 0.5) { spawnFx(CW / 2, 190, '届かない…', '#888', 600); return; }
    const { dmg, crit } = computeAttackDamage();
    S.boss.hp -= dmg;
    spawnFx(CW / 2, 130, crit ? `会心!-${dmg}` : `-${dmg}`, crit ? '#ffdd55' : '#fff', 700);
    if (S.boss.hp <= 0) defeatBoss();
  }

  function defeatBoss() {
    S.bossActive = false;
    S.entities = [];
    showBossLine(BOSS.name, BOSS.defeatLine);
    setTimeout(() => stageClear(true), 1600);
  }

  // ---------- 入力 ----------
  function onCanvasPointer(clientX, clientY) {
    if (S.state !== 'playing') return;
    const rect = EL.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (CW / rect.width);
    const y = (clientY - rect.top) * (CH / rect.height);

    if (S.bossActive && S.boss) {
      if (Math.hypot(x - CW / 2, y - 110) < 46) { hitBoss(); return; }
    }
    for (let i = S.items.length - 1; i >= 0; i--) {
      const it = S.items[i];
      if (Math.hypot(x - it.x, y - it.y) < 34) { collectItem(it); S.items.splice(i, 1); return; }
    }
    // タップ判定は見た目の当たり判定より一回り広くして、指でも押しやすくする
    let target = null, best = 999;
    for (const e of S.entities) {
      const d = Math.hypot(x - e.x, y - e.y);
      if (d < e.w + 18 && d < best) { best = d; target = e; }
    }
    if (target) hitEnemy(target);
  }

  // ---------- メイン更新 ----------
  function updateClockAndLunch() {
    if (S.bossActive) return;
    const frac = Math.min(S.elapsed / S.stageDuration, 1);
    const hour = 9 + frac * 9;
    S.lunchActive = hour >= 12 && hour < 13;
    displayClock(hour);
  }

  function checkStageProgress() {
    if (S.state !== 'playing') return;
    if (S.day < 4) {
      if (S.elapsed >= S.stageDuration) stageClear(false);
    } else if (!S.bossActive && !S.boss && S.elapsed >= S.stageDuration) {
      startBoss(); // 保険（通常は0.85経過時点で先に起動する）
    }
  }

  function update(dt) {
    S.elapsed += dt;
    updateClockAndLunch();
    if (S.day === 4) updateBossTrigger();
    if (S.bossActive) updateBoss(dt); else maybeSpawnEnemy(dt);
    maybeSpawnItem(dt);

    const slow = performance.now() < S.slowUntil ? S.slowFactor : 1;
    for (let i = S.entities.length - 1; i >= 0; i--) {
      const e = S.entities[i];
      e.y += e.speed * slow * dt / 1000;
      if (e.zigzag) { e.zigT += dt / 250; e.x += Math.sin(e.zigT) * 1.2; }
      if (e.flash > 0) e.flash -= dt;
      if (e.y >= DEFENSE_LINE_Y) {
        let dmg = e.dmg;
        if (e.key === 'nagabanashi' && upgrades.headphone) {
          const headU = UPGRADES.find((u) => u.key === 'headphone');
          dmg = Math.round(dmg * (1 - Math.min(80, upgrades.headphone * headU.effectPerLv) / 100));
        }
        applyDamageToPlayer(dmg);
        S.entities.splice(i, 1);
      }
    }
    for (let i = S.items.length - 1; i >= 0; i--) {
      const it = S.items[i];
      it.y += it.speed * dt / 1000;
      if (it.y > CH + 20) S.items.splice(i, 1);
    }
    for (let i = S.fx.length - 1; i >= 0; i--) {
      const f = S.fx[i];
      f.life -= dt; f.y -= dt * 0.03;
      if (f.life <= 0) S.fx.splice(i, 1);
    }
    checkStageProgress();
  }

  // ---------- 描画 ----------
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

  function render() {
    ctx.clearRect(0, 0, CW, CH);
    // 縦のレーン区切り線
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let i = 1; i < COLS; i++) { ctx.beginPath(); ctx.moveTo(i * COL_W, 0); ctx.lineTo(i * COL_W, CH); ctx.stroke(); }

    // 防衛ライン（この下は自分の陣地。ここを越えられるとダメージ）
    ctx.fillStyle = 'rgba(255,181,71,0.12)';
    ctx.fillRect(0, DEFENSE_LINE_Y, CW, CH - DEFENSE_LINE_Y);
    ctx.strokeStyle = 'rgba(255,181,71,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, DEFENSE_LINE_Y); ctx.lineTo(CW, DEFENSE_LINE_Y); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,181,71,0.9)';
    ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('防衛ライン（自分の陣地）', 6, DEFENSE_LINE_Y + 4);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '24px sans-serif';
    for (const it of S.items) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      circle(it.x, it.y, 20);
      ctx.fillText(ITEM_TYPES[it.key].emoji, it.x, it.y);
    }

    for (const e of S.entities) {
      ctx.save();
      if (e.flash > 0) ctx.filter = 'brightness(1.8)';
      ctx.font = '28px sans-serif';
      ctx.fillText(ENEMY_TYPES[e.key].emoji, e.x, e.y);
      ctx.restore();
      ctx.fillStyle = '#000a'; ctx.fillRect(e.x - e.w / 2, e.y - 24, e.w, 5);
      ctx.fillStyle = '#e05252'; ctx.fillRect(e.x - e.w / 2, e.y - 24, e.w * Math.max(0, e.hp / e.maxHp), 5);
    }

    if (S.bossActive && S.boss) {
      ctx.font = '64px sans-serif';
      ctx.fillText('😤', CW / 2, 110);
      const w = 160;
      ctx.fillStyle = '#000a'; ctx.fillRect(CW / 2 - w / 2, 150, w, 8);
      ctx.fillStyle = '#e05252'; ctx.fillRect(CW / 2 - w / 2, 150, w * Math.max(0, S.boss.hp / S.boss.maxHp), 8);
      ctx.font = '11px sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText(`${BOSS.name} HP ${Math.max(0, S.boss.hp)}/${S.boss.maxHp}`, CW / 2, 168);
    }

    ctx.font = '13px sans-serif';
    for (const f of S.fx) {
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
  }

  function loop(ts) {
    if (!S.lastTime) S.lastTime = ts;
    const dt = Math.min(ts - S.lastTime, 50);
    S.lastTime = ts;
    if (S.state === 'playing') update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---------- ステージ結果 ----------
  function stageClear(bossVictory) {
    if (S.day + 1 > bestDay) bestDay = S.day + 1;
    saveProgress();
    if (bossVictory && S.day === 4) {
      S.state = 'allclear';
      EL.allclearCoins.textContent = S.coins;
      showScreen('screen-all-clear');
    } else {
      S.state = 'stageclear';
      EL.clearMsg.textContent = STAGE_CLEAR_LINES[S.day] || 'お疲れ様でした。';
      EL.clearCoins.textContent = S.runCoins;
      showScreen('screen-stage-clear');
    }
  }

  function gameOver() {
    S.state = 'gameover';
    saveProgress();
    EL.gameoverMsg.textContent = GAMEOVER_LINES[S.day] || 'メンタルが尽きてしまった。';
    showScreen('screen-gameover');
  }

  // ---------- ショップ ----------
  function openShop(returnTo) {
    S.shopReturn = returnTo;
    S.state = 'shop';
    renderShop();
    showScreen('screen-shop');
  }
  function closeShop() {
    S.state = S.shopReturn;
    showScreen(S.shopReturn === 'playing' ? 'screen-playing' : S.shopReturn === 'pause' ? 'screen-pause' : 'screen-title');
  }
  function renderShop() {
    EL.shopCoins.textContent = S.coins;
    EL.shopList.innerHTML = '';
    for (const u of UPGRADES) {
      const lv = upgrades[u.key] || 0;
      const maxLv = u.maxLv || 10;
      const cost = Math.round(u.baseCost * Math.pow(u.costMul, lv));
      const div = document.createElement('div');
      div.className = 'shop-item';
      div.innerHTML =
        `<div class="shop-item-icon">${u.icon}</div>` +
        `<div class="shop-item-info">` +
          `<div class="shop-item-name">${u.name}</div>` +
          `<div class="shop-item-desc">${u.desc}</div>` +
          `<div class="shop-item-level">Lv.${lv}${lv >= maxLv ? '(MAX)' : ''}</div>` +
        `</div>` +
        `<button class="shop-item-buy" data-key="${u.key}" ${lv >= maxLv ? 'disabled' : ''}>${lv >= maxLv ? 'MAX' : cost + '💰'}</button>`;
      EL.shopList.appendChild(div);
    }
    EL.shopList.querySelectorAll('.shop-item-buy').forEach((btn) => {
      btn.addEventListener('click', () => buyUpgrade(btn.dataset.key));
    });
  }
  function buyUpgrade(key) {
    const u = UPGRADES.find((x) => x.key === key);
    const lv = upgrades[key] || 0;
    const maxLv = u.maxLv || 10;
    const cost = Math.round(u.baseCost * Math.pow(u.costMul, lv));
    if (lv >= maxLv || S.coins < cost) return;
    S.coins -= cost;
    upgrades[key] = lv + 1;
    saveProgress();
    renderShop();
    updateHUD();
  }

  // ---------- リワード広告シミュレーション ----------
  function watchAdContinue() {
    EL.adRewardModal.classList.remove('hidden');
    let count = 5;
    EL.adRewardCountdown.textContent = String(count);
    const timer = setInterval(() => {
      count -= 1;
      EL.adRewardCountdown.textContent = String(count);
      if (count <= 0) {
        clearInterval(timer);
        EL.adRewardModal.classList.add('hidden');
        S.hp = Math.round(S.maxHp * 0.5);
        S.state = 'playing';
        showScreen('screen-playing');
        updateHUD();
      }
    }, 1000);
  }

  // ---------- イベント登録 ----------
  EL.btnStart.addEventListener('click', () => { S.day = 0; goStageIntro(); });
  EL.btnStageGo.addEventListener('click', beginStagePlay);
  EL.btnOpenShopTitle.addEventListener('click', () => openShop('title'));
  EL.btnOpenShop.addEventListener('click', () => openShop('playing'));
  EL.btnOpenShopPause.addEventListener('click', () => openShop('pause'));
  EL.btnShopClose.addEventListener('click', closeShop);
  EL.btnPause.addEventListener('click', () => { S.state = 'pause'; showScreen('screen-pause'); });
  EL.btnResume.addEventListener('click', () => { S.state = 'playing'; showScreen('screen-playing'); });
  EL.btnQuitTitle.addEventListener('click', goTitle);
  EL.btnNextDay.addEventListener('click', () => { S.day += 1; goStageIntro(); });
  EL.btnRestartWeek.addEventListener('click', () => { S.day = 0; goStageIntro(); });
  EL.btnRetryDay.addEventListener('click', beginStagePlay);
  EL.btnGameoverTitle.addEventListener('click', goTitle);
  EL.btnWatchAdContinue.addEventListener('click', watchAdContinue);
  EL.btnUltimate.addEventListener('click', useUltimate);
  EL.btnLectureSkip.addEventListener('click', () => {
    S.lectureTimer -= 700;
    spawnFx(CW / 2, 300, 'すみません!!', '#fff', 400);
    if (S.lectureTimer <= 0) endLecture();
  });
  EL.canvas.addEventListener('pointerdown', (ev) => { ev.preventDefault(); onCanvasPointer(ev.clientX, ev.clientY); });

  // ---------- 起動 ----------
  loadSave();
  goTitle();
  requestAnimationFrame(loop);
})();
