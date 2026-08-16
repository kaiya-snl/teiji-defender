/* ==========================================================
   定時退社ディフェンダー - ゲーム本体
   Canvas 2D + バニラJSのみ（外部ライブラリなし）。
   内部解像度は 360x480 固定。CSS側で表示サイズを可変にし、
   タップ座標は getBoundingClientRect の比率で内部座標へ変換する。
   ジャンル: タワーディフェンス。編成した仲間（最大3人）はレーンごとに固定位置へ配置され、
   キャラの得意武器で自動的に戦う。自キャラは陣地（防衛ライン付近）に固定で自前の武器を持ち、
   タップした敵には少量の直接ダメージ（応援攻撃）を与えられる。
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
    gachaChargeBanner: $('gacha-charge-banner'), gachaResultNewBadge: $('gacha-result-new-badge'),
    btnOpenRosterTitle: $('btn-open-roster-title'), btnOpenRosterPause: $('btn-open-roster-pause'),
    rosterCoins: $('roster-coins'), rosterPartyCount: $('roster-party-count'), rosterList: $('roster-list'),
    btnGachaPull: $('btn-gacha-pull'), btnGachaPullX10: $('btn-gacha-pull-x10'),
    btnGachaAd: $('btn-gacha-ad'), btnRosterClose: $('btn-roster-close'),
    gachaResultModal: $('gacha-result-modal'), gachaResultBox: $('gacha-result-box'),
    gachaResultRarity: $('gacha-result-rarity'),
    gachaResultIcon: $('gacha-result-icon'), gachaResultName: $('gacha-result-name'),
    gachaResultNote: $('gacha-result-note'), btnGachaResultClose: $('btn-gacha-result-close'),
    gachaResultX10Modal: $('gacha-result-x10-modal'), gachaResultX10Box: $('gacha-result-x10-box'),
    gachaX10Summary: $('gacha-x10-summary'),
    gachaX10Grid: $('gacha-x10-grid'), btnGachaX10Close: $('btn-gacha-x10-close'),
  };

  const GACHA_FREE_TEST = true; // テスト版のため、ガチャのコイン消費を一時的に無効化

  const ctx = EL.canvas.getContext('2d');
  const CW = 360, CH = 480, COLS = 3, COL_W = CW / COLS;
  // 防衛ラインはユニット列(後列y=290)のすぐ後ろに設定。間延びした無防備地帯を作らない。
  const DEFENSE_LINE_Y = 330; // 防衛ライン。ここを敵が越えるとダメージ
  const PLAYER_Y = 380; // 自キャラ(=自分自身。HPの象徴)の立ち位置。もう攻撃はしない
  // マージキャノン方式のユニット配置スロット(3レーン×前後2列=6マス)。
  // レーン中心Xに揃えることで、そのまま自動攻撃の当たり判定(レーン基準)を使い回せる。
  const ROW_SLOTS = [];
  for (let _lane = 0; _lane < COLS; _lane++) {
    ROW_SLOTS.push({ x: _lane * COL_W + COL_W / 2, y: 210 });
    ROW_SLOTS.push({ x: _lane * COL_W + COL_W / 2, y: 290 });
  }
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
    { key: 'monitor',   name: 'デュアルモニター',           icon: '🖥️', desc: '新戦力の出現間隔が短くなる',         baseCost: 35, costMul: 1.8, maxLv: 3 },
    { key: 'tool',      name: '有償ツール',                 icon: '🛠️', desc: '全武器の会心率アップ',               baseCost: 25, costMul: 1.7, effectPerLv: 8,  maxLv: 10 },
    { key: 'headphone', name: 'ノイズキャンセリングイヤホン', icon: '🎧', desc: '「上司の長話」の被ダメを軽減',       baseCost: 30, costMul: 1.7, effectPerLv: 10, maxLv: 8 },
  ];


  // 汎用強化カード（ステージ限定の一時強化。武器と並んでレベルアップ選択に出現）
  const GENERIC_CARDS = [
    { icon: '❤️', name: '体力強化', desc: '最大HPが増え、その分回復する', apply: () => { S.maxHp += 15; S.hp += 15; } },
    { icon: '✨', name: '会心率アップ', desc: '会心の一撃(2倍ダメージ)の確率が上がる', apply: () => { S.runBuffs.critBonus += 10; } },
    { icon: '💰', name: '給料アップ', desc: 'コイン獲得量が増える(この日限定)', apply: () => { S.runBuffs.coinMul += 0.3; } },
    { icon: '🧲', name: 'アイテム回収範囲アップ', desc: 'お弁当やコーヒーを離れた位置でも自動回収できる', apply: () => { S.runBuffs.pickupRange += 22; } },
    { icon: '🛡️', name: 'シールド', desc: '次に受けるダメージを1回だけ無効化する(重複可)', apply: () => { S.runBuffs.shield += 1; } },
  ];

  // ---------- 仲間(社員)システム: 20種、採用ガチャで収集し最大5人編成 ----------
  // apply(a, s): 編成中の効果を集計オブジェクト a に加算/乗算する。s はダブり数から算出したレベル倍率。
  const GACHA_COST = 40; // コインガチャ1回のコスト
  const PARTY_MAX = 3; // 編成できる仲間の最大人数
  const ROLE_LABEL = { atk: '⚔️アタッカー', def: '🛡️ディフェンダー', sup: '💖サポーター', trick: '🃏トリックスター' };
  // 季節限定キャラ用の自作SVGアイコン（外部画像を使わず自前で描画）
  const ART_GAL =
    '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M20 72 Q14 50 30 44 L36 76 Q26 80 20 72 Z" fill="#1a1a1a"/>' +
    '<path d="M80 72 Q86 50 70 44 L64 76 Q74 80 80 72 Z" fill="#1a1a1a"/>' +
    '<ellipse cx="50" cy="56" rx="15" ry="19" fill="#f0b088"/>' +
    '<path d="M37 60 L50 67 L63 60 L58 74 L42 74 Z" fill="#ff5c8a"/>' +
    '<line x1="45" y1="47" x2="43" y2="60" stroke="#ccc" stroke-width="1.5"/>' +
    '<rect x="39" y="58" width="8" height="10" rx="1" fill="#fff" stroke="#ddd"/>' +
    '<circle cx="50" cy="31" r="17" fill="#f7c199"/>' +
    '<path d="M32 29 Q27 8 50 7 Q73 8 68 29 Q71 45 62 41 Q67 24 50 21 Q33 24 38 41 Q29 45 32 29 Z" fill="#4a2c1e"/>' +
    '<path d="M60 13 Q71 17 66 30" fill="none" stroke="#d8ad63" stroke-width="3" stroke-linecap="round"/>' +
    '<rect x="36" y="8" width="11" height="7" rx="3" fill="#222"/>' +
    '<rect x="53" y="8" width="11" height="7" rx="3" fill="#222"/>' +
    '<line x1="47" y1="11" x2="53" y2="11" stroke="#222" stroke-width="2"/>' +
    '<circle cx="32" cy="35" r="2.4" fill="#ffd54f"/>' +
    '<circle cx="68" cy="35" r="2.4" fill="#ffd54f"/>' +
    '<circle cx="44" cy="33" r="1.6" fill="#333"/><circle cx="56" cy="33" r="1.6" fill="#333"/>' +
    '<path d="M45 39 Q50 43 55 39" stroke="#333" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
    '</svg>';
  const ART_BBQ =
    '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M30 56 Q50 49 70 56 L76 92 L24 92 Z" fill="#d9502a"/>' +
    '<path d="M42 56 L45 48 L55 48 L58 56 Z" fill="#c2431f"/>' +
    '<path d="M42 49 L50 58 L58 49 L54 45 L46 45 Z" fill="#fff"/>' +
    '<path d="M48 51 L52 51 L54 68 L50 74 L46 68 Z" fill="#2c3e6b"/>' +
    '<circle cx="50" cy="31" r="17" fill="#e8ab7a"/>' +
    '<path d="M33 27 Q31 10 50 10 Q69 10 67 27 Q67 18 50 18 Q33 18 33 27 Z" fill="#2b2118"/>' +
    '<rect x="32" y="18" width="36" height="6" fill="#c0392b"/>' +
    '<line x1="39" y1="37" x2="43" y2="40" stroke="#333" stroke-width="2" stroke-linecap="round"/>' +
    '<line x1="59" y1="36" x2="62" y2="39" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>' +
    '<circle cx="44" cy="32" r="1.6" fill="#222"/><circle cx="56" cy="32" r="1.6" fill="#222"/>' +
    '<path d="M44 39 Q50 44 56 39" stroke="#222" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
    '<path d="M78 52 L90 42 M78 58 L92 53" stroke="#8a8a8a" stroke-width="3" stroke-linecap="round" fill="none"/>' +
    '<circle cx="14" cy="80" r="5" fill="#ff9a3c"/><circle cx="20" cy="86" r="3.5" fill="#ffb35c"/>' +
    '</svg>';

  const CHARACTERS = [
    { key: 'ace', name: '新人エース', role: 'atk', rarity: 'SR', icon: '🌱', weaponType: 'basic',
      desc: '配置レーンでブラインドタッチ型の攻撃。稀に攻撃が敵を回復させてしまう',
      apply: (a, s) => { a.basicFireRateMul *= (1 - 0.05 * s); a.whiffHealChance += 0.015 * s; } },
    { key: 'excel', name: 'エクセル職人', role: 'atk', rarity: 'R', icon: '📊', weaponType: 'bomb',
      desc: '配置レーンでマクロ爆撃(範囲攻撃)。全体の爆撃威力もアップ',
      apply: (a, s) => { a.bombRadiusMul += 0.08 * s; a.bombDmgMul += 0.10 * s; } },
    { key: 'typing', name: 'タイピングの鬼', role: 'def', rarity: 'SSR', icon: '⌨️', weaponType: 'basic',
      desc: '配置レーンで超高火力の単体攻撃。全武器の攻撃力も底上げ',
      apply: (a, s) => { a.allDmgMul += 0.10 * s; } },
    { key: 'gorilla', name: '営業のゴリラ', role: 'atk', rarity: 'R', icon: '🦍', weaponType: 'knock',
      desc: '配置レーンで敵を吹き飛ばすノックバック攻撃',
      apply: (a, s) => { a.knockDistMul += 0.10 * s; a.knockIntervalMul *= (1 - 0.06 * s); } },
    { key: 'kikoku', name: '帰国子女エンジニア', role: 'atk', rarity: 'SR', icon: '🌐', weaponType: 'pierce',
      desc: '配置レーンを貫通するビーム攻撃。「謎のエラー」に特効',
      apply: (a, s) => { a.errorDmgMul += 0.25 * s; } },
    { key: 'legend', name: '伝説の派遣社員', role: 'sup', rarity: 'SSR', icon: '🕶️', weaponType: 'basic',
      desc: '配置レーンで全方位に強い攻撃。全武器の攻撃力アップだが毎秒コインを消費',
      apply: (a, s) => { a.allDmgMul += 0.12 * s; a.coinDrainPerSec += 0.4 * s; } },
    { key: 'otsubone', name: 'ベテランお局様', role: 'def', rarity: 'SR', icon: '👓', weaponType: 'freeze',
      desc: '配置レーンの敵を睨みで足止め。高Lvで完全ストップも',
      apply: (a, s) => { a.freezeIntervalMul *= (1 - 0.06 * s); a.freezeChanceBonus += 0.03 * s; } },
    { key: 'sekinin', name: '責任逃れの上司', role: 'def', rarity: 'R', icon: '🙈',
      desc: '被弾を確率で丸ごとブロック',
      apply: (a, s) => { a.blockChance += 0.02 * s; } },
    { key: 'madogiwa', name: '窓際族の妖精', role: 'def', rarity: 'N', icon: '🧚',
      desc: '最大HPアップ',
      apply: (a, s) => { a.maxHpBonus += 12 * s; } },
    { key: 'claim', name: 'クレーム対応のプロ', role: 'def', rarity: 'R', icon: '📞',
      desc: '被ダメージ軽減',
      apply: (a, s) => { a.incomingDmgMul *= (1 - 0.03 * s); } },
    { key: 'houmu', name: '法務部の守護神', role: 'def', rarity: 'SR', icon: '⚖️', weaponType: 'trap',
      desc: '配置レーンにトラップを設置。設置数・持続時間もアップ',
      apply: (a, s) => { if (s >= 6) a.trapMaxCountBonus = Math.max(a.trapMaxCountBonus, 1); a.trapDurationMul += 0.08 * s; } },
    { key: 'soumu', name: '癒やしの総務女子', role: 'sup', rarity: 'R', icon: '🍵',
      desc: 'HPが少しずつ回復する',
      apply: (a, s) => { a.hpRegenPerSec += 0.3 * s; } },
    { key: 'keiri', name: '経理の鬼', role: 'sup', rarity: 'SR', icon: '🧮',
      desc: 'コイン獲得量アップ',
      apply: (a, s) => { a.coinMul += 0.08 * s; } },
    { key: 'dash', name: '定時ダッシュ勢', role: 'sup', rarity: 'N', icon: '🏃',
      desc: '定時間際(残り時間わずか)で攻撃速度が爆発的アップ',
      apply: (a, s) => { a.dashScale = Math.max(a.dashScale, s); } },
    { key: 'comm', name: 'コミュ力お化け', role: 'sup', rarity: 'R', icon: '💬',
      desc: '必殺技ゲージが早く貯まる',
      apply: (a, s) => { a.ultGaugeMul += 0.10 * s; } },
    { key: 'inu', name: '社長の愛犬', role: 'sup', rarity: 'N', icon: '🐕',
      desc: 'HPがほんの少しずつ回復する',
      apply: (a, s) => { a.hpRegenPerSec += 0.08 * s; } },
    { key: 'neet', name: '社内ニート', role: 'trick', rarity: 'N', icon: '😴',
      desc: '普段は何もしないが、ごく稀に本気を出して画面の敵を一掃する',
      apply: (a, s) => { a.neetTriggerPerSec += 0.003 * s; },
      evoNames: ['社内ニート', '一般社員', '中堅エース', '一家に一台AI Master'], evoThresholds: [1, 11, 21, 31] },
    { key: 'uwasa', name: 'うわさ好きの社員', role: 'trick', rarity: 'R', icon: '🗯️',
      desc: '敵同士に噂話を流し、じわじわ同士討ちさせる',
      apply: (a, s) => { a.uwasaDmgPerSec += 0.6 * s; } },
    { key: 'power', name: 'パワハラ部長', role: 'trick', rarity: 'SR', icon: '😠',
      desc: '全員の攻撃力を上げるが、編成中は自分のHPが徐々に減る諸刃の剣',
      apply: (a, s) => { a.allDmgMul += 0.15 * s; a.hpDrainPerSec += 0.25 * s; } },
    { key: 'exemp', name: '辞めた優秀な元社員', role: 'trick', rarity: 'R', icon: '🚪',
      desc: '1ステージにつき1回、必殺技発動時に数秒だけ大幅強化される',
      apply: (a, s) => { a.exEmpScale = Math.max(a.exEmpScale, s); } },
    { key: 'gal', name: '水着ギャルエリート', role: 'atk', rarity: 'SSR', icon: '👙', art: ART_GAL, seasonal: '🌺夏季限定', weaponType: 'basic',
      desc: '配置レーンで「それな」「ASAPで」等のギャル語レーザー連射。陽キャオーラで全体の敵HPもじわじわ削る',
      apply: (a, s) => { a.allDmgMul += 0.14 * s; a.extraLaneBonus = Math.max(a.extraLaneBonus, s >= 6 ? 1 : 0); a.uwasaDmgPerSec += 1.2 * s; } },
    { key: 'bbq', name: '肉焼き奉行', role: 'atk', rarity: 'SR', icon: '🥩', art: ART_BBQ, seasonal: '🌺夏季限定', weaponType: 'bomb',
      desc: '配置レーンで熱々の炭を投げて範囲ダメージ。高級和牛パワーで全体攻撃力アップ(その分HPを消費)',
      apply: (a, s) => { a.bombRadiusMul += 0.10 * s; a.bombDmgMul += 0.14 * s; a.allDmgMul += 0.05 * s; a.hpDrainPerSec += 0.15 * s; } },
  ];


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
  let roster = {}; // 採用済み社員 { key: { dupes, level } }
  let party = []; // 編成中の社員key（最大5）
  let rosterReturn = 'title';
  let bossLineTimeout = null;

  function freshPartyAggregate() {
    return {
      allDmgMul: 0, basicFireRateMul: 1, incomingDmgMul: 1, coinMul: 0, ultGaugeMul: 0,
      hpRegenPerSec: 0, maxHpBonus: 0, freezeIntervalMul: 1, freezeChanceBonus: 0,
      bombRadiusMul: 0, bombDmgMul: 0, knockDistMul: 0, knockIntervalMul: 1,
      trapMaxCountBonus: 0, trapDurationMul: 0, errorDmgMul: 0,
      blockChance: 0, whiffHealChance: 0, neetTriggerPerSec: 0, uwasaDmgPerSec: 0,
      coinDrainPerSec: 0, hpDrainPerSec: 0, dashScale: 0, exEmpScale: 0, extraLaneBonus: 0,
    };
  }

  function computePartyAggregate() {
    const agg = freshPartyAggregate();
    for (const key of party) {
      const owned = roster[key];
      const def = CHARACTERS.find((c) => c.key === key);
      if (!owned || !def) continue;
      const scale = 1 + (owned.level - 1) * 0.12;
      def.apply(agg, scale);
    }
    return agg;
  }

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
      playerX: CW / 2, playerRecoil: 0,
      runLevel: 1, runExp: 0, choosingUpgrade: false,
      row: new Array(ROW_SLOTS.length).fill(null), unitSpawnTimer: 1200, dragSlot: -1, dragPos: null,
      rowDmgMul: 1, rowFireRateMul: 1, rowSpawnRateMul: 1,
      runBuffs: { critBonus: 0, coinMul: 1, pickupRange: 0, shield: 0 },
      partyAgg: freshPartyAggregate(), exEmpUsed: false, exEmpUntil: 0,
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
      const r = localStorage.getItem('tdd_roster');
      if (r) roster = JSON.parse(r);
      const p = localStorage.getItem('tdd_party');
      if (p) party = JSON.parse(p);
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
      localStorage.setItem('tdd_roster', JSON.stringify(roster));
      localStorage.setItem('tdd_party', JSON.stringify(party));
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
    S.partyAgg = computePartyAggregate();
    S.maxHp += Math.round(S.partyAgg.maxHpBonus);
    S.hp = S.maxHp;
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

  // レベルアップ選択は「列のユニット全体」を強化する方向に統一（自キャラ個人の武器は廃止）。
  const ROW_LEVEL_CARDS = [
    { icon: '💥', name: '全ユニット攻撃力アップ', desc: '列にいる全ユニットの攻撃力が上がる', apply: () => { S.rowDmgMul += 0.15; } },
    { icon: '⚡', name: '全ユニット攻撃速度アップ', desc: '列にいる全ユニットの攻撃間隔が短くなる', apply: () => { S.rowFireRateMul *= 0.9; } },
    { icon: '🆕', name: '新戦力アップ', desc: '新しいユニットが出現する間隔が短くなる', apply: () => { S.rowSpawnRateMul *= 0.85; } },
  ];

  function buildLevelUpPool() {
    const pool = [];
    for (const c of ROW_LEVEL_CARDS) pool.push(c);
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
    let dmg = (baseDmg + upgrades.pc * pcU.effectPerLv) * (1 + S.partyAgg.allDmgMul);
    if (S.exEmpUntil && performance.now() < S.exEmpUntil) dmg *= (1 + S.partyAgg.exEmpScale);
    const critChance = Math.min(80, upgrades.tool * toolU.effectPerLv + S.runBuffs.critBonus);
    let crit = false;
    if (Math.random() * 100 < critChance) { dmg *= 2; crit = true; }
    return { dmg: Math.round(dmg), crit };
  }

  function killEnemy(e) {
    let coin = e.coin;
    if (performance.now() < S.coinBoostUntil) coin *= 2;
    coin = Math.round(coin * S.runBuffs.coinMul * (1 + S.partyAgg.coinMul));
    S.coins += coin; S.runCoins += coin;
    S.ultGauge = Math.min(100, S.ultGauge + 8 * (1 + S.partyAgg.ultGaugeMul));
    spawnFx(e.x, e.y, `+${coin}💰`, '#ffd54f');
    S.entities = S.entities.filter((x) => x !== e);
    grantExp(e.coin);
    updateHUD();
  }

  function hitEnemy(e, baseDmg) {
    if (S.partyAgg.whiffHealChance > 0 && Math.random() < S.partyAgg.whiffHealChance) {
      const heal = Math.round(baseDmg * 0.5);
      e.hp = Math.min(e.maxHp, e.hp + heal);
      spawnFx(e.x, e.y - 16, `+${heal}回復…`, '#8fbf6a');
      return;
    }
    if (e.key === 'error') baseDmg *= (1 + S.partyAgg.errorDmgMul);
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
    if (S.partyAgg.blockChance > 0 && Math.random() < S.partyAgg.blockChance) {
      spawnFx(S.playerX, PLAYER_Y - 30, '部下に丸投げ!', '#8fbf6a', 700);
      return;
    }
    dmg = Math.round(dmg * S.partyAgg.incomingDmgMul);
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
    if (S.partyAgg.exEmpScale > 0 && !S.exEmpUsed) {
      S.exEmpUsed = true;
      S.exEmpUntil = performance.now() + 5000;
      spawnFx(CW / 2, CH / 2 - 40, '助っ人参上!!', '#ff8fd6', 1200);
    }
    spawnFx(CW / 2, CH / 2, 'ショートカットキー全開放!!', '#ffd54f', 1200);
    updateHUD();
  }

  // ---------- タップ応援攻撃・ユニットのドラッグ合体 ----------
  function canvasPos(clientX, clientY) {
    const rect = EL.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) * (CW / rect.width), y: (clientY - rect.top) * (CH / rect.height) };
  }

  // 敵に少量の直接ダメージを与える補助操作（自分も参加してる感を出すため）。
  function handleTapDamage(x, y) {
    const tapDmg = 5 + upgrades.pc * 1;
    if (S.bossActive && S.boss && Math.hypot(x - CW / 2, y - 110) < 50) { hitBoss(tapDmg); return; }
    let target = null, best = 999;
    for (const e of S.entities) {
      const d = Math.hypot(x - e.x, y - e.y);
      if (d < e.w + 16 && d < best) { best = d; target = e; }
    }
    if (target) hitEnemy(target, tapDmg);
  }

  // ---------- マージキャノン方式の仲間ユニット列 ----------
  // 所持キャラがランダムに列(6マス)へ出現し、同じキャラ&同じLvをドラッグで合体させると
  // 1段階強いユニットになる（Pumpkin Defense: Merge Cannon を参考）。
  // 武器タイプを持つキャラはその場から自動攻撃し、持たないキャラ(サポート系)はオーラのみ。
  function slotAt(x, y) {
    for (let i = 0; i < ROW_SLOTS.length; i++) {
      if (Math.hypot(x - ROW_SLOTS[i].x, y - ROW_SLOTS[i].y) < 24) return i;
    }
    return -1;
  }

  function spawnPoolKeys() {
    const pool = party.length ? party : Object.keys(roster);
    return pool.length ? pool : ['ace'];
  }

  function maybeSpawnUnit(dt) {
    S.unitSpawnTimer -= dt;
    if (S.unitSpawnTimer > 0) return;
    const emptyIdx = [];
    S.row.forEach((u, i) => { if (!u) emptyIdx.push(i); });
    if (emptyIdx.length === 0) { S.unitSpawnTimer = 600; return; }
    const monitorMul = 1 - Math.min(0.5, upgrades.monitor * 0.12);
    S.unitSpawnTimer = (4000 + Math.random() * 1400) * S.rowSpawnRateMul * monitorMul;
    const pool = spawnPoolKeys();
    const key = pool[Math.floor(Math.random() * pool.length)];
    const idx = emptyIdx[Math.floor(Math.random() * emptyIdx.length)];
    S.row[idx] = { key, level: 1, timer: 200 };
    spawnFx(ROW_SLOTS[idx].x, ROW_SLOTS[idx].y - 28, '新戦力!', '#8fbf6a', 700);
  }

  function updateRowUnits(dt) {
    S.row.forEach((u, i) => {
      if (!u) return;
      const def = CHARACTERS.find((c) => c.key === u.key);
      if (!def || !def.weaponType) return; // サポート型は自ら攻撃しない(オーラのみ)
      u.timer -= dt;
      if (u.timer > 0) return;
      const lv = u.level;
      const pos = ROW_SLOTS[i];
      let frMul = S.rowFireRateMul * S.partyAgg.basicFireRateMul;
      if (S.partyAgg.dashScale > 0 && !S.isExtraStage && S.elapsed / S.stageDuration > 0.7) {
        frMul *= Math.max(0.3, 1 - 0.5 * S.partyAgg.dashScale);
      }
      if (def.weaponType === 'basic') {
        u.timer = Math.max(260, (850 - lv * 55) * frMul);
        S.bullets.push({ kind: 'basic', x: pos.x, y: pos.y - 16, dmgBase: (8 + lv * 5) * S.rowDmgMul, hitSet: new Set() });
      } else if (def.weaponType === 'pierce') {
        u.timer = Math.max(900, (2000 - lv * 85) * frMul);
        S.bullets.push({ kind: 'pierce', x: pos.x, y: pos.y - 16, dmgBase: (12 + lv * 6) * S.rowDmgMul, halfWidth: COL_W * 0.4, hitSet: new Set() });
      } else if (def.weaponType === 'bomb') {
        u.timer = Math.max(1100, (2300 - lv * 110) * frMul);
        S.bombs.push({ x: pos.x, y: pos.y - 16, dmgBase: (14 + lv * 7) * S.rowDmgMul, radius: 46 + lv * 9 });
      } else if (def.weaponType === 'knock') {
        u.timer = Math.max(1200, (3000 - lv * 190) * frMul);
        const dist = 48 + lv * 15;
        for (const e of S.entities) { if (Math.abs(e.x - pos.x) < COL_W * 0.55 && e.y > pos.y) e.y = Math.max(20, e.y - dist); }
        spawnExplosion(pos.x, pos.y, 40 + dist, '255,181,71');
      } else if (def.weaponType === 'freeze') {
        u.timer = Math.max(1100, (2400 - lv * 95) * frMul);
        const target = S.entities.filter((e) => Math.abs(e.x - pos.x) < COL_W * 0.55).sort((a, b) => b.y - a.y)[0];
        if (target) {
          const freezeChance = lv >= 8 ? 0.4 : 0;
          const full = Math.random() < freezeChance;
          target.slowUntil = performance.now() + (1200 + lv * 200);
          target.slowMul = full ? 0 : 0.35;
          spawnFx(target.x, target.y - 20, full ? 'ストップ!' : 'リスケ…', '#8fe3ff', 700);
        }
      } else if (def.weaponType === 'trap') {
        const maxCount = 1 + Math.floor(lv / 4);
        if (S.traps.filter((tr) => Math.abs(tr.x - pos.x) < 10).length < maxCount) {
          u.timer = 1300;
          const dur = 3800 + lv * 500;
          S.traps.push({ x: pos.x, y: pos.y + 44, life: dur, maxLife: dur, tickTimer: 0, dmg: 4 + lv * 1.6 });
        } else {
          u.timer = 500;
        }
      }
    });
  }

  // ---------- 編成中の仲間による継続効果(回復/コイン消費/HP消費/社内ニート発動/うわさ話) ----------
  function updatePartyTicks(dt) {
    const a = S.partyAgg;
    if (a.hpRegenPerSec > 0 && S.hp < S.maxHp) S.hp = Math.min(S.maxHp, S.hp + a.hpRegenPerSec * dt / 1000);
    if (a.hpDrainPerSec > 0) S.hp = Math.max(1, S.hp - a.hpDrainPerSec * dt / 1000); // 部長のせいでも0にはしない
    if (a.coinDrainPerSec > 0) S.coins = Math.max(0, S.coins - a.coinDrainPerSec * dt / 1000);
    if (a.neetTriggerPerSec > 0 && S.entities.length > 0 && Math.random() < a.neetTriggerPerSec * dt / 1000) {
      spawnFx(CW / 2, CH / 2, '社内ニート、本気を出す!!', '#ffd54f', 1400);
      for (const e of S.entities) { const c = Math.ceil(e.coin / 2); S.coins += c; S.runCoins += c; }
      S.entities = [];
    }
    if (a.uwasaDmgPerSec > 0) {
      for (const e of S.entities.slice()) {
        e.hp -= a.uwasaDmgPerSec * dt / 1000;
        if (e.hp <= 0) killEnemy(e);
      }
    }
    if (a.hpRegenPerSec > 0 || a.hpDrainPerSec > 0 || a.coinDrainPerSec > 0) updateHUD();
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

    maybeSpawnUnit(dt);
    updateRowUnits(dt);
    updatePartyTicks(dt);

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

    // アイテムは自キャラが動かなくなったため、レーン位置に関わらず自陣付近まで落ちたら自動回収する。
    // pickupRangeが高いほど早め(手前)に回収できる。
    for (let i = S.items.length - 1; i >= 0; i--) {
      const it = S.items[i];
      it.y += it.speed * dt / 1000;
      if (it.y > DEFENSE_LINE_Y - 30 - S.runBuffs.pickupRange) {
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

  // ユニット列を描画する。武器タイプ持ちは金色、サポート系は脈打つ水色のオーラ。
  // ドラッグ中のユニットは元スロットを隠し、指の位置にゴーストとして追従表示する。
  function renderRow() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ROW_SLOTS.forEach((pos, i) => {
      if (i === S.dragSlot) return;
      const u = S.row[i];
      ctx.save();
      if (u) {
        const def = CHARACTERS.find((c) => c.key === u.key);
        if (def && def.weaponType) {
          ctx.fillStyle = 'rgba(255,181,71,0.22)';
          ctx.strokeStyle = 'rgba(255,181,71,0.9)';
        } else {
          const pulse = 0.5 + Math.sin(performance.now() / 260) * 0.5;
          ctx.fillStyle = `rgba(159,216,255,${0.12 + pulse * 0.1})`;
          ctx.strokeStyle = 'rgba(159,216,255,0.8)';
        }
        circle(pos.x, pos.y, 20);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.font = '20px sans-serif';
        if (def) ctx.fillText(def.icon, pos.x, pos.y);
        ctx.font = 'bold 10px sans-serif';
        ctx.fillStyle = '#ffd54f';
        ctx.fillText(`Lv${u.level}`, pos.x, pos.y + 27);
      } else {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    });
    if (S.dragSlot >= 0 && S.dragPos && S.row[S.dragSlot]) {
      const u = S.row[S.dragSlot];
      const def = CHARACTERS.find((c) => c.key === u.key);
      ctx.save();
      ctx.fillStyle = 'rgba(255,213,79,0.3)';
      circle(S.dragPos.x, S.dragPos.y, 24);
      ctx.font = '24px sans-serif';
      if (def) ctx.fillText(def.icon, S.dragPos.x, S.dragPos.y);
      ctx.restore();
    }
  }

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

    renderRow();

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
    if (S.shopReturn === 'playing') showScreen('screen-playing');
    else if (S.shopReturn === 'pause') showScreen('screen-pause');
    else goTitle();
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

  // ---------- 仲間編成・採用ガチャ ----------
  function displayCharName(def, owned) {
    if (!owned) return def.name;
    if (def.evoNames) {
      let idx = 0;
      for (let i = 0; i < def.evoThresholds.length; i++) { if (owned.dupes >= def.evoThresholds[i]) idx = i; }
      return def.evoNames[idx];
    }
    return def.name + (owned.level >= def.maxLv || owned.level >= 10 ? '★' : '');
  }

  function pullGacha() {
    const r = Math.random() * 100;
    const rarity = r < 2.5 ? 'SSR' : r < 25 ? (Math.random() < 0.5 ? 'SR' : 'R') : 'N';
    const pool = CHARACTERS.filter((c) => c.rarity === rarity);
    const picked = pool[Math.floor(Math.random() * pool.length)];
    const owned = roster[picked.key];
    let isNew = false;
    if (!owned) {
      roster[picked.key] = { dupes: 1, level: 1 };
      isNew = true;
    } else {
      owned.dupes += 1;
      owned.level = Math.min(10, owned.level + 1);
    }
    saveProgress();
    return { picked, isNew, dupes: roster[picked.key].dupes };
  }

  // レア度が高いほど「溜め」を長くし、開示の瞬間の演出を派手にする
  const RARITY_REVEAL_DELAY = { SSR: 1800, SR: 1100, R: 480, N: 320 };
  const RARITY_PARTICLE_COLORS = {
    SSR: ['#ffd54f', '#fff2b0', '#ffb300', '#ffffff'],
    SR: ['#c792ea', '#e6c6ff', '#9b5fd1', '#ffffff'],
  };

  function spawnGachaParticles(count, colors) {
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'gacha-particle';
      const angle = Math.random() * Math.PI * 2;
      const dist = 70 + Math.random() * 160;
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDelay = `${Math.random() * 150}ms`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 1300);
    }
  }

  function flashScreen(variant, multi) {
    const f = document.createElement('div');
    f.className = `gacha-flash ${multi ? 'multi' : 'playing'} ${variant}`;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), multi ? 1150 : 650);
  }

  function showGachaResult(result) {
    const owned = roster[result.picked.key];
    const rarity = result.picked.rarity;
    EL.gachaResultRarity.textContent = result.picked.seasonal ? `${rarity}　${result.picked.seasonal}` : rarity;
    if (result.picked.art) EL.gachaResultIcon.innerHTML = result.picked.art;
    else EL.gachaResultIcon.textContent = result.picked.icon;
    EL.gachaResultName.textContent = displayCharName(result.picked, owned);
    EL.gachaResultNote.textContent = result.isNew ? '新しく採用しました！' : `重複採用(${result.dupes}人目) → Lv.${owned.level}に強化`;
    EL.gachaResultNewBadge.classList.toggle('hidden', !result.isNew);
    EL.gachaChargeBanner.textContent = rarity === 'SSR' ? '🎉SSR確定!!🎉' : rarity === 'SR' ? 'SR確定！' : '';
    EL.gachaResultBox.className = `revealing rar-${rarity}`;
    if (rarity === 'SSR' || rarity === 'SR') EL.gachaResultBox.classList.add(`charging-${rarity}`);
    EL.gachaResultModal.classList.remove('hidden');
    setTimeout(() => {
      EL.gachaResultBox.classList.remove('revealing', 'charging-SSR', 'charging-SR');
      EL.gachaResultBox.classList.add('pop');
      if (rarity === 'SSR') {
        flashScreen('flash-gold', true);
        spawnGachaParticles(60, RARITY_PARTICLE_COLORS.SSR);
        setTimeout(() => spawnGachaParticles(30, RARITY_PARTICLE_COLORS.SSR), 250);
        EL.gachaResultBox.classList.add('shake');
      } else if (rarity === 'SR') {
        flashScreen('flash-purple');
        spawnGachaParticles(20, RARITY_PARTICLE_COLORS.SR);
      }
    }, RARITY_REVEAL_DELAY[rarity] || 400);
  }

  function doGachaPull(free) {
    if (!free && !GACHA_FREE_TEST) {
      if (S.coins < GACHA_COST) return;
      S.coins -= GACHA_COST;
      saveProgress();
    }
    showGachaResult(pullGacha());
    renderRoster();
    updateHUD();
  }

  function doGachaPullX10() {
    if (!GACHA_FREE_TEST && S.coins < GACHA_COST * 10) return;
    if (!GACHA_FREE_TEST) { S.coins -= GACHA_COST * 10; saveProgress(); }
    const results = [];
    for (let i = 0; i < 10; i++) results.push(pullGacha());
    const counts = { SSR: 0, SR: 0, R: 0, N: 0 };
    EL.gachaX10Grid.innerHTML = '';
    results.forEach((res, i) => {
      counts[res.picked.rarity] += 1;
      const owned = roster[res.picked.key];
      const card = document.createElement('div');
      card.className = `gacha-x10-card rar-${res.picked.rarity}`;
      card.style.animationDelay = `${i * 60}ms`;
      card.innerHTML =
        (res.isNew ? '<div class="gacha-x10-card-new">NEW</div>' : '') +
        `<div class="gacha-x10-card-icon">${res.picked.art || res.picked.icon}</div>` +
        `<div class="gacha-x10-card-rarity">${res.picked.rarity}</div>` +
        `<div class="gacha-x10-card-name">${displayCharName(res.picked, owned)}</div>`;
      EL.gachaX10Grid.appendChild(card);
    });
    EL.gachaX10Summary.textContent = `SSR×${counts.SSR}　SR×${counts.SR}　R×${counts.R}　N×${counts.N}`;
    EL.gachaResultX10Modal.classList.remove('hidden');
    EL.gachaResultX10Box.classList.remove('jackpot');
    if (counts.SSR > 0) {
      setTimeout(() => {
        flashScreen('flash-gold', true);
        spawnGachaParticles(50 + counts.SSR * 15, RARITY_PARTICLE_COLORS.SSR);
        setTimeout(() => spawnGachaParticles(30, RARITY_PARTICLE_COLORS.SSR), 250);
        EL.gachaResultX10Box.classList.add('jackpot');
      }, 300);
    } else if (counts.SR > 0) {
      setTimeout(() => {
        flashScreen('flash-purple');
        spawnGachaParticles(14, RARITY_PARTICLE_COLORS.SR);
      }, 300);
    }
    renderRoster();
    updateHUD();
  }

  function toggleParty(key) {
    const idx = party.indexOf(key);
    if (idx >= 0) party.splice(idx, 1);
    else { if (party.length >= PARTY_MAX) return; party.push(key); }
    saveProgress();
    renderRoster();
  }

  const RARITY_ORDER = { SSR: 0, SR: 1, R: 2, N: 3 };

  function renderRoster() {
    EL.rosterCoins.textContent = S.coins;
    EL.rosterPartyCount.textContent = party.length;
    EL.btnGachaPull.disabled = !GACHA_FREE_TEST && S.coins < GACHA_COST;
    EL.btnGachaPullX10.disabled = !GACHA_FREE_TEST && S.coins < GACHA_COST * 10;
    EL.rosterList.innerHTML = '';
    // 採用済み（レア度が高い順）を先頭にまとめ、未採用は後ろに回す。
    // ガチャで引いたキャラが「？？？未採用」の下に埋もれて見つからない、という問題への対処。
    const sorted = CHARACTERS.slice().sort((a, b) => {
      const ownedA = !!roster[a.key], ownedB = !!roster[b.key];
      if (ownedA !== ownedB) return ownedA ? -1 : 1;
      return RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity];
    });
    for (const def of sorted) {
      const owned = roster[def.key];
      const inParty = party.includes(def.key);
      const div = document.createElement('div');
      div.className = `roster-item rarity-${def.rarity}${owned ? ' owned' : ''}${inParty ? ' in-party' : ''}`;
      const iconHtml = owned ? (def.art || def.icon) : '❔';
      div.innerHTML =
        `<div class="roster-item-icon">${iconHtml}</div>` +
        `<div class="roster-item-info">` +
          `<div class="roster-item-name">${owned ? displayCharName(def, owned) : '？？？'}${owned && def.seasonal ? ` <span class="seasonal-badge">${def.seasonal}</span>` : ''}</div>` +
          `<div class="roster-item-tag">${def.rarity} ${ROLE_LABEL[def.role]}</div>` +
          `<div class="roster-item-desc">${owned ? def.desc : '採用するまで詳細は不明'}</div>` +
        `</div>` +
        `<div class="roster-item-status">${owned ? (inParty ? '✅編成中' : `Lv.${owned.level}(${owned.dupes}人)<br><span class="roster-tap-hint">タップで編成</span>`) : '未採用'}</div>`;
      if (owned) div.addEventListener('click', () => toggleParty(def.key));
      EL.rosterList.appendChild(div);
    }
  }

  function openRoster(returnTo) {
    rosterReturn = returnTo;
    renderRoster();
    showScreen('screen-roster');
  }
  function closeRoster() {
    if (rosterReturn === 'pause') showScreen('screen-pause');
    else goTitle();
  }

  // ---------- リワード広告シミュレーション ----------
  function playRewardAdThen(onComplete) {
    EL.adRewardModal.classList.remove('hidden');
    let count = 5;
    EL.adRewardCountdown.textContent = String(count);
    const timer = setInterval(() => {
      count -= 1;
      EL.adRewardCountdown.textContent = String(count);
      if (count <= 0) {
        clearInterval(timer);
        EL.adRewardModal.classList.add('hidden');
        onComplete();
      }
    }, 1000);
  }

  function watchAdContinue() {
    playRewardAdThen(() => {
      S.hp = Math.round(S.maxHp * 0.5);
      S.state = 'playing';
      showScreen('screen-playing');
      updateHUD();
    });
  }

  // ---------- イベント登録 ----------
  EL.btnStart.addEventListener('click', () => { S.day = 0; S.isExtraStage = false; goStageIntro(); });
  EL.btnStageGo.addEventListener('click', beginStagePlay);
  EL.btnOpenShopTitle.addEventListener('click', () => openShop('title'));
  EL.btnOpenShop.addEventListener('click', () => openShop('playing'));
  EL.btnOpenShopPause.addEventListener('click', () => openShop('pause'));
  EL.btnShopClose.addEventListener('click', closeShop);
  EL.btnOpenRosterTitle.addEventListener('click', () => openRoster('title'));
  EL.btnOpenRosterPause.addEventListener('click', () => openRoster('pause'));
  EL.btnRosterClose.addEventListener('click', closeRoster);
  EL.btnGachaPull.addEventListener('click', () => doGachaPull(false));
  EL.btnGachaPullX10.addEventListener('click', doGachaPullX10);
  EL.btnGachaAd.addEventListener('click', () => playRewardAdThen(() => doGachaPull(true)));
  EL.btnGachaResultClose.addEventListener('click', () => EL.gachaResultModal.classList.add('hidden'));
  EL.btnGachaX10Close.addEventListener('click', () => EL.gachaResultX10Modal.classList.add('hidden'));
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

  // 操作: ユニットスロットを掴んでドラッグ→同じキャラ&同じLvの上に離すと合体。
  // 空きスロットに離せば移動、違うユニットの上に離せば入れ替え。スロット外のタップは応援攻撃。
  EL.canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    if (S.state !== 'playing') return;
    const { x, y } = canvasPos(ev.clientX, ev.clientY);
    const idx = slotAt(x, y);
    if (idx >= 0 && S.row[idx]) {
      S.dragSlot = idx;
      S.dragPos = { x, y };
    } else {
      handleTapDamage(x, y);
    }
  });
  EL.canvas.addEventListener('pointermove', (ev) => {
    if (S.dragSlot < 0) return;
    ev.preventDefault();
    S.dragPos = canvasPos(ev.clientX, ev.clientY);
  });
  window.addEventListener('pointerup', (ev) => {
    if (S.dragSlot < 0) return;
    const srcIdx = S.dragSlot;
    const { x, y } = canvasPos(ev.clientX, ev.clientY);
    S.dragSlot = -1;
    S.dragPos = null;
    const targetIdx = slotAt(x, y);
    if (targetIdx < 0 || targetIdx === srcIdx) return;
    const src = S.row[srcIdx];
    const tgt = S.row[targetIdx];
    if (!src) return;
    if (!tgt) {
      S.row[targetIdx] = src;
      S.row[srcIdx] = null;
    } else if (tgt.key === src.key && tgt.level === src.level) {
      S.row[targetIdx] = { key: src.key, level: src.level + 1, timer: 200 };
      S.row[srcIdx] = null;
      spawnFx(ROW_SLOTS[targetIdx].x, ROW_SLOTS[targetIdx].y - 30, `合体! Lv.${src.level + 1}`, '#ffd54f', 1000);
    } else {
      S.row[targetIdx] = src;
      S.row[srcIdx] = tgt;
    }
  });
  window.addEventListener('pointercancel', () => { S.dragSlot = -1; S.dragPos = null; });

  // ---------- 起動 ----------
  loadSave();
  goTitle();
  requestAnimationFrame(loop);
})();
