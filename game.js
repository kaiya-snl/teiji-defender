/* ==========================================================
   定時退社ディフェンダー - ゲーム本体
   Canvas 2D + バニラJSのみ（外部ライブラリなし）。
   内部解像度は 360x480 固定。CSS側で表示サイズを可変にし、
   タップ/ドラッグ座標は getBoundingClientRect の比率で内部座標へ変換する。
   操作: 指で左右に動かす=移動のみ（自キャラのXは連続値・14マス等の固定グリッドではない）。
   攻撃は武器システムによる自動連射・自動発動。詳細は WEAPONS を参照。
   進行: 4月〜3月の12ヶ月×4週、各週は月〜金＋金曜ボス。週クリア後ランダムで「休日出勤」が挟まる。
   ========================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---------- 画面要素キャッシュ ----------
  const EL = {
    btnStart: $('btn-start'), titleBestday: $('title-bestday'), titleCoins: $('title-coins'),
    btnOpenShopTitle: $('btn-open-shop-title'),
    stageIntroDay: $('stage-intro-day'), stageIntroMsg: $('stage-intro-msg'), btnStageGo: $('btn-stage-go'),
    hudDay: $('hud-day'), hudClock: $('hud-clock'), hudLevel: $('hud-level'), hudCoins: $('hud-coins'),
    hpInner: $('hp-bar-inner'), hpLabel: $('hp-bar-label'), expInner: $('exp-bar-inner'), loadout: $('loadout-row'),
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
    levelupModal: $('levelup-modal'), levelupChoices: $('levelup-choices'),
  };

  const ctx = EL.canvas.getContext('2d');
  const CW = 360, CH = 480, COLS = 3, COL_W = CW / COLS;
  const DEFENSE_LINE_Y = 420; // 防衛ライン。ここを敵が越えるとダメージ
  const PLAYER_Y = DEFENSE_LINE_Y - 24; // 自キャラの立ち位置(縦)
  EL.canvas.width = CW; EL.canvas.height = CH;

  const DAY_NAMES = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日'];
  const DAY_SHORT = ['月', '火', '水', '木', '金'];
  const MONTH_NAMES = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'];
  const TOTAL_WEEKS = MONTH_NAMES.length * 4; // 48週で1年コンプリート
  const BOSS_TRIGGER_FRAC = 0.85; // 金曜のこの経過割合でボス出現
  const EXTRA_STAGE_CHANCE = 0.25; // 週クリア後、休日出勤が挟まる確率

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

  // 恒常強化（コイン購入・日をまたいで引き継ぐ）
  const UPGRADES = [
    { key: 'pc',        name: '高スペックPC',               icon: '💻', desc: '全武器の攻撃力アップ',               baseCost: 20, costMul: 1.6, effectPerLv: 3,  maxLv: 12 },
    { key: 'monitor',   name: 'デュアルモニター',           icon: '🖥️', desc: 'ブラインドタッチ弾が同時に狙えるレーン+', baseCost: 35, costMul: 1.8, maxLv: 3 },
    { key: 'tool',      name: '有償ツール',                 icon: '🛠️', desc: '全武器の会心率アップ',               baseCost: 25, costMul: 1.7, effectPerLv: 8,  maxLv: 10 },
    { key: 'headphone', name: 'ノイズキャンセリングイヤホン', icon: '🎧', desc: '「上司の長話」の被ダメを軽減',       baseCost: 30, costMul: 1.7, effectPerLv: 10, maxLv: 8 },
  ];

  // ---------- 武器システム(7種) ----------
  // 各武器は Lv1〜10。所持していない武器はレベルアップ選択で「New!」として出現する。
  const WEAPONS = {
    basic: {
      icon: '⌨️', baseName: 'ブラインドタッチ弾', maxName: '神速のタイピング', maxLv: 10,
      desc: '前方に単体攻撃弾を連射。Lv上昇で連射速度・威力・同時レーン数がアップ。高Lvで弾が繋がりレーザー状に。',
    },
    pierce: {
      icon: '📋', baseName: 'コピペ・レーザー', maxName: '一括置換ビーム', maxLv: 10,
      desc: '直線上の敵を貫通する太いビーム。Lv上昇で貫通幅と威力がアップ。',
    },
    bomb: {
      icon: '📧', baseName: 'マクロ爆撃(VBAボム)', maxName: '全社メール一斉送信', maxLv: 10,
      desc: '命中/到達地点で爆発し周囲にダメージ。密集した敵に強い。Lv上昇で範囲と威力アップ。',
    },
    drone: {
      icon: '🤖', baseName: 'AIアシスタント', maxName: '自律型AI完全導入', maxLv: 10,
      desc: '自動で敵を追尾する分身。プレイヤーの攻撃とは独立して敵を処理する。Lv上昇で体数アップ。',
    },
    trap: {
      icon: '📤', baseName: 'アウトソーシング(外注化トラップ)', maxName: '完全自動化ライン', maxLv: 10,
      desc: 'レーン上に設置型トラップ。触れた敵に持続ダメージ。Lv上昇で設置数と持続時間アップ。',
    },
    freeze: {
      icon: '📅', baseName: '「リスケ」フリーズ', maxName: '無限検討モード', maxLv: 10,
      desc: '最前列の敵の動きを遅くする。高Lvで完全に足止め(ストップ)することも。マクロ爆撃と好相性。',
    },
    knock: {
      icon: '🪑', baseName: '「ちゃぶ台返し」ウェーブ', maxName: '役員の鶴の一声', maxLv: 10,
      desc: '定期的に衝撃波を発生させ、近づく敵を大きく押し返す。Lv10で画面半分近くまで押し返す鉄壁に。',
    },
  };

  function weaponDisplayName(key, lv) {
    const w = WEAPONS[key];
    return lv >= w.maxLv ? w.maxName : w.baseName;
  }

  // 汎用強化カード（ステージ限定の一時強化。武器と並んでレベルアップ選択に出現）
  const GENERIC_CARDS = [
    { icon: '❤️', name: '体力強化', desc: '最大HPが増え、その分回復する', apply: () => { S.maxHp += 15; S.hp += 15; } },
    { icon: '✨', name: '会心率アップ', desc: '会心の一撃(2倍ダメージ)の確率が上がる', apply: () => { S.runBuffs.critBonus += 10; } },
    { icon: '💰', name: '給料アップ', desc: 'コイン獲得量が増える(この日限定)', apply: () => { S.runBuffs.coinMul += 0.3; } },
    { icon: '🧲', name: 'アイテム回収範囲アップ', desc: 'お弁当やコーヒーを離れた位置でも自動回収できる', apply: () => { S.runBuffs.pickupRange += 22; } },
    { icon: '🛡️', name: 'シールド', desc: '次に受けるダメージを1回だけ無効化する(重複可)', apply: () => { S.runBuffs.shield += 1; } },
  ];

  const MONITOR_EXTRA = [0, 1, 2, 2]; // デュアルモニターLv→ブラインドタッチ弾への常時追加レーン数
  const FIRE_OFFSET_SETS = [[0], [0, 1], [0, -1, 1]]; // COLS=3を前提とした発射レーンオフセット(単位:COL_W)

  // 金曜ボス「帰り際の上司」: フェーズは hpAbove の降順で判定する。HPは週数に応じて強くなる。
  const BOSS = {
    name: '帰り際の上司',
    baseHp: 480,
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
    '', // 金曜は allclear/週クリア分岐のため未使用
  ];
  const GAMEOVER_LINES = [
    'メンタルが尽きてしまった。月曜から厳しい……。',
    'メンタルが尽きてしまった。火曜も油断できない。',
    'メンタルが尽きてしまった。折り返し地点で力尽きた。',
    'メンタルが尽きてしまった。木曜の壁は厚い。',
    '上司「よし、じゃあ夜ご飯奢るから」……いや、そういう話じゃない。',
  ];
  const EXTRA_STAGE_INTRO_LINES = [
    'まさかの休日出勤……仕方ない、片付けよう。',
    '「今日だけでいいから」……先週も同じこと言っていた気がする。',
    '誰もいない静かなオフィスで、今日も戦いは続く。',
  ];
  const EXTRA_STAGE_CLEAR_LINE = 'まさかの休日出勤、乗り切った……。';
  const EXTRA_STAGE_GAMEOVER_LINE = '休日を返上して挑んだのに……メンタルが尽きた。';

  // ---------- 状態 ----------
  let S = null;
  let upgrades = { pc: 0, monitor: 0, tool: 0, headphone: 0 };
  let monthIndex = 0; // 0=4月 ... 11=3月（現在地・セーブされる）
  let weekInMonth = 0; // 0-3（現在地・セーブされる）
  let bestTotalWeek = 0; // 到達済みの最高週数（1〜48）
  let bossLineTimeout = null;

  function totalWeekNow() { return monthIndex * 4 + weekInMonth; }
  function difficultyFactor() { return totalWeekNow() + S.day / 5; }

  function advanceWeek() {
    weekInMonth += 1;
    if (weekInMonth >= 4) { weekInMonth = 0; monthIndex += 1; }
    if (monthIndex >= MONTH_NAMES.length) { monthIndex = MONTH_NAMES.length - 1; weekInMonth = 3; }
  }

  function freshState() {
    return {
      state: 'title', day: 0, hp: 100, maxHp: 100, coins: 0, runCoins: 0,
      elapsed: 0, stageDuration: 80000, lunchActive: false, isExtraStage: false,
      entities: [], items: [], fx: [], bullets: [], bombs: [], drones: [], traps: [], explosions: [],
      ultGauge: 0, invincibleUntil: 0, slowUntil: 0, slowFactor: 1, coinBoostUntil: 0,
      spawnTimer: 600, itemTimer: 3000,
      bossActive: false, boss: null, bossPhaseIndex: -1,
      lectureActive: false, lectureTimer: 0,
      shopReturn: 'title', lastTime: 0,
      playerX: CW / 2, dragging: false, playerRecoil: 0, laserActive: false,
      runLevel: 1, runExp: 0, choosingUpgrade: false,
      weapons: { basic: { level: 1, timer: 300 } },
      runBuffs: { critBonus: 0, coinMul: 1, pickupRange: 0, shield: 0 },
    };
  }
  S = freshState();

  // ---------- セーブデータ（コイン・強化・現在地・最高記録のみ永続化） ----------
  function loadSave() {
    try {
      const c = localStorage.getItem('tdd_coins');
      S.coins = c ? (parseInt(c, 10) || 0) : 0;
      const u = localStorage.getItem('tdd_upgrades');
      if (u) upgrades = Object.assign(upgrades, JSON.parse(u));
      const bw = localStorage.getItem('tdd_bestweek');
      bestTotalWeek = bw ? (parseInt(bw, 10) || 0) : 0;
      const mi = localStorage.getItem('tdd_month');
      const wi = localStorage.getItem('tdd_week');
      monthIndex = mi ? Math.min(MONTH_NAMES.length - 1, Math.max(0, parseInt(mi, 10) || 0)) : 0;
      weekInMonth = wi ? Math.min(3, Math.max(0, parseInt(wi, 10) || 0)) : 0;
    } catch (e) {
      console.warn('セーブデータの読み込みに失敗しました（プライベートブラウズ等の可能性）', e);
    }
  }
  function saveProgress() {
    try {
      localStorage.setItem('tdd_coins', String(S.coins));
      localStorage.setItem('tdd_upgrades', JSON.stringify(upgrades));
      localStorage.setItem('tdd_bestweek', String(bestTotalWeek));
      localStorage.setItem('tdd_month', String(monthIndex));
      localStorage.setItem('tdd_week', String(weekInMonth));
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
    const cleared = bestTotalWeek;
    EL.titleBestday.textContent = cleared >= TOTAL_WEEKS ? '最高記録: 1年間コンプリート！'
      : cleared > 0 ? `最高記録: ${MONTH_NAMES[Math.floor((cleared - 1) / 4)]}第${((cleared - 1) % 4) + 1}週クリア` : '最高記録: -';
    EL.titleCoins.textContent = `所持コイン: ${S.coins}`;
    showScreen('screen-title');
  }

  function goStageIntro() {
    S.state = 'intro';
    if (S.isExtraStage) {
      EL.stageIntroDay.textContent = '休日出勤!?';
      EL.stageIntroMsg.textContent = EXTRA_STAGE_INTRO_LINES[Math.floor(Math.random() * EXTRA_STAGE_INTRO_LINES.length)];
    } else {
      EL.stageIntroDay.textContent = `${MONTH_NAMES[monthIndex]}第${weekInMonth + 1}週 ${DAY_NAMES[S.day]}`;
      EL.stageIntroMsg.textContent = STAGE_INTRO_LINES[S.day];
    }
    showScreen('screen-stage-intro');
  }

  function resetStageState() {
    const keepCoins = S.coins;
    const day = S.day;
    const extra = S.isExtraStage;
    S = freshState();
    S.coins = keepCoins;
    S.day = day;
    S.isExtraStage = extra;
    if (extra) S.stageDuration = 42000; // 休日出勤は短いが苛烈
    EL.bossDialogue.classList.add('hidden');
    EL.btnLectureSkip.classList.add('hidden');
    EL.levelupModal.classList.add('hidden');
  }

  function beginStagePlay() {
    resetStageState();
    S.state = 'playing';
    showScreen('screen-playing');
    updateHUD();
  }

  // ---------- HUD ----------
  function updateHUD() {
    EL.hudDay.textContent = S.isExtraStage ? '休日出勤' : `${MONTH_NAMES[monthIndex]}${weekInMonth + 1}週${DAY_SHORT[S.day]}`;
    EL.hudCoins.textContent = `💰${S.coins}`;
    EL.hudLevel.textContent = `Lv.${S.runLevel}`;
    const pct = Math.max(0, S.hp) / S.maxHp * 100;
    EL.hpInner.style.width = pct + '%';
    EL.hpInner.style.background = pct > 50 ? 'var(--color-hp-high)' : pct > 20 ? 'var(--color-hp-mid)' : 'var(--color-hp-low)';
    EL.hpLabel.textContent = `HP ${Math.max(0, Math.round(S.hp))}/${S.maxHp}`;
    const need = expToNext();
    EL.expInner.style.width = Math.min(100, (S.runExp / need) * 100) + '%';
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

  function spawnExplosion(x, y, maxRadius, colorRgb) {
    S.explosions.push({ x, y, life: 380, maxLife: 380, maxRadius, colorRgb: colorRgb || '255,140,60' });
  }

  function flashScreenDamage() {
    EL.canvas.style.filter = 'brightness(1.6) saturate(0.3)';
    setTimeout(() => { EL.canvas.style.filter = ''; }, 120);
  }

  function clampX(x) { return Math.max(16, Math.min(CW - 16, x)); }

  // ---------- 敵・アイテムのスポーン ----------
  function pickWeighted(pairs) {
    const total = pairs.reduce((s, p) => s + p[1], 0);
    let r = Math.random() * total;
    for (const [k, w] of pairs) { if (r < w) return k; r -= w; }
    return pairs[0][0];
  }

  function currentEnemyPool() {
    const pool = [['spec', 5], ['error', 3], ['denwa', 3], ['nagabanashi', 2]];
    if (S.day >= 2 || totalWeekNow() > 0) pool.push(['kaigi', 2]);
    return pool;
  }

  function spawnOne(key) {
    const def = ENEMY_TYPES[key];
    const lane = Math.floor(Math.random() * COLS);
    const df = difficultyFactor();
    const hpMul = 1 + Math.min(3.2, df * 0.055);
    const spMul = 1 + Math.min(1.4, df * 0.028);
    const extraMul = S.isExtraStage ? 1.35 : 1;
    S.entities.push({
      key, lane, x: lane * COL_W + COL_W / 2, y: -24,
      hp: Math.round(def.hp * hpMul * extraMul), maxHp: Math.round(def.hp * hpMul * extraMul),
      speed: def.speed * spMul * extraMul, dmg: def.dmg, coin: def.coin, w: def.w,
      zigzag: !!def.zigzag, zigT: Math.random() * Math.PI * 2, flash: 0,
      slowUntil: 0, slowMul: 1,
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
      const df = difficultyFactor();
      const base = (Math.max(480, 1400 - df * 34)) / (S.isExtraStage ? 1.3 : 1);
      S.spawnTimer = Math.max(280, base + (Math.random() * 400 - 200));
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

  // ---------- 経験値・レベルアップ選択 ----------
  function expToNext() {
    return Math.round(25 + (S.runLevel - 1) * 15);
  }

  function grantExp(amount) {
    S.runExp += amount;
    const need = expToNext();
    if (S.runExp >= need) {
      S.runExp -= need;
      S.runLevel += 1;
      openLevelUp();
    }
  }

  function buildLevelUpPool() {
    const pool = [];
    for (const key in WEAPONS) {
      const def = WEAPONS[key];
      const owned = S.weapons[key];
      if (owned && owned.level >= def.maxLv) continue;
      const nextLv = owned ? owned.level + 1 : 1;
      pool.push({
        icon: def.icon,
        name: owned ? `${weaponDisplayName(key, nextLv)} Lv.${nextLv}` : `${def.baseName}【New!】`,
        desc: def.desc,
        apply: () => {
          if (!S.weapons[key]) S.weapons[key] = { level: 1, timer: 0 };
          else S.weapons[key].level += 1;
        },
      });
    }
    for (const c of GENERIC_CARDS) pool.push(c);
    return pool;
  }

  function openLevelUp() {
    S.choosingUpgrade = true;
    const pool = buildLevelUpPool();
    const picks = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(idx, 1)[0]);
    }
    EL.levelupChoices.innerHTML = '';
    picks.forEach((card) => {
      const btn = document.createElement('button');
      btn.className = 'levelup-choice';
      btn.innerHTML =
        `<div class="levelup-choice-icon">${card.icon}</div>` +
        `<div><div class="levelup-choice-name">${card.name}</div><div class="levelup-choice-desc">${card.desc}</div></div>`;
      btn.addEventListener('click', () => applyLevelUpChoice(card));
      EL.levelupChoices.appendChild(btn);
    });
    EL.levelupModal.classList.remove('hidden');
  }

  function applyLevelUpChoice(card) {
    card.apply();
    EL.levelupModal.classList.add('hidden');
    S.choosingUpgrade = false;
    spawnFx(S.playerX, PLAYER_Y - 24, `${card.icon}${card.name}!`, '#9fb4ff', 1100);
    updateHUD();
  }

  // ---------- ダメージ計算(全武器共通) ----------
  function computeAttackDamage(baseDmg) {
    const pcU = UPGRADES.find((u) => u.key === 'pc');
    const toolU = UPGRADES.find((u) => u.key === 'tool');
    let dmg = baseDmg + upgrades.pc * pcU.effectPerLv;
    const critChance = Math.min(80, upgrades.tool * toolU.effectPerLv + S.runBuffs.critBonus);
    let crit = false;
    if (Math.random() * 100 < critChance) { dmg *= 2; crit = true; }
    return { dmg: Math.round(dmg), crit };
  }

  function killEnemy(e) {
    let coin = e.coin;
    if (performance.now() < S.coinBoostUntil) coin *= 2;
    coin = Math.round(coin * S.runBuffs.coinMul);
    S.coins += coin; S.runCoins += coin;
    S.ultGauge = Math.min(100, S.ultGauge + 8);
    spawnFx(e.x, e.y, `+${coin}💰`, '#ffd54f');
    S.entities = S.entities.filter((x) => x !== e);
    grantExp(e.coin);
    updateHUD();
  }

  function hitEnemy(e, baseDmg) {
    const { dmg, crit } = computeAttackDamage(baseDmg);
    e.hp -= dmg; e.flash = 120;
    spawnFx(e.x, e.y - 16, crit ? `会心!-${dmg}` : `-${dmg}`, crit ? '#ffdd55' : '#fff');
    if (e.hp <= 0) killEnemy(e);
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
    if (S.runBuffs.shield > 0) {
      S.runBuffs.shield -= 1;
      spawnFx(S.playerX, PLAYER_Y - 30, 'シールド防御!', '#8fe3ff', 700);
      updateHUD();
      return;
    }
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

  // ---------- 自キャラの移動 ----------
  function movePlayerTo(clientX) {
    const rect = EL.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (CW / rect.width);
    S.playerX = Math.max(20, Math.min(CW - 20, x));
  }

  // ---------- 武器システム: 発射・更新処理 ----------
  function basicFireOffsets(lv) {
    const fromWeapon = lv >= 7 ? 2 : lv >= 4 ? 1 : 0;
    const fromMonitor = MONITOR_EXTRA[Math.min(upgrades.monitor, 3)];
    const extra = Math.min(COLS - 1, fromWeapon + fromMonitor);
    return FIRE_OFFSET_SETS[extra].map((n) => n * COL_W);
  }

  function updateWeaponBasic(dt) {
    const w = S.weapons.basic;
    const interval = Math.max(70, 340 - w.level * 27);
    S.laserActive = interval <= 110;
    w.timer -= dt;
    if (w.timer <= 0) {
      w.timer = interval;
      const dmgBase = 7 + w.level * 3;
      for (const off of basicFireOffsets(w.level)) {
        S.bullets.push({ kind: 'basic', x: clampX(S.playerX + off), y: PLAYER_Y - 18, dmgBase, hitSet: new Set() });
      }
      S.playerRecoil = 90;
    }
  }

  function updateWeaponPierce(dt) {
    const w = S.weapons.pierce;
    if (!w) return;
    w.timer -= dt;
    const interval = Math.max(700, 1500 - w.level * 60);
    if (w.timer <= 0) {
      w.timer = interval;
      const dmgBase = 10 + w.level * 4;
      const laneWidth = 1 + Math.floor(w.level / 4);
      const halfWidth = laneWidth * COL_W * 0.5 + 8;
      S.bullets.push({ kind: 'pierce', x: S.playerX, y: PLAYER_Y - 18, dmgBase, halfWidth, hitSet: new Set() });
    }
  }

  function updateWeaponBomb(dt) {
    const w = S.weapons.bomb;
    if (!w) return;
    w.timer -= dt;
    const interval = Math.max(900, 2200 - w.level * 120);
    if (w.timer <= 0) {
      w.timer = interval;
      const dmgBase = 12 + w.level * 5;
      const radius = 45 + w.level * 9;
      S.bombs.push({ x: S.playerX, y: PLAYER_Y - 18, dmgBase, radius });
    }
    for (let i = S.bombs.length - 1; i >= 0; i--) {
      const b = S.bombs[i];
      b.y -= 250 * dt / 1000;
      let explode = b.y <= 55;
      if (!explode) {
        for (const e of S.entities) { if (Math.hypot(b.x - e.x, b.y - e.y) < 22) { explode = true; break; } }
      }
      if (explode) {
        spawnExplosion(b.x, b.y, b.radius, '255,140,60');
        for (const e of S.entities.slice()) {
          if (Math.hypot(b.x - e.x, b.y - e.y) < b.radius) hitEnemy(e, b.dmgBase);
        }
        if (S.bossActive && S.boss && S.boss.hp > 0 && b.y <= 150) hitBoss(b.dmgBase);
        S.bombs.splice(i, 1);
      } else if (b.y < -20) {
        S.bombs.splice(i, 1);
      }
    }
  }

  function updateWeaponDrone(dt) {
    const w = S.weapons.drone;
    if (!w) { S.drones.length = 0; return; }
    const wantCount = Math.min(5, Math.ceil(w.level / 2));
    while (S.drones.length < wantCount) {
      S.drones.push({ x: S.playerX + (Math.random() * 40 - 20), y: PLAYER_Y - 40, target: null, cooldown: 0, seed: Math.random() * 10 });
    }
    if (S.drones.length > wantCount) S.drones.length = wantCount;
    const dmgBase = 6 + w.level * 2;
    for (const d of S.drones) {
      if (!d.target || d.target.hp <= 0 || S.entities.indexOf(d.target) === -1) {
        let best = null, bd = 99999;
        for (const e of S.entities) { const dd = Math.hypot(e.x - d.x, e.y - d.y); if (dd < bd) { bd = dd; best = e; } }
        d.target = best;
      }
      d.cooldown -= dt;
      if (d.target) {
        const ang = Math.atan2(d.target.y - d.y, d.target.x - d.x);
        d.x += Math.cos(ang) * 150 * dt / 1000;
        d.y += Math.sin(ang) * 150 * dt / 1000;
        if (Math.hypot(d.target.x - d.x, d.target.y - d.y) < 18 && d.cooldown <= 0) {
          d.cooldown = 400;
          hitEnemy(d.target, dmgBase);
        }
      } else {
        d.x += Math.sin(performance.now() / 500 + d.seed) * 0.6;
        d.y += (PLAYER_Y - 50 - d.y) * 0.05;
      }
    }
  }

  function updateWeaponTrap(dt) {
    const w = S.weapons.trap;
    if (w) {
      w.timer -= dt;
      const maxCount = Math.min(4, 1 + Math.floor(w.level / 3));
      if (w.timer <= 0 && S.traps.length < maxCount) {
        w.timer = 1200;
        const lane = Math.floor(Math.random() * COLS);
        const dur = 4000 + w.level * 500;
        S.traps.push({ x: lane * COL_W + COL_W / 2, y: 95, life: dur, maxLife: dur, tickTimer: 0, dmg: 4 + w.level * 1.5 });
      }
    }
    for (let i = S.traps.length - 1; i >= 0; i--) {
      const t = S.traps[i];
      t.life -= dt; t.tickTimer -= dt;
      if (t.life <= 0) { S.traps.splice(i, 1); continue; }
      if (t.tickTimer <= 0) {
        t.tickTimer = 400;
        for (const e of S.entities) {
          if (Math.abs(e.x - t.x) < 26 && Math.abs(e.y - t.y) < 26) hitEnemy(e, t.dmg);
        }
      }
    }
  }

  function updateWeaponFreeze(dt) {
    const w = S.weapons.freeze;
    if (!w) return;
    w.timer -= dt;
    const interval = Math.max(1200, 2600 - w.level * 100);
    if (w.timer <= 0) {
      w.timer = interval;
      const targetCount = Math.min(3, 1 + Math.floor(w.level / 4));
      const freezeChance = w.level >= 10 ? 0.8 : w.level >= 8 ? 0.4 : 0;
      const front = S.entities.slice().sort((a, b) => b.y - a.y).slice(0, targetCount);
      for (const e of front) {
        const full = Math.random() < freezeChance;
        e.slowUntil = performance.now() + (1200 + w.level * 200);
        e.slowMul = full ? 0 : 0.35;
        spawnFx(e.x, e.y - 20, full ? 'ストップ!' : 'リスケ…', '#8fe3ff', 700);
      }
    }
  }

  function updateWeaponKnock(dt) {
    const w = S.weapons.knock;
    if (!w) return;
    w.timer -= dt;
    const interval = Math.max(1000, 3200 - w.level * 220);
    if (w.timer <= 0) {
      w.timer = interval;
      const dist = 60 + w.level * 18;
      for (const e of S.entities) {
        if (e.y > 130) e.y = Math.max(20, e.y - dist);
      }
      spawnExplosion(S.playerX, PLAYER_Y, 40 + dist, '255,181,71');
    }
  }

  function updateWeapons(dt) {
    updateWeaponBasic(dt);
    updateWeaponPierce(dt);
    updateWeaponBomb(dt);
    updateWeaponDrone(dt);
    updateWeaponTrap(dt);
    updateWeaponFreeze(dt);
    updateWeaponKnock(dt);
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
    const hpScale = 1 + Math.min(2.5, totalWeekNow() * 0.05);
    const maxHp = Math.round(BOSS.baseHp * hpScale);
    S.boss = { hp: maxHp, maxHp, timer: 0, finisherDone: false };
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

  function hitBoss(baseDmg) {
    if (!S.boss || S.boss.hp <= 0) return;
    if (S.lectureActive && Math.random() < 0.5) { spawnFx(CW / 2, 190, '届かない…', '#888', 600); return; }
    const { dmg, crit } = computeAttackDamage(baseDmg);
    S.boss.hp -= dmg;
    spawnFx(CW / 2, 130, crit ? `会心!-${dmg}` : `-${dmg}`, crit ? '#ffdd55' : '#fff', 700);
    if (S.boss.hp <= 0) defeatBoss();
  }

  function defeatBoss() {
    S.bossActive = false;
    S.entities = [];
    if (totalWeekNow() + 1 > bestTotalWeek) bestTotalWeek = totalWeekNow() + 1;
    showBossLine(BOSS.name, BOSS.defeatLine);
    setTimeout(() => stageClear(true), 1600);
  }

  // ---------- メイン更新 ----------
  function updateClockAndLunch() {
    if (S.bossActive) return;
    const frac = Math.min(S.elapsed / S.stageDuration, 1);
    const hour = 9 + frac * 9;
    S.lunchActive = !S.isExtraStage && hour >= 12 && hour < 13;
    displayClock(hour);
  }

  function checkStageProgress() {
    if (S.state !== 'playing') return;
    if (S.isExtraStage || S.day < 4) {
      if (S.elapsed >= S.stageDuration) stageClear(false);
    } else if (!S.bossActive && !S.boss && S.elapsed >= S.stageDuration) {
      startBoss(); // 保険（通常は0.85経過時点で先に起動する）
    }
  }

  function update(dt) {
    if (S.choosingUpgrade) return; // レベルアップ選択中はゲームを完全停止
    S.elapsed += dt;
    updateClockAndLunch();
    if (!S.isExtraStage && S.day === 4) updateBossTrigger();
    if (S.bossActive) updateBoss(dt); else maybeSpawnEnemy(dt);
    maybeSpawnItem(dt);

    if (S.playerRecoil > 0) S.playerRecoil -= dt;
    updateWeapons(dt);

    const slow = performance.now() < S.slowUntil ? S.slowFactor : 1;
    for (let i = S.entities.length - 1; i >= 0; i--) {
      const e = S.entities[i];
      const indiv = (e.slowUntil && performance.now() < e.slowUntil) ? e.slowMul : 1;
      e.y += e.speed * slow * indiv * dt / 1000;
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
      if (Math.abs(it.y - PLAYER_Y) < 24 + S.runBuffs.pickupRange && Math.abs(it.x - S.playerX) < 42 + S.runBuffs.pickupRange) {
        collectItem(it);
        S.items.splice(i, 1);
        continue;
      }
      if (it.y > CH + 20) S.items.splice(i, 1);
    }

    // 弾の移動と当たり判定（雑魚→ボスの順。雑魚が盾になる。同一弾が同じ敵に多重ヒットしないようhitSetで管理）
    for (let i = S.bullets.length - 1; i >= 0; i--) {
      const b = S.bullets[i];
      b.y -= (b.kind === 'pierce' ? 420 : 520) * dt / 1000;
      let consumed = false;
      const halfW = b.kind === 'pierce' ? b.halfWidth : null;
      for (const e of S.entities) {
        if (b.hitSet.has(e)) continue;
        const w2 = halfW !== null ? halfW : (e.w / 2 + 12);
        if (Math.abs(b.x - e.x) < w2 && Math.abs(b.y - e.y) < 16) {
          b.hitSet.add(e);
          hitEnemy(e, b.dmgBase);
          if (b.kind !== 'pierce') { consumed = true; break; }
        }
      }
      if (!consumed && S.bossActive && S.boss && S.boss.hp > 0 && b.y <= 150) {
        hitBoss(b.dmgBase);
        if (b.kind !== 'pierce') consumed = true;
      }
      if (consumed || b.y < -20) S.bullets.splice(i, 1);
    }

    for (let i = S.fx.length - 1; i >= 0; i--) {
      const f = S.fx[i];
      f.life -= dt; f.y -= dt * 0.03;
      if (f.life <= 0) S.fx.splice(i, 1);
    }
    for (let i = S.explosions.length - 1; i >= 0; i--) {
      S.explosions[i].life -= dt;
      if (S.explosions[i].life <= 0) S.explosions.splice(i, 1);
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

    // 設置トラップ
    for (const t of S.traps) {
      ctx.globalAlpha = Math.max(0.35, t.life / t.maxLife);
      ctx.fillStyle = 'rgba(159,216,255,0.25)';
      circle(t.x, t.y, 22);
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#9fd8ff';
      ctx.fillText('📤', t.x, t.y);
      ctx.globalAlpha = 1;
    }

    ctx.font = '24px sans-serif';
    for (const it of S.items) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      circle(it.x, it.y, 20);
      ctx.fillText(ITEM_TYPES[it.key].emoji, it.x, it.y);
    }

    for (const e of S.entities) {
      ctx.save();
      if (e.flash > 0) ctx.filter = 'brightness(1.8)';
      if (e.slowUntil && performance.now() < e.slowUntil) ctx.globalAlpha = 0.75;
      ctx.font = '28px sans-serif';
      ctx.fillText(ENEMY_TYPES[e.key].emoji, e.x, e.y);
      ctx.restore();
      ctx.fillStyle = '#000a'; ctx.fillRect(e.x - e.w / 2, e.y - 24, e.w, 5);
      ctx.fillStyle = '#e05252'; ctx.fillRect(e.x - e.w / 2, e.y - 24, e.w * Math.max(0, e.hp / e.maxHp), 5);
    }

    // ブラインドタッチ弾が高速連射になると帯状のレーザーとして重ねて見せる
    if (S.laserActive) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#8fe3ff';
      for (const off of basicFireOffsets(S.weapons.basic.level)) {
        const x = clampX(S.playerX + off);
        ctx.fillRect(x - 6, 0, 12, PLAYER_Y - 10);
      }
      ctx.restore();
    }

    // 弾
    for (const b of S.bullets) {
      if (b.kind === 'pierce') {
        ctx.fillStyle = 'rgba(159,216,255,0.9)';
        ctx.fillRect(b.x - b.halfWidth, b.y - 10, b.halfWidth * 2, 18);
      } else {
        ctx.fillStyle = '#ffe082';
        ctx.fillRect(b.x - 2, b.y - 9, 4, 16);
      }
    }

    // マクロ爆撃
    ctx.font = '20px sans-serif';
    for (const bomb of S.bombs) { ctx.fillText('📧', bomb.x, bomb.y); }

    // AIアシスタント(ドローン)
    ctx.font = '18px sans-serif';
    for (const d of S.drones) { ctx.fillText('🤖', d.x, d.y); }

    // 爆発・衝撃波エフェクト
    for (const ex of S.explosions) {
      const t = 1 - ex.life / ex.maxLife;
      ctx.strokeStyle = `rgba(${ex.colorRgb},${Math.max(0, 1 - t)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.maxRadius * t, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
    }

    // 自キャラ（サラリーマン。タイピング中のようにわずかに上下＆発射時にリコイル演出）
    const recoil = S.playerRecoil > 0 ? 1 - (S.playerRecoil / 90) * 0.15 : 1;
    const bob = Math.sin(performance.now() / 220) * 3;
    ctx.save();
    ctx.translate(S.playerX, PLAYER_Y + bob);
    ctx.scale(recoil, recoil);
    ctx.font = '30px sans-serif';
    ctx.fillText('🧑‍💻', 0, 0);
    ctx.restore();

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
    saveProgress();
    if (S.isExtraStage) {
      S.state = 'stageclear';
      EL.clearMsg.textContent = EXTRA_STAGE_CLEAR_LINE;
      EL.clearCoins.textContent = S.runCoins;
      showScreen('screen-stage-clear');
      return;
    }
    if (bossVictory && S.day === 4) {
      if (totalWeekNow() >= TOTAL_WEEKS - 1) {
        S.state = 'allclear';
        EL.allclearCoins.textContent = S.coins;
        showScreen('screen-all-clear');
      } else {
        S.state = 'stageclear';
        EL.clearMsg.textContent = `${MONTH_NAMES[monthIndex]}第${weekInMonth + 1}週、乗り切った。`;
        EL.clearCoins.textContent = S.runCoins;
        showScreen('screen-stage-clear');
      }
      return;
    }
    S.state = 'stageclear';
    EL.clearMsg.textContent = STAGE_CLEAR_LINES[S.day] || 'お疲れ様でした。';
    EL.clearCoins.textContent = S.runCoins;
    showScreen('screen-stage-clear');
  }

  function gameOver() {
    S.state = 'gameover';
    saveProgress();
    EL.gameoverMsg.textContent = S.isExtraStage ? EXTRA_STAGE_GAMEOVER_LINE : (GAMEOVER_LINES[S.day] || 'メンタルが尽きてしまった。');
    showScreen('screen-gameover');
  }

  function goNextAfterClear() {
    if (S.isExtraStage) {
      S.isExtraStage = false;
      advanceWeek();
      saveProgress();
      S.day = 0;
      goStageIntro();
    } else if (S.day === 4) {
      if (Math.random() < EXTRA_STAGE_CHANCE) {
        S.isExtraStage = true;
        goStageIntro();
      } else {
        advanceWeek();
        saveProgress();
        S.day = 0;
        goStageIntro();
      }
    } else {
      S.day += 1;
      goStageIntro();
    }
  }

  // ---------- ショップ（恒常強化。コイン購入・日をまたいで引き継ぐ） ----------
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
  EL.btnStart.addEventListener('click', () => { S.day = 0; S.isExtraStage = false; goStageIntro(); });
  EL.btnStageGo.addEventListener('click', beginStagePlay);
  EL.btnOpenShopTitle.addEventListener('click', () => openShop('title'));
  EL.btnOpenShop.addEventListener('click', () => openShop('playing'));
  EL.btnOpenShopPause.addEventListener('click', () => openShop('pause'));
  EL.btnShopClose.addEventListener('click', closeShop);
  EL.btnPause.addEventListener('click', () => { S.state = 'pause'; showScreen('screen-pause'); });
  EL.btnResume.addEventListener('click', () => { S.state = 'playing'; showScreen('screen-playing'); });
  EL.btnQuitTitle.addEventListener('click', goTitle);
  EL.btnNextDay.addEventListener('click', goNextAfterClear);
  EL.btnRestartWeek.addEventListener('click', () => { monthIndex = 0; weekInMonth = 0; S.day = 0; saveProgress(); goStageIntro(); });
  EL.btnRetryDay.addEventListener('click', beginStagePlay);
  EL.btnGameoverTitle.addEventListener('click', goTitle);
  EL.btnWatchAdContinue.addEventListener('click', watchAdContinue);
  EL.btnUltimate.addEventListener('click', useUltimate);
  EL.btnLectureSkip.addEventListener('click', () => {
    S.lectureTimer -= 700;
    spawnFx(CW / 2, 300, 'すみません!!', '#fff', 400);
    if (S.lectureTimer <= 0) endLecture();
  });

  // 操作: 押した位置へ即座に移動＋ドラッグ追従（攻撃は全武器とも自動）
  EL.canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    if (S.state !== 'playing') return;
    S.dragging = true;
    movePlayerTo(ev.clientX);
  });
  EL.canvas.addEventListener('pointermove', (ev) => {
    if (!S.dragging || S.state !== 'playing') return;
    ev.preventDefault();
    movePlayerTo(ev.clientX);
  });
  window.addEventListener('pointerup', () => { S.dragging = false; });
  window.addEventListener('pointercancel', () => { S.dragging = false; });

  // ---------- 起動 ----------
  loadSave();
  goTitle();
  requestAnimationFrame(loop);
})();
