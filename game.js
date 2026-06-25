const {
  MAX_HP, MAX_ITEMS, START_MONEY,
  RPS, HAND_BEATS, MAP_ORDER, LOCS, ITEMS, EVENTS, SHOP_ITEMS,
} = require('./constants');

// ===== 工具函数 =====
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function randItem(a) { return a[Math.floor(Math.random() * a.length)]; }
function isAdjacent(locA, locB) {
  if (locA === locB) return true;
  if (locA.startsWith('home') && locB === 'shop') return true;
  if (locB.startsWith('home') && locA === 'shop') return true;
  if (locA.startsWith('home') && locB.startsWith('home')) return false;
  const iA = MAP_ORDER.indexOf(locA), iB = MAP_ORDER.indexOf(locB);
  if (iA === -1 || iB === -1) return false;
  return Math.abs(iA - iB) <= 1;
}

// ===== 玩家可见信息（信息迷雾—只给每个玩家看他们该看的）=====
function getPublicState(G, viewerId) {
  const players = G.players.map(p => {
    const base = {
      id: p.id, name: p.name, color: p.color,
      status: p.status, hp: p.hp,
      poisoned: p.poisoned,
      isAI: p.isAI,
      kills: p.kills || 0,
      trained: p.trained,
      aimed: p.aimed,
      itemCount: p.items.length,
      money: viewerId === p.id ? p.money : undefined,
    };
    // 自己能看到自己的完整信息和位置
    if (viewerId === p.id || p.status === 'dead' || G.phase === 'gameover') {
      base.loc = p.loc;
      base.items = p.items.map(i => ({ ...i }));
      base.hidden = p.hidden;
      base.protected = p.protected;
    } else {
      // 别人只能看到大概 — 隐藏具体道具和位置细节
      base.loc = p.loc; // 联机版应隐藏，但本地测试时公开
      base.items = [];
      base.hidden = false;
    }
    return base;
  });

  const locs = {};
  Object.entries(G.locs).forEach(([k, v]) => {
    locs[k] = { id: v.id, name: v.name, icon: v.icon, desc: v.desc, owner: v.owner };
  });

  return {
    phase: G.phase,
    round: G.round,
    players,
    locs,
    winners: G.winners,
    winnerIdx: G.winnerIdx,
    actionsLeft: G.actionsLeft,
    winnersActions: G.winnersActions || null,
    rpsChoices: G.rpsChoices,
    pendingRps: G.pendingRps ? {
      type: G.pendingRps.type,
      label: G.pendingRps.label,
      atk: G.pendingRps.atk,
      def: G.pendingRps.def,
      // 只让本人看到进度细节
      winsNeeded: viewerId === G.pendingRps.atk || viewerId === G.pendingRps.defender ? G.pendingRps.winsNeeded : undefined,
      winsGot:    viewerId === G.pendingRps.atk || viewerId === G.pendingRps.defender ? G.pendingRps.winsGot    : undefined,
    } : null,
    rpsPhasePlayer: G.rpsPhasePlayer,
    currentEvent: G.currentEvent,
    blockedLoc: G.blockedLoc,
    log: G.log.slice(-30),
    winner: G.winner ? { id: G.winner.id, name: G.winner.name, color: G.winner.color } : null,
  };
}

// ===== 游戏引擎 =====
function createGame(config) {
  const { playerNames, playerAIs, playerDiff, enableEvents } = config;

  const players = playerNames.map((name, i) => ({
    id: i, name,
    color: ['#e85050', '#4a90e8', '#40c870', '#b060e0'][i],
    colorRaw: ['#e85050', '#4a90e8', '#40c870', '#b060e0'][i],
    hp: MAX_HP, status: 'sleeping',
    poisoned: false, trained: false, aimed: false, protected: false,
    money: START_MONEY,
    loc: `home${i}`,
    items: [],
    kills: 0, hidden: false,
    isAI: playerAIs[i] || false,
    aiDiff: playerDiff[i] || 'normal',
  }));

  const locs = {};
  players.forEach(p => {
    locs[`home${p.id}`] = { id: `home${p.id}`, name: `${p.name}的家`, icon: '🏠', desc: `${p.name}的住所`, owner: p.id, trap: false, poisoned: false, beartrap: false, airdropItem: null };
  });
  Object.values(LOCS).forEach(l => {
    locs[l.id] = { ...l, trap: false, poisoned: false, beartrap: false, airdropItem: null };
  });

  const G = {
    players, locs,
    round: 0,
    phase: 'setup',
    enableEvents: !!enableEvents,
    rpsChoices: {},
    rpsCurrent: 0, rpsRetries: 0,
    winners: [], winnerIdx: 0, actionsLeft: 0, winnersActions: {},
    log: [],
    currentEvent: null, blockedLoc: null,
    winner: null,
    pendingRps: null,
    rpsPhasePlayer: -1,
    finished: false,
  };

  const api = {
    getState(viewerId) { return getPublicState(G, viewerId); },
    // 暴露内部状态给 server（index.js 的 AI 触发需要读 rpsChoices/winners/phase）
    _internal() {
      return {
        rpsChoices: G.rpsChoices,
        rpsCurrent: G.rpsCurrent,
        rpsRetries: G.rpsRetries,
        winners: G.winners,
        winnerIdx: G.winnerIdx,
        actionsLeft: G.actionsLeft,
        winnersActions: G.winnersActions,
        phase: G.phase,
        pendingRps: G.pendingRps,
        rpsPhasePlayer: G.rpsPhasePlayer,
        round: G.round,
        finished: G.finished,
      };
    },

    startRound() {
      if (G.finished) return;
      G.round++;
      G.rpsChoices = {};
      G.rpsRetries = 0;
      G.currentEvent = null;
      G.blockedLoc = null;

      // 中毒伤害
      if (G.round > 1) {
        alive().forEach(p => {
          if (p.poisoned) {
            p.hp--;
            log(`🧪 <b style="color:${p.color}">${p.name}</b> 受到毒素侵蚀，失去1点HP！`, 'kill');
            if (p.hp <= 0) killPlayer(p.id, '毒发身亡');
          }
        });
        if (checkWin()) return;
      }

      if (alive().length < 2) { checkWin(); return; }

      // 随机事件
      if (G.enableEvents && G.round > 1) {
        const evt = randItem(EVENTS);
        G.currentEvent = evt;
        log(`🎲 事件：${evt.icon} ${evt.name} — ${evt.desc}`, 'good');
        if (evt.id === 'fire') {
          G.blockedLoc = randItem(MAP_ORDER);
          log(`🔥 ${locs[G.blockedLoc].icon}${locs[G.blockedLoc].name} 火灾封锁！`, 'kill');
        }
        if (evt.id === 'cleanse') {
          Object.values(locs).forEach(l => { l.trap = false; l.poisoned = false; l.beartrap = false; delete l.airdropItem; });
        }
        if (evt.id === 'airdrop') {
          const dropLoc = randItem(MAP_ORDER);
          const loot = randItem(['sniper', 'taser', 'bomb', 'enhanced', 'stimulant']);
          locs[dropLoc].airdropItem = loot;
          log(`🚁 空投落在${locs[dropLoc].icon}${locs[dropLoc].name}！`, 'good');
        }
      }

      G.rpsCurrent = 0;
      G.phase = 'round_intro';
      // 1.5s 后进入猜拳阶段（参考单机版动画）
      if (G._roundIntroTimer) clearTimeout(G._roundIntroTimer);
      G._roundIntroTimer = setTimeout(() => {
        G._roundIntroTimer = null;
        if (G.phase === 'round_intro') {
          G.phase = 'rps_cover';
        }
      }, 1500);
    },

    // 玩家出拳（允许在 rps_cover 和 rps_pick 阶段出拳）
    playerRpsPick(pid, hand) {
      if (G.phase !== 'rps_pick' && G.phase !== 'rps_cover') return;
      const p = getP(pid);
      if (!p || p.isAI) return;
      G.rpsChoices[pid] = hand;
      G.rpsCurrent++;
      if (G.rpsCurrent >= alive().length) G.phase = 'rps_reveal';
      else G.phase = 'rps_cover';
    },

    // AI 出拳（开局猜拳）
    aiRpsPick(pid) {
      if (G.phase !== 'rps_pick' && G.phase !== 'rps_cover') return;
      const p = getP(pid);
      if (!p || !p.isAI) return;
      G.rpsChoices[pid] = randItem(RPS);
      G.rpsCurrent++;
      if (G.rpsCurrent >= alive().length) G.phase = 'rps_reveal';
      else G.phase = 'rps_cover';
    },

    // 结算猜拳
    resolveRps() {
      if (G.phase !== 'rps_reveal') return;
      const result = resolveMultiRPS(G.rpsChoices);
      if (!result) {
        G.rpsRetries++;
        if (G.rpsRetries >= 3) {
          G.winners = shuffle(aliveIds());
          G.winnerIdx = 0;
          G.actionsLeft = 1;
          // 每个人保存行动点
          G.winnersActions = {};
          G.winners.forEach(id => { G.winnersActions[id] = 1; });
          startActionPhase();
        } else {
          G.rpsChoices = {};
          G.rpsCurrent = 0;
          G.phase = 'rps_cover';
        }
        return;
      }
      const apw = result.actionsPerWinner;
      result.winners.forEach(id => log(`🏆 ${getP(id).name} 获胜，获得 ${apw} 行动点`));
      G.winners = shuffle([...result.winners]);
      G.winnerIdx = 0;
      G.actionsLeft = apw;
      G.winnersActions = {};
      G.winners.forEach(id => { G.winnersActions[id] = apw; });
      startActionPhase();
    },

    // ===== 玩家动作 =====
    doMove(pid, destId) {
      const p = getP(pid);
      if (!p || p.status === 'dead') return;
      const loc = locs[destId];
      if (!loc) return; // 防止客户端传入非法 destId
      if (G.blockedLoc === destId) return;
      // 禁止进入别人家
      if (destId.startsWith('home') && destId !== `home${pid}`) return;
      p.loc = destId;
      log(`🚶 ${p.name} 移动到了 ${loc.icon}${loc.name}`);

      if (loc.trap && loc.owner !== pid) { loc.trap = false; p.status = 'stunned'; log(`⚙️ ${p.name} 触发了陷阱！`, 'kill'); }
      if (loc.beartrap) { loc.beartrap = false; p.status = 'stunned'; p.hp--; log(`🪤 ${p.name} 踩中了捕兽夹！`, 'kill'); if (p.hp <= 0) killPlayer(pid, '被捕兽夹害死'); }
      if (loc.poisoned && p.status !== 'dead') { loc.poisoned = false; p.poisoned = true; log(`🧪 ${p.name} 中毒了！`, 'kill'); }
      // 伏击
      const ambusher = alive().find(x => x.id !== pid && x.loc === destId && x.hidden);
      if (ambusher && p.status !== 'dead') {
        ambusher.hidden = false;
        log(`👻 ${ambusher.name} 伏击了 ${p.name}！`, 'kill');
        dealDamage(pid, ambusher.items.some(i => i.id === 'enhanced') ? 2 : 1, false, `被 ${ambusher.name} 伏击`, ambusher.id);
      }
      afterAction();
    },

    // 近战/远程攻击
    doWeaponAttack(atkId, defId, weaponId) {
      const atk = getP(atkId), def = getP(defId), wpn = ITEMS[weaponId];
      if (!atk || !def || atk.status === 'dead' || def.status === 'dead') return;
      if (wpn.ammo) useAmmo(atkId, weaponId);

      if (wpn.range === 'ranged' && atk.aimed) {
        atk.aimed = false;
        dealDamage(defId, wpn.dmg, wpn.ignoreVest, `被 ${atk.name} 精准击杀`, atkId);
        afterAction();
        return;
      }

      // 需要猜拳——通过pendingRps处理
      G.pendingRps = {
        type: 'combat', atk: atkId, def: defId,
        weaponId, wpn,
        winsNeeded: 1, winsGot: 0,
        onWin: () => {
          if (wpn.stun) {
            def.status = 'stunned';
            log(`⚡ ${atk.name} 用电击枪击晕了 ${def.name}`);
          } else {
            dealDamage(defId, wpn.dmg, wpn.ignoreVest, `被 ${atk.name} 用${wpn.name}击杀`, atkId);
            if (wpn.poisonOnHit && def.status !== 'dead') { def.poisoned = true; log(`🧪 ${def.name} 中毒了！`); }
          }
          afterAction();
        },
        onLose: () => { log(`${wpn.icon} ${atk.name} 的攻击被躲开了`); afterAction(); },
        choices: {},
      };
      G.phase = 'act_rps';
      G.rpsPhasePlayer = atkId;
    },

    doPunch(atkId, defId) {
      const def = getP(defId);
      if (!def) return;
      def.status = 'stunned';
      log(`👊 ${getP(atkId).name} 击晕了 ${def.name}`, 'kill');
      afterAction();
    },

    doBomb(atkId) {
      const atk = getP(atkId);
      if (!atk) return;
      removeItem(atkId, 'bomb');
      log(`💣 ${atk.name} 引爆了炸弹！`, 'kill');
      const allHere = playersAt(atk.loc).filter(p => p.id !== atkId);
      // 先判引爆者
      G.pendingRps = {
        type: 'bomb_self', atk: atkId, targets: allHere, targetIdx: 0,
        label: '💣 炸弹反噬',
        stage: 'self',
        onSelfSurvive: () => { nextBombTarget(); },
        onSelfDie: () => { dealDamage(atkId, 3, false, `被自己的炸弹炸死`); nextBombTarget(); },
      };
      G.phase = 'act_rps';
      G.rpsPhasePlayer = atkId;
      // bomb RPS is handled in the RPS resolver
    },

    doStrangle(atkId, defId) {
      const atk = getP(atkId);
      const def = getP(defId);
      if (!atk || !def || def.status === 'dead') return;
      // 同地点校验
      if (atk.loc !== def.loc) return;
      G.pendingRps = {
        type: 'combat', atk: atkId, def: defId,
        winsNeeded: 1, winsGot: 0,
        onWin: () => {
          def.hp--;
          log(`🤏 ${atk.name} 掐住了 ${def.name}，造成1伤害！`, 'kill');
          if (def.hp <= 0) killPlayer(defId, `被 ${atk.name} 掐死`, atkId);
          afterAction();
        },
        onLose: () => { log(`🤏 ${atk.name} 偷袭失败`); afterAction(); },
        choices: {},
      };
      G.phase = 'act_rps';
      G.rpsPhasePlayer = atkId;
    },

    // 技能/制造/治疗等需要"vs 命运"猜拳的动作
    startSkill(pid, skillId) {
      const p = getP(pid);
      if (!p || p.status === 'dead') return;
      let winsNeeded = 1, label = '', onWin = null, onLose = null;
      switch (skillId) {
        case 'makeBomb':
          winsNeeded = 2; label = '💣 制作炸弹';
          onWin = () => { addItem(pid, 'bomb'); log(`💣 ${p.name} 成功制作了炸弹！`, 'good'); };
          onLose = () => { log(`💣 ${p.name} 制作炸弹失败...`); };
          break;
        case 'makePoison':
          winsNeeded = 1; label = '🧪 制作毒药';
          onWin = () => { addItem(pid, 'poison'); log(`🧪 ${p.name} 成功制作了毒药！`, 'good'); };
          onLose = () => { log(`🧪 ${p.name} 制作毒药失败...`); };
          break;
        case 'enhanceDagger':
          winsNeeded = 1; label = '⚔️ 强化武器';
          onWin = () => {
            if (hasItem(pid, 'dagger')) removeItem(pid, 'dagger');
            addItem(pid, 'enhanced');
            log(`⚔️ ${p.name} 成功强化了匕首！`, 'good');
          };
          onLose = () => { log(`⚔️ ${p.name} 强化失败...`); };
          break;
        case 'makePoisonDagger':
          winsNeeded = 1; label = '🗡️ 淬毒匕首';
          onWin = () => {
            removeItem(pid, 'dagger'); removeItem(pid, 'poison');
            addItem(pid, 'poisoned_dagger');
            log(`🗡️ ${p.name} 成功制作了淬毒匕首！`, 'good');
          };
          onLose = () => { log(`🗡️ ${p.name} 淬毒失败，材料报废...`); };
          break;
        case 'makeBurstGun':
          winsNeeded = 1; label = '🔫 速射改装';
          onWin = () => {
            removeItem(pid, 'gun'); removeItem(pid, 'stimulant');
            addItem(pid, 'burst_gun');
            log(`🔫 ${p.name} 成功改装了速射手枪！`, 'good');
          };
          onLose = () => { log(`🔫 ${p.name} 改装失败...`); };
          break;
        case 'train':
          winsNeeded = 1; label = '💪 锻炼';
          onWin = () => { p.trained = true; log(`💪 ${p.name} 在公园刻苦锻炼！`, 'good'); };
          onLose = () => { log(`💪 ${p.name} 锻炼中断...`); };
          break;
        case 'searchPark':
          winsNeeded = 1; label = '🔍 搜索特殊物资';
          onWin = () => {
            const finds = ['stimulant', 'beartrap', 'bandage', 'binoculars'];
            const found = randItem(finds);
            addItem(pid, found);
            log(`🔍 ${p.name} 搜索到了 ${ITEMS[found].icon}${ITEMS[found].name}！`, 'good');
          };
          onLose = () => { log(`🔍 ${p.name} 什么也没找到...`); };
          break;
        case 'practiceRange':
          winsNeeded = 1; label = '🎯 瞄准射击';
          onWin = () => { p.aimed = true; log(`🎯 ${p.name} 练好了枪法！下次远程必中`, 'good'); };
          onLose = () => { log(`🎯 ${p.name} 脱靶了...`); };
          break;
        case 'exploreRuins':
          winsNeeded = 2; label = '🏚️ 探索废墟';
          onWin = () => {
            const finds = ['taser', 'sniper', 'bomb', 'enhanced'];
            const found = randItem(finds);
            if (found === 'enhanced' && hasItem(pid, 'dagger')) removeItem(pid, 'dagger');
            addItem(pid, found);
            log(`🏚️ ${p.name} 在废墟发现了 ${ITEMS[found].icon}${ITEMS[found].name}！`, 'good');
          };
          onLose = () => {
            p.hp--;
            log(`🏚️ ${p.name} 探索失败被碎石砸伤！`, 'kill');
            if (p.hp <= 0) killPlayer(pid, '被废墟碎石砸死');
          };
          break;
        case 'gamble':
          winsNeeded = 1; label = '🎰 赌博';
          onWin = () => { p.money += 3; log(`🎰 ${p.name} 赢了3金币！💰${p.money}`, 'good'); };
          onLose = () => { p.money = Math.max(0, p.money - 2); log(`🎰 ${p.name} 输光了...💰${p.money}`, 'kill'); };
          break;
        default:
          log(`⚠️ ${p.name} 尝试未知技能 ${skillId}`);
          afterAction();
          return;
      }
      G.pendingRps = {
        type: 'skill', atk: pid, defender: pid,  // 自己 vs 命运
        winsNeeded, winsGot: 0,
        onWin: () => { onWin(); afterAction(); },
        onLose: () => { onLose(); afterAction(); },
        choices: {},
        label,
      };
      G.phase = 'act_rps';
      G.rpsPhasePlayer = pid;
    },

    // 位置动作（不需猜拳）
    doLocAction(pid, actionId, payload) {
      const p = getP(pid);
      if (!p || p.status === 'dead') return;
      const loc = locs[p.loc];
      if (!loc) return;
      switch (actionId) {
        case 'rest':
          if (loc.id.startsWith('home')) {
            p.hp = Math.min(MAX_HP, p.hp + 1);
            log(`😴 ${p.name} 在家休息，恢复至${p.hp}HP`, 'good');
          }
          afterAction();
          break;
        case 'setHomeTrap':
          if (loc.id.startsWith('home') && loc.owner === pid && !loc.trap) {
            loc.trap = true;
            log(`⚙️ ${p.name} 在家中设下了陷阱`);
          }
          afterAction();
          break;
        case 'setWarehouseTrap':
          if (loc.id === 'warehouse' && !loc.trap) {
            loc.trap = true;
            log(`🪤 ${p.name} 在仓库设下了陷阱`);
          }
          afterAction();
          break;
        case 'searchWarehouse': {
          const finds = ['dagger', 'bandage', 'medkit', 'vest'];
          const found = randItem(finds);
          addItem(pid, found);
          log(`📦 ${p.name} 翻出了 ${ITEMS[found].icon}${ITEMS[found].name}！`, 'good');
          afterAction();
          break;
        }
        case 'buyShopItem': {
          const si = SHOP_ITEMS.find(s => s.id === payload.itemId);
          if (!si || loc.id !== 'shop') { afterAction(); return; }
          if (p.money < si.cost) { log(`💰 ${p.name} 钱不够`); afterAction(); return; }
          const owned = si.id === 'dagger' ? (hasItem(pid, 'dagger') || hasItem(pid, 'enhanced')) : hasItem(pid, si.id);
          if (owned) { log(`⚠️ ${p.name} 已拥有该物品`); afterAction(); return; }
          p.money -= si.cost;
          addItem(pid, si.id);
          log(`🏪 ${p.name} 购买了 ${ITEMS[si.id].icon}${ITEMS[si.id].name}（余额💰${p.money}）`, 'good');
          afterAction();
          break;
        }
        case 'pickAirdrop': {
          if (loc.airdropItem) {
            const dropId = loc.airdropItem;
            addItem(pid, dropId);
            log(`🚁 ${p.name} 捡到了空投中的 ${ITEMS[dropId].icon}${ITEMS[dropId].name}！`, 'good');
            delete loc.airdropItem;
          }
          afterAction();
          break;
        }
        case 'hospitalHeal':
          if (loc.id === 'hospital') {
            p.hp = MAX_HP;
            log(`💉 ${p.name} 在医院接受了全面治疗`, 'good');
          }
          afterAction();
          break;
        case 'hospitalCure':
          if (loc.id === 'hospital' && p.poisoned) {
            p.poisoned = false;
            log(`🧬 ${p.name} 成功解毒！`, 'good');
          }
          afterAction();
          break;
        case 'churchBless':
          if (loc.id === 'church' && !p.protected) {
            p.protected = true;
            log(`⛪ ${p.name} 在教堂祈祷获得神圣庇护`, 'good');
          }
          afterAction();
          break;
        case 'churchConfess':
          if (loc.id === 'church' && (p.poisoned || (p.kills || 0) >= 2)) {
            p.poisoned = false;
            p.kills = 0;
            log(`⛪ ${p.name} 虔诚忏悔，洗清罪孽！`, 'good');
          }
          afterAction();
          break;
        case 'rangeAmmo':
          if (loc.id === 'range' && hasItem(pid, 'gun')) {
            const g = p.items.find(it => it.id === 'gun');
            if (g) { g.ammo = (g.ammo || 0) + 1; log(`🔫 ${p.name} 领取1发手枪子弹（剩余${g.ammo}发）`, 'good'); }
          }
          afterAction();
          break;
        case 'barIntel':
          if (loc.id === 'bar' && p.hp >= 2) {
            p.hp--;
            const enemies = alive().filter(x => x.id !== pid);
            if (enemies.length > 0) {
              const target = enemies[Math.floor(Math.random() * enemies.length)];
              const tLoc = locs[target.loc];
              log(`🍺 ${p.name} 买到了情报：${target.name} 在 ${tLoc.icon}${tLoc.name}`, 'good');
            }
          }
          afterAction();
          break;
        case 'buyBlackMarket': {
          if (loc.id !== 'blackmarket') { afterAction(); return; }
          const bm = payload && payload.itemId;
          const cost = G.currentEvent && G.currentEvent.id === 'discount' ? 0 : 1;
          const needDagger = bm === 'enhanced' && !hasItem(pid, 'dagger');
          if (p.hp <= cost || needDagger) { log(`🏴 ${p.name} 买不起`); afterAction(); return; }
          if (cost > 0) p.hp -= cost;
          if (bm === 'enhanced' && hasItem(pid, 'dagger')) removeItem(pid, 'dagger');
          addItem(pid, bm);
          log(`🏴 ${p.name} 用血换到了 ${ITEMS[bm].icon}${ITEMS[bm].name}`, 'good');
          afterAction();
          break;
        }
        case 'hide':
          p.hidden = true;
          log(`👻 ${p.name} 蹲伏隐藏`, 'good');
          afterAction();
          break;
        case 'unhide':
          p.hidden = false;
          log(`🦅 ${p.name} 解除了隐藏`);
          afterAction();
          break;
        case 'wakeUp':
          if (p.status === 'sleeping') { p.status = 'awake'; log(`🛏️ ${p.name} 起床了`); }
          afterAction();
          break;
        case 'recoverStun':
          if (p.status === 'stunned') { p.status = 'awake'; log(`💫 ${p.name} 清醒了过来`); }
          afterAction();
          break;
        default:
          afterAction();
      }
    },

    useItem(pid, itemId) {
      const p = getP(pid);
      if (!p || p.status === 'dead') return;
      const item = p.items.find(it => it.id === itemId);
      if (!item) return;
      switch (itemId) {
        case 'medkit':
          removeItem(pid, 'medkit');
          p.hp = Math.min(MAX_HP, p.hp + 2);
          log(`💊 ${p.name} 使用急救包，恢复至${p.hp}HP`, 'good');
          afterAction();
          break;
        case 'bandage':
          removeItem(pid, 'bandage');
          p.hp = Math.min(MAX_HP, p.hp + 1);
          log(`🩹 ${p.name} 使用绷带，恢复至${p.hp}HP`, 'good');
          afterAction();
          break;
        case 'stimulant':
          removeItem(pid, 'stimulant');
          G.actionsLeft += 2;
          log(`💉 ${p.name} 注射兴奋剂！行动力暴增！`, 'good');
          afterAction();
          break;
        case 'poison': {
          removeItem(pid, 'poison');
          const loc = locs[p.loc];
          if (loc) loc.poisoned = true;
          log(`🧪 ${p.name} 在当前位置投放了毒药！`);
          afterAction();
          break;
        }
        case 'beartrap': {
          removeItem(pid, 'beartrap');
          const loc = locs[p.loc];
          if (loc) loc.beartrap = true;
          log(`🪤 ${p.name} 在当前位置放置了捕兽夹！`);
          afterAction();
          break;
        }
        case 'binoculars': {
          removeItem(pid, 'binoculars');
          const enemies = alive().filter(x => x.id !== pid);
          if (enemies.length > 0) {
            const target = enemies[Math.floor(Math.random() * enemies.length)];
            const tLoc = locs[target.loc];
            log(`🔭 ${p.name} 用望远镜看到了 ${target.name} 在 ${tLoc.icon}${tLoc.name}`, 'good');
          } else {
            log(`🔭 ${p.name} 用望远镜观察四周，什么也没看到...`);
          }
          afterAction();
          break;
        }
        case 'talisman':
          if (p.protected) { log(`📿 ${p.name} 已有庇护`); afterAction(); return; }
          removeItem(pid, 'talisman');
          p.protected = true;
          log(`📿 ${p.name} 佩戴了护身符！`, 'good');
          afterAction();
          break;
        default:
          log(`⚠️ ${p.name} 尝试使用未知道具 (${itemId})`);
          afterAction();
      }
    },

    doSkip(pid) {
      const p = getP(pid);
      if (!p) return;
      log(`⏭️ ${p.name} 跳过`);
      afterAction();
    },

    // AI自动操作
    aiTurn(pid) {
      const p = getP(pid);
      if (!p || !p.isAI || p.status === 'dead') return;

      // 强制状态：睡眠/眩晕
      if (p.status === 'sleeping') { api.doLocAction(pid, 'wakeUp'); return; }
      if (p.status === 'stunned')  { api.doLocAction(pid, 'recoverStun'); return; }

      const loc = locs[p.loc];
      if (!loc) { afterAction(); return; }

      const others = alive().filter(x => x.id !== pid && x.loc === p.loc);
      const diff = p.aiDiff || 'normal';
      const rng = Math.random();

      // ===== 紧急处理 =====
      if (p.hp <= 1) {
        if (hasItem(pid, 'medkit')) { api.useItem(pid, 'medkit'); return; }
        if (hasItem(pid, 'bandage')) { api.useItem(pid, 'bandage'); return; }
        if (loc.id === 'hospital') { api.doLocAction(pid, 'hospitalHeal'); return; }
        const hosp = 'hospital';
        if (hosp && hosp !== p.loc && G.blockedLoc !== hosp) { api.doMove(pid, hosp); return; }
      }
      if (p.poisoned && loc.id === 'hospital') { api.doLocAction(pid, 'hospitalCure'); return; }

      // ===== 战斗：同地点有人 =====
      if (others.length > 0) {
        // 优先掐睡着的
        const sleeper = others.find(t => t.status === 'sleeping');
        if (sleeper && rng > 0.2) { api.doStrangle(pid, sleeper.id); return; }
        // 用 best weapon 攻击
        const target = [...others].sort((a, b) => a.hp - b.hp)[0];
        if (hasItem(pid, 'enhanced')) { api.doWeaponAttack(pid, target.id, 'enhanced'); return; }
        if (hasItem(pid, 'poisoned_dagger')) { api.doWeaponAttack(pid, target.id, 'poisoned_dagger'); return; }
        if (hasItem(pid, 'dagger')) { api.doWeaponAttack(pid, target.id, 'dagger'); return; }
        if (hasItem(pid, 'bomb') && others.length >= 2) { api.doBomb(pid); return; }
        if (hasItem(pid, 'bomb') && target.hp >= 2) { api.doBomb(pid); return; }
        // 没用刀就徒手击晕
        api.doPunch(pid, target.id); return;
      }

      // ===== 远程攻击（暴雨时禁用）=====
      const canRanged = !(G.currentEvent && G.currentEvent.id === 'rain');
      if (canRanged) {
        if (hasItem(pid, 'sniper') && getAmmo(pid, 'sniper') > 0) {
          const far = alive().filter(x => x.id !== pid && x.loc !== p.loc).sort((a, b) => a.hp - b.hp);
          if (far.length > 0 && far[0].hp >= 2) { api.doWeaponAttack(pid, far[0].id, 'sniper'); return; }
        }
        if (hasItem(pid, 'taser') && getAmmo(pid, 'taser') > 0) {
          const adj = alive().filter(x => x.id !== pid && x.loc !== p.loc && isAdjacent(p.loc, x.loc) && x.status === 'awake');
          if (adj.length > 0) { api.doWeaponAttack(pid, adj[0].id, 'taser'); return; }
        }
      }

      // ===== 当前位置动作 =====
      if (loc.id.startsWith('home')) {
        if (p.hp < MAX_HP) { api.doLocAction(pid, 'rest'); return; }
        if (loc.owner === pid && !loc.trap) { api.doLocAction(pid, 'setHomeTrap'); return; }
        // 离开家去办事
        const dest = pickAIDestination(pid);
        if (dest) { api.doMove(pid, dest); return; }
        api.doSkip(pid); return;
      }

      if (loc.id === 'shop') {
        if (!hasItem(pid, 'dagger') && !hasItem(pid, 'enhanced') && p.money >= 3) {
          api.doLocAction(pid, 'buyShopItem', { itemId: 'dagger' }); return;
        }
        if (!hasItem(pid, 'gun') && p.money >= 5) {
          api.doLocAction(pid, 'buyShopItem', { itemId: 'gun' }); return;
        }
        if (!hasItem(pid, 'vest') && p.money >= 4) {
          api.doLocAction(pid, 'buyShopItem', { itemId: 'vest' }); return;
        }
        if (!hasItem(pid, 'medkit') && p.money >= 3) {
          api.doLocAction(pid, 'buyShopItem', { itemId: 'medkit' }); return;
        }
      }

      if (loc.id === 'hospital') {
        if (p.hp < MAX_HP) { api.doLocAction(pid, 'hospitalHeal'); return; }
        if (p.poisoned) { api.doLocAction(pid, 'hospitalCure'); return; }
      }

      if (loc.id === 'church') {
        if (!p.protected && rng > 0.4) { api.doLocAction(pid, 'churchBless'); return; }
        if (p.poisoned || (p.kills || 0) >= 2) { api.doLocAction(pid, 'churchConfess'); return; }
      }

      if (loc.id === 'range') {
        if (!p.aimed) { api.startSkill(pid, 'practiceRange'); return; }
        if (hasItem(pid, 'gun')) { api.doLocAction(pid, 'rangeAmmo'); return; }
      }

      if (loc.id === 'park') {
        if (!p.trained) { api.startSkill(pid, 'train'); return; }
        if (rng > 0.5) { api.startSkill(pid, 'searchPark'); return; }
      }

      if (loc.id === 'lab') {
        if (!hasItem(pid, 'bomb') && rng > 0.3) { api.startSkill(pid, 'makeBomb'); return; }
        if (!hasItem(pid, 'poison')) { api.startSkill(pid, 'makePoison'); return; }
      }

      if (loc.id === 'warehouse') {
        if (!loc.trap && rng > 0.5) { api.doLocAction(pid, 'setWarehouseTrap'); return; }
        api.doLocAction(pid, 'searchWarehouse'); return;
      }

      if (loc.id === 'bar') {
        if (p.hp >= 2 && rng > 0.5) { api.doLocAction(pid, 'barIntel'); return; }
        if (p.money >= 2 && rng > 0.5) { api.startSkill(pid, 'gamble'); return; }
      }

      if (loc.id === 'blackmarket') {
        if (!hasItem(pid, 'bomb') && rng > 0.4) { api.doLocAction(pid, 'buyBlackMarket', { itemId: 'bomb' }); return; }
        if (!hasItem(pid, 'taser') && rng > 0.4) { api.doLocAction(pid, 'buyBlackMarket', { itemId: 'taser' }); return; }
      }

      if (loc.id === 'ruins' && p.hp >= 2 && rng > 0.3) { api.startSkill(pid, 'exploreRuins'); return; }

      // 空投拾取
      if (loc.airdropItem) { api.doLocAction(pid, 'pickAirdrop'); return; }

      // 移动决策
      const dest = pickAIDestination(pid);
      if (dest && dest !== p.loc) { api.doMove(pid, dest); return; }

      api.doSkip(pid);
    },

    // RPS猜拳提交（战斗/技能）
    rpsSubmit(pid, hand) {
      if (G.phase !== 'act_rps' || !G.pendingRps) return;
      const rps = G.pendingRps;

      if (rps.type === 'combat') {
        if (rps.choices[rps.atk] === undefined && pid === rps.atk) {
          rps.choices[rps.atk] = hand;
          G.rpsPhasePlayer = rps.def;
        } else if (rps.choices[rps.def] === undefined && pid === rps.def) {
          rps.choices[rps.def] = hand;
          resolveCombatRps();
        }
      } else if (rps.type === 'skill') {
        if (rps.choices.player === undefined && pid === rps.defender) {
          rps.choices.player = hand;
          rps.choices.fate = randItem(RPS);
          resolveSkillRps();
        }
      } else if (rps.type === 'bomb_self' && rps.stage === 'self' && pid === rps.atk) {
        rps.choices.player = hand;
        rps.choices.fate = randItem(RPS);
        const r = resolve1v1(rps.choices.player, rps.choices.fate);
        if (r === 'p1' || (r === 'tie' && getP(rps.atk).trained)) rps.onSelfSurvive();
        else rps.onSelfDie();
      } else if (rps.type === 'bomb_target' && pid === rps.currentTarget) {
        rps.choices.player = hand;
        rps.choices.fate = randItem(RPS);
        const r = resolve1v1(rps.choices.player, rps.choices.fate);
        if (r === 'p1' || (r === 'tie' && getP(rps.currentTarget).trained)) {
          log(`💣 ${getP(rps.currentTarget).name} 躲过了爆炸！`, 'good');
        } else {
          dealDamage(rps.currentTarget, 3, false, `被炸弹炸死`, rps.atk);
        }
        rps.targetIdx++;
        nextBombTarget();
      }
    },

    // 玩家跳过当前 RPS（炸弹求生等可选跳过场景备用，目前未启用）
    rpsSkip(pid) {
      if (G.phase !== 'act_rps' || !G.pendingRps) return;
      const rps = G.pendingRps;
      if (rps.type === 'combat' && pid === rps.def) {
        rps.choices[rps.def] = 'skip';
        // 视为挑战者胜利（被攻击方弃权）
        if (rps.choices[rps.atk]) {
          rps.winsGot = rps.winsNeeded;
          rps.onWin && rps.onWin();
          G.phase = 'act_turn';
          G.pendingRps = null;
        } else {
          G.rpsPhasePlayer = rps.atk;
        }
      }
    },
  };

  // ===== 内部函数 =====
  function alive() { return G.players.filter(p => p.status !== 'dead'); }
  function aliveIds() { return alive().map(p => p.id); }
  function getP(id) { return G.players[id]; }
  function playersAt(locId) { return alive().filter(p => p.loc === locId); }
  function hasItem(pid, itemId) { return getP(pid).items.some(it => it.id === itemId); }
  function removeItem(pid, itemId) { const p = getP(pid); const i = p.items.findIndex(it => it.id === itemId); if (i >= 0) p.items.splice(i, 1); }
  function addItem(pid, itemId) { const p = getP(pid); if (p.items.length >= MAX_ITEMS) { log(`⚠️ ${p.name} 背包已满！`); return false; } p.items.push({ ...ITEMS[itemId] }); return true; }
  function useAmmo(pid, itemId) { const g = getP(pid).items.find(it => it.id === itemId); if (g) { g.ammo--; if (g.ammo <= 0) removeItem(pid, itemId); } }
  function log(msg, cls = '') { G.log.push({ msg, cls }); }

  function killPlayer(pid, reason, killerId) {
    const p = getP(pid);
    p.status = 'dead'; p.hp = 0;
    log(`💀 ${p.name} ${reason}！`, 'kill');
    if (killerId !== undefined && getP(killerId).status !== 'dead') {
      getP(killerId).kills = (getP(killerId).kills || 0) + 1;
      if (getP(killerId).kills >= 2) log(`🏴 ${getP(killerId).name} 被通缉！`, 'kill');
    }
    checkWin();
  }

  function checkWin() {
    const al = alive();
    if (al.length <= 1) {
      G.phase = 'gameover';
      G.winner = al.length === 1 ? al[0] : null;
      G.finished = true;
      return true;
    }
    return false;
  }

  function dealDamage(defId, dmg, ignoreVest, source, atkId) {
    const def = getP(defId);
    let actual = dmg;
    if (def.protected && actual > 0) {
      def.protected = false; actual--;
      log(`📿 ${def.name} 的护身符抵消了1伤害！${actual > 0 ? `剩余${actual}点` : '完全抵挡！'}`, 'good');
      if (actual <= 0) return 0;
    }
    if (hasItem(defId, 'vest') && !ignoreVest && dmg > 0) {
      const vest = def.items.find(it => it.id === 'vest');
      vest.durability = (vest.durability || 2) - 1;
      actual = Math.max(0, dmg - 1);
      if (vest.durability <= 0) {
        def.items = def.items.filter(it => it.id !== 'vest');
        log(`🛡️ ${def.name} 的防弹衣彻底损坏！${actual > 0 ? `剩余${actual}点` : ''}`, 'kill');
      } else {
        log(`🛡️ ${def.name} 的防弹衣剩余${vest.durability}耐久`, actual > 0 ? 'kill' : 'good');
      }
    }
    if (actual > 0) {
      def.hp -= actual;
      if (def.hp <= 0) killPlayer(defId, source, atkId);
      else log(`💥 ${def.name} 受到${actual}伤害！`, 'kill');
    }
    return actual;
  }

  function resolveMultiRPS(choices) {
    const ids = Object.keys(choices).map(Number);
    const types = new Set(ids.map(id => choices[id]));
    if (types.size !== 2) return null;
    const [a, b] = [...types];
    const winType = HAND_BEATS[a] === b ? a : b;
    return { winners: ids.filter(id => choices[id] === winType), losers: ids.filter(id => choices[id] !== winType), actionsPerWinner: ids.filter(id => choices[id] !== winType).length };
  }

  function resolve1v1(c1, c2) {
    if (c1 === c2) return 'tie';
    return HAND_BEATS[c1] === c2 ? 'p1' : 'p2';
  }

  function resolveCombatRps() {
    const rps = G.pendingRps;
    const r = resolve1v1(rps.choices[rps.atk], rps.choices[rps.def]);
    const atkTrained = getP(rps.atk).trained;
    const defTrained = rps.def >= 0 && getP(rps.def).trained;
    if (r === 'tie' && atkTrained && !defTrained) { rps.winsGot++; }
    else if (r === 'tie') { rps.choices = {}; G.rpsPhasePlayer = rps.atk; return; }
    else if (r === 'p1') { rps.winsGot++; }
    else { rps.onLose(); G.phase = 'act_turn'; G.pendingRps = null; return; }

    if (rps.winsGot >= rps.winsNeeded) { rps.onWin(); G.phase = 'act_turn'; G.pendingRps = null; }
    else { rps.choices = {}; G.rpsPhasePlayer = rps.atk; }
  }

  function resolveSkillRps() {
    const rps = G.pendingRps;
    const r = resolve1v1(rps.choices.player, rps.choices.fate);
    if (r === 'tie' && getP(rps.defender).trained) { rps.winsGot++; }
    else if (r === 'tie') { rps.choices = {}; return; }
    else if (r === 'p1') { rps.winsGot++; }
    else { rps.onLose(); G.phase = 'act_turn'; G.pendingRps = null; return; }
    if (rps.winsGot >= rps.winsNeeded) { rps.onWin(); G.phase = 'act_turn'; G.pendingRps = null; }
    else { rps.choices = {}; }
  }

  function nextBombTarget() {
    const rps = G.pendingRps;
    while (rps.targetIdx < rps.targets.length) {
      const t = rps.targets[rps.targetIdx];
      rps.targetIdx++;
      if (t.status !== 'dead') {
        rps.currentTarget = t.id;
        rps.stage = 'target';
        rps.choices = {};
        G.rpsPhasePlayer = t.id;
        G.phase = 'act_rps';
        rps.label = `💣 炸弹求生 - ${t.name}`;
        return;
      }
    }
    // All done
    G.pendingRps = null;
    G.phase = 'act_turn';
    afterAction();
  }

  function startActionPhase() {
    if (G.winnerIdx >= G.winners.length) { finishRound(); return; }
    const pid = G.winners[G.winnerIdx];
    const p = getP(pid);
    if (!p || p.status === 'dead') { G.winnerIdx++; startActionPhase(); return; }
    G.phase = 'act_turn';
  }

  function afterAction() {
    if (G.finished) return;
    G.actionsLeft--;
    if (checkWin()) return;
    if (G.actionsLeft <= 0 || getP(G.winners[G.winnerIdx]).status === 'dead') {
      G.winnerIdx++;
      if (G.winnerIdx < G.winners.length) {
        const nextP = getP(G.winners[G.winnerIdx]);
        if (nextP && nextP.status !== 'dead') {
          // 直接读保存的每人行动点数；缺失时回落 1
          G.actionsLeft = G.winnersActions && G.winnersActions[nextP.id]
            ? G.winnersActions[nextP.id]
            : 1;
        }
      }
      startActionPhase();
      return;
    }
    G.phase = 'act_turn';
  }

  function finishRound() {
    if (!checkWin()) {
      G.phase = 'round_end';
    }
  }

  function getAvailableActions(pid) {
    const p = getP(pid);
    if (!p || p.status === 'dead') return [];
    const actions = [{ type: 'skip' }];
    // Movement
    Object.keys(locs).forEach(lid => {
      if (lid === p.loc || lid === G.blockedLoc) return;
      // 不能进别人家
      if (lid.startsWith('home') && lid !== `home${pid}`) return;
      actions.push({ type: 'move', dest: lid });
    });
    // Basic attacks
    playersAt(p.loc).filter(x => x.id !== pid).forEach(t => {
      if (t.status === 'sleeping') actions.push({ type: 'strangle', target: t.id });
      actions.push({ type: 'punch', target: t.id });
      if (hasItem(pid, 'dagger')) actions.push({ type: 'weapon', target: t.id, weapon: 'dagger' });
      if (hasItem(pid, 'enhanced')) actions.push({ type: 'weapon', target: t.id, weapon: 'enhanced' });
    });
    return actions;
  }

  function executeAction(pid, action) {
    switch (action.type) {
      case 'move': api.doMove(pid, action.dest); break;
      case 'punch': api.doPunch(pid, action.target); break;
      case 'weapon': api.doWeaponAttack(pid, action.target, action.weapon); break;
      case 'skip': afterAction(); break;
    }
  }

  // AI 决策辅助：挑下一个要去的地方
  function pickAIDestination(pid) {
    const p = getP(pid);
    if (!p) return null;
    const candidates = Object.keys(locs).filter(l => l !== p.loc && l !== G.blockedLoc && !(l.startsWith('home') && l !== `home${pid}`));
    if (candidates.length === 0) return null;
    // 优先级：医院 > 商店 > 教堂 > 公园 > 仓库 > 实验室 > 酒吧 > 黑市 > 废墟
    const order = ['hospital', 'shop', 'church', 'park', 'range', 'warehouse', 'lab', 'bar', 'blackmarket', 'ruins'];
    for (const id of order) {
      if (candidates.includes(id)) return id;
    }
    // 没人味就朝最近的活人走
    const enemies = alive().filter(x => x.id !== pid);
    if (enemies.length > 0) {
      const target = enemies.sort((a, b) => a.hp - b.hp)[0];
      return target.loc;
    }
    return candidates[0];
  }

  return api;
}

module.exports = { createGame };
