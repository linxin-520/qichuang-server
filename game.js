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
    winners: [], winnerIdx: 0, actionsLeft: 0,
    log: [],
    currentEvent: null, blockedLoc: null,
    winner: null,
    pendingRps: null,
    rpsPhasePlayer: -1,
    finished: false,
  };

  const api = {
    getState(viewerId) { return getPublicState(G, viewerId); },

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
          Object.values(locs).forEach(l => { l.trap = false; l.poisoned = false; l.beartrap = false; });
        }
        if (evt.id === 'airdrop') {
          const dropLoc = randItem(MAP_ORDER);
          const loot = randItem(['sniper', 'taser', 'bomb', 'enhanced', 'stimulant']);
          locs[dropLoc].airdropItem = loot;
          log(`🚁 空投落在${locs[dropLoc].icon}${locs[dropLoc].name}！`, 'good');
        }
      }

      G.rpsCurrent = 0;
      G.phase = 'rps_cover';
    },

    // 玩家出拳
    playerRpsPick(pid, hand) {
      if (G.phase !== 'rps_pick') return;
      const p = getP(pid);
      if (!p || p.isAI) return;
      G.rpsChoices[pid] = hand;
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
      startActionPhase();
    },

    // ===== 玩家动作 =====
    doMove(pid, destId) {
      const p = getP(pid);
      if (!p || p.status === 'dead') return;
      if (G.blockedLoc === destId) return;
      p.loc = destId;
      const loc = locs[destId];
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
      const def = getP(defId);
      if (!def || def.status === 'dead') return;
      G.pendingRps = {
        type: 'combat', atk: atkId, def: defId,
        winsNeeded: 1, winsGot: 0,
        onWin: () => {
          def.hp--;
          log(`🤏 ${getP(atkId).name} 掐住了 ${def.name}，造成1伤害！`, 'kill');
          if (def.hp <= 0) killPlayer(defId, `被 ${getP(atkId).name} 掐死`, atkId);
          afterAction();
        },
        onLose: () => { log(`🤏 ${getP(atkId).name} 偷袭失败`); afterAction(); },
        choices: {},
      };
      G.phase = 'act_rps';
      G.rpsPhasePlayer = atkId;
    },

    useItem(pid, itemId) {
      const p = getP(pid);
      if (!p || p.status === 'dead') return;
      const item = p.items.find(it => it.id === itemId);
      if (!item) return;
      if (itemId === 'medkit') {
        removeItem(pid, 'medkit');
        p.hp = Math.min(MAX_HP, p.hp + 2);
        log(`💊 ${p.name} 使用急救包，恢复至${p.hp}HP`, 'good');
        afterAction();
      } else if (itemId === 'bandage') {
        removeItem(pid, 'bandage');
        p.hp = Math.min(MAX_HP, p.hp + 1);
        log(`🩹 ${p.name} 使用绷带，恢复至${p.hp}HP`, 'good');
        afterAction();
      } else {
        log(`⚠️ ${p.name} 尝试使用未知道具`);
        afterAction();
      }
    },

    doSkip(pid) {
      log(`⏭️ ${getP(pid).name} 跳过`);
      afterAction();
    },

    // AI自动操作
    aiTurn(pid) {
      const p = getP(pid);
      if (!p || !p.isAI || p.status === 'dead') return;
      // AI逻辑简化——随机选一个可行动作
      const actions = getAvailableActions(pid);
      if (actions.length > 0) {
        const action = randItem(actions);
        executeAction(pid, action);
      } else {
        afterAction();
      }
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
          const result = resolveMultiRPS(G.rpsChoices);
          G.actionsLeft = result ? result.actionsPerWinner : 1;
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
      if (lid !== p.loc && lid !== G.blockedLoc) actions.push({ type: 'move', dest: lid });
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

  return api;
}

module.exports = { createGame };
