const { WebSocketServer } = require('ws');
const { createGame } = require('./game');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

// ===== 初始化数据库 =====
db.init();

const PORT = process.env.PORT || 9876;
const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });

// ===== 房间管理 =====
const rooms = new Map(); // roomId -> { players, game, hostId, config, state }
// 账号 → 当前连接的映射，用于重连
const accountSessions = new Map(); // accountId -> { ws, roomId, playerId }

function safeSend(ws, data) {
  try {
    if (ws && ws.readyState === 1) ws.send(data);
  } catch (e) {
    console.error('发送消息失败:', e.message);
  }
}

function createRoom() {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  rooms.set(roomId, {
    id: roomId,
    players: [],
    game: null,
    hostId: null,
    config: null,
    state: 'waiting',
  });
  return roomId;
}

function joinRoom(roomId, ws, name, accountId = null, isAI = false, diff = 'normal') {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (room.players.length >= 4) return null;

  const playerId = room.players.length;
  room.players.push({
    id: playerId,
    name,
    ws,
    isAI,
    diff,
    ready: isAI,
    accountId, // 关联账号，用于重连
  });

  // 修复 Bug #1: 使用 === null/undefined 而不是 == null
  if (room.hostId === null || room.hostId === undefined) {
    if (!isAI) room.hostId = playerId;
  }

  return playerId;
}

function getRoomPlayers(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    ready: p.ready,
    isAI: p.isAI,
    diff: p.diff,
    accountId: p.accountId,
  }));
}

function broadcastToRoom(roomId, msg, excludeWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msg);
  room.players.forEach(p => {
    if (p.ws && p.ws.readyState === 1 && p.ws !== excludeWs) safeSend(p.ws, data);
  });
}

function broadcastGameState(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.game) return;

  const cur = room.game.getState(0);
  const needReBroadcast = cur.phase === 'round_end' && !room.game._internal().finished;

  if (needReBroadcast) {
    room.game.startRound();
    triggerAITurns(room);
  }

  room.players.forEach(p => {
    if (p.ws && p.ws.readyState === 1) {
      const state = room.game.getState(p.id);
      safeSend(p.ws, JSON.stringify({ type: 'game_state', state }));
      pushRpsChallenge(room, p.id, state);
    }
  });

  if (needReBroadcast) {
    setTimeout(() => { if (room.game) broadcastGameState(roomId); }, 1600);
  }
}

function pushRpsChallenge(room, viewerId, state) {
  if (!room || !state) return;
  const player = room.players.find(p => p.id === viewerId);
  if (!player || !player.ws || player.ws.readyState !== 1) return;
  if (state.phase !== 'act_rps') return;
  const rps = state.pendingRps;
  if (!rps) return;
  const myTurn = state.rpsPhasePlayer === viewerId;
  safeSend(player.ws, JSON.stringify({
    type: 'rps_challenge',
    label: rps.label || (rps.type === 'combat' ? '⚔️ 战斗对决' : '🧩 技能挑战'),
    rpsType: rps.type,
    myTurn,
    winsNeeded: rps.winsNeeded,
    winsGot: rps.winsGot,
  }));
}

// ===== 游戏管理 =====
function startGame(room) {
  if (room.state === 'playing') return;
  room.state = 'playing';

  // 记录每个玩家的账号ID，游戏结束时要更新成就
  const accountIds = room.players.map(p => p.accountId);

  const names = room.players.map(p => p.name);
  const ais = room.players.map(p => p.isAI);
  const diffs = room.players.map(p => p.diff || 'normal');

  room.game = createGame({
    playerNames: names,
    playerAIs: ais,
    playerDiff: diffs,
    enableEvents: !!room.enableEvents,
  });

  // 把账号ID挂到游戏上，结束后用
  room.game._accountIds = accountIds;

  room.game.startRound();
  broadcastToRoom(room.id, { type: 'game_started' });
  broadcastGameState(room.id);
  triggerAITurns(room);

  setTimeout(() => {
    if (room.game) broadcastGameState(room.id);
  }, 1600);
}

function triggerAITurns(room) {
  if (!room || !room.game) return;
  const G = room.game;
  const now = Date.now();
  if (room._aiLockUntil && now < room._aiLockUntil) return;
  room._aiLockUntil = now + 100;

  const tryAI = () => {
    const int0 = G._internal();
    const winnerId = int0.winners && int0.winners[int0.winnerIdx];
    const cur = winnerId !== undefined ? room.players.find(p => p.id === winnerId) : null;
    const state = G.getState(0);

    if (state.phase === 'rps_cover' || state.phase === 'rps_pick') {
      const aliveNow = state.players.filter(p => p.status !== 'dead');
      const aiToPick = aliveNow.filter(p => p.isAI && !int0.rpsChoices[p.id]);
      if (aiToPick.length > 0) {
        aiToPick.forEach(p => { G.aiRpsPick(p.id); });
        broadcastGameState(room.id);
      }
      return;
    }

    if (state.phase === 'act_rps' && int0.pendingRps) {
      const rpsP = room.players.find(p => p.id === int0.rpsPhasePlayer);
      if (rpsP && rpsP.isAI) {
        const hand = ['rock', 'scissors', 'paper'][Math.floor(Math.random() * 3)];
        room.game.rpsSubmit(int0.rpsPhasePlayer, hand);
        broadcastGameState(room.id);
      }
      return;
    }

    if (!cur || !cur.isAI) return;
    if (state.phase !== 'act_turn') return;

    try { G.aiTurn(cur.id); } catch (e) {
      console.error('[AI] aiTurn err:', e.message);
    }
    broadcastGameState(room.id);
  };
  setTimeout(tryAI, 300);
}

// 游戏结束处理——记录战绩 + 检查成就
function handleGameOver(room) {
  const G = room.game;
  if (!G || !G._accountIds) return;

  const finalState = G.getState(0);
  const winner = finalState.winner;
  const accountIds = G._accountIds;
  const players = finalState.players;

  // 为每个有关联账号的玩家记录战绩
  players.forEach((p, idx) => {
    const accId = accountIds[idx];
    if (!accId) return;

    const isWin = winner && winner.id === p.id;
    const result = isWin ? 'win' : 'loss';

    // 统计该玩家本局数据
    const kills = p.kills || 0;
    const damageDealt = 0; // 服务端不跟踪单局伤害，可以后续优化
    const coinsEarned = p.money || 0;
    const roundCount = finalState.round || 0;
    const playerCount = players.length;

    // 记录游戏
    db.recordGame(accId, result, kills, damageDealt, coinsEarned, roundCount, playerCount);

    // 检查成就
    const newAch = [];

    if (isWin) {
      newAch.push(...db.checkAchievements(accId, 'game_win'));
      // 赤手空拳：胜利时检查是否没有任何武器
      const hasWeapon = p.items.some(i =>
        ['dagger', 'gun', 'enhanced', 'taser', 'sniper', 'bomb', 'poisoned_dagger', 'burst_gun'].includes(i.id)
      );
      if (!hasWeapon) {
        newAch.push(...db.checkAchievements(accId, 'bare_handed'));
      }
    }

    if (kills > 0) {
      newAch.push(...db.checkAchievements(accId, 'kill', kills));
    }
    if (kills >= 4) {
      newAch.push(...db.checkAchievements(accId, 'quadra_kill'));
    }

    // 游戏次数
    newAch.push(...db.checkAchievements(accId, 'game_count'));

    // 如果有新解锁的成就，推送给客户端
    if (newAch.length > 0) {
      // 找到该玩家当前的 ws 连接
      const playerWs = room.players.find(pl => pl.id === idx && pl.ws);
      if (playerWs) {
        safeSend(playerWs.ws, JSON.stringify({
          type: 'achievements_unlocked',
          achievements: newAch,
        }));
      }
    }
  });
}

// ===== WebSocket 连接处理 =====
wss.on('connection', (ws) => {
  let currentRoomId = null;
  let currentPlayerId = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (!msg || typeof msg.type !== 'string') {
        safeSend(ws, JSON.stringify({ type: 'error', msg: '消息格式错误' }));
        return;
      }
      handleMessage(ws, msg);
    } catch (e) {
      console.error('[handler error]', e && e.message);
      safeSend(ws, JSON.stringify({ type: 'error', msg: '消息格式错误: ' + (e && e.message) }));
    }
  });

  ws.on('close', () => {
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        // 先标记该玩家 ws 断开但不删除（用于重连）
        const player = room.players.find(p => p.ws === ws);
        if (player) {
          player.ws = null; // ws 断开，但保留玩家数据
          player.disconnectedAt = Date.now();
        }

        // 如果所有真人都断开了，可能不需要转移房主
        // 但如果房主断了，转移给下一个在线的真人
        const realHost = room.players.find(p => p.id === room.hostId && !p.isAI && p.ws);
        if (!realHost) {
          const nextOnline = room.players.find(p => !p.isAI && p.ws);
          if (nextOnline) room.hostId = nextOnline.id;
        }

        // 如果所有玩家都 ws=null（全部离线），保留一段时间后清理
        const anyOnline = room.players.some(p => p.ws);
        if (!anyOnline) {
          // 设置清理计时器（5分钟后清理空房间）
          if (!room._cleanupTimer) {
            room._cleanupTimer = setTimeout(() => {
              // 检查是否仍然全离线
              const stillOffline = room.players.every(p => !p.ws);
              if (stillOffline) {
                // 游戏结束前全部离线，记录未完成的游戏
                if (room.game && room.state === 'playing') {
                  handleGameOver(room);
                }
                rooms.delete(currentRoomId);
                console.log(`🧹 清理空房间 ${currentRoomId}`);
              }
            }, 5 * 60 * 1000);
          }
        } else {
          // 有人在线，通知房间更新
          broadcastToRoom(currentRoomId, {
            type: 'room_update',
            hostId: room.hostId,
            players: getRoomPlayers(room),
          });
        }
      }
      currentRoomId = null;
      currentPlayerId = null;
    }
  });

  function handleMessage(ws, msg) {
    switch (msg.type) {
      // ===== 账号操作 =====
      case 'register': {
        const { username, password, displayName } = msg;
        const result = db.register(username, password, displayName || username);
        if (result.ok) {
          safeSend(ws, JSON.stringify({
            type: 'auth_ok',
            action: 'register',
            token: result.token,
            accountId: result.accountId,
            message: '注册成功',
          }));
        } else {
          safeSend(ws, JSON.stringify({ type: 'auth_error', action: 'register', error: result.error }));
        }
        break;
      }

      case 'login': {
        const { username, password } = msg;
        const result = db.login(username, password);
        if (result.ok) {
          safeSend(ws, JSON.stringify({
            type: 'auth_ok',
            action: 'login',
            token: result.token,
            accountId: result.accountId,
            profile: result.profile,
            message: '登录成功',
          }));
        } else {
          safeSend(ws, JSON.stringify({ type: 'auth_error', action: 'login', error: result.error }));
        }
        break;
      }

      case 'reconnect': {
        const { token } = msg;
        const result = db.reconnect(token);
        if (result.ok) {
          // 尝试恢复房间会话
          let roomInfo = null;
          const existing = accountSessions.get(result.accountId);
          if (existing && existing.roomId) {
            const room = rooms.get(existing.roomId);
            if (room) {
              // 找回该玩家
              const player = room.players.find(p => p.accountId === result.accountId);
              if (player) {
                player.ws = ws; // 重新绑定 ws
                player.disconnectedAt = null;

                // 如果游戏进行中，直接推送游戏状态
                if (room.state === 'playing') {
                  const state = room.game.getState(player.id);
                  safeSend(ws, JSON.stringify({
                    type: 'reconnect_ok',
                    token: result.token,
                    accountId: result.accountId,
                    profile: result.profile,
                    roomState: 'playing',
                    roomId: room.id,
                    playerId: player.id,
                    gameState: state,
                  }));
                  break;
                }

                // 等待中，推房间信息
                roomInfo = {
                  roomId: room.id,
                  playerId: player.id,
                  hostId: room.hostId,
                  players: getRoomPlayers(room),
                };

                // 更新当前连接
                currentRoomId = room.id;
                currentPlayerId = player.id;
                accountSessions.set(result.accountId, { ws, roomId: room.id, playerId: player.id });

                safeSend(ws, JSON.stringify({
                  type: 'reconnect_ok',
                  token: result.token,
                  accountId: result.accountId,
                  profile: result.profile,
                  roomState: 'waiting',
                  room: roomInfo,
                }));
                break;
              }
            }
          }

          // 没有可恢复的房间
          safeSend(ws, JSON.stringify({
            type: 'reconnect_ok',
            token: result.token,
            accountId: result.accountId,
            profile: result.profile,
            roomState: 'none',
          }));
        } else {
          safeSend(ws, JSON.stringify({ type: 'auth_error', action: 'reconnect', error: result.error }));
        }
        break;
      }

      case 'get_profile': {
        const { token } = msg;
        if (!token) { safeSend(ws, JSON.stringify({ type: 'error', msg: '未登录' })); break; }
        const result = db.reconnect(token);
        if (!result.ok) { safeSend(ws, JSON.stringify({ type: 'error', msg: result.error })); break; }
        const info = db.getAccountInfo(result.accountId);
        const achievements = db.getPlayerAchievements(result.accountId);
        safeSend(ws, JSON.stringify({
          type: 'profile_data',
          profile: info,
          achievements,
        }));
        break;
      }

      case 'get_leaderboard': {
        const leaderboard = db.getLeaderboard(msg.limit || 20);
        safeSend(ws, JSON.stringify({ type: 'leaderboard_data', leaderboard }));
        break;
      }

      // ===== 房间操作 =====
      case 'create_room': {
        // 需要账号
        const token = msg.token;
        const authResult = db.reconnect(token);
        if (!authResult.ok) {
          safeSend(ws, JSON.stringify({ type: 'error', msg: '请先登录' }));
          break;
        }

        const roomId = createRoom();
        const pid = joinRoom(roomId, ws, (msg.playerName || '玩家').toString().slice(0, 20), authResult.accountId, false, 'normal');
        if (pid === null) { safeSend(ws, JSON.stringify({ type: 'error', msg: '创建失败' })); break; }

        rooms.get(roomId).enableEvents = !!msg.enableEvents;
        currentRoomId = roomId;
        currentPlayerId = pid;

        // 记录会话
        accountSessions.set(authResult.accountId, { ws, roomId, playerId: pid });

        safeSend(ws, JSON.stringify({
          type: 'room_joined',
          roomId,
          playerId: pid,
          hostId: rooms.get(roomId).hostId,
          enableEvents: rooms.get(roomId).enableEvents,
        }));
        broadcastToRoom(roomId, {
          type: 'room_update',
          hostId: rooms.get(roomId).hostId,
          players: getRoomPlayers(rooms.get(roomId)),
        });
        break;
      }

      case 'join_room': {
        const token = msg.token;
        const authResult = db.reconnect(token);
        if (!authResult.ok) {
          safeSend(ws, JSON.stringify({ type: 'error', msg: '请先登录' }));
          break;
        }

        const rid = (msg.roomId || '').toString().slice(0, 16).toUpperCase();
        if (!rid) { safeSend(ws, JSON.stringify({ type: 'error', msg: '房间号不能为空' })); break; }

        const pid = joinRoom(rid, ws, (msg.playerName || '玩家').toString().slice(0, 20), authResult.accountId, false, 'normal');
        if (pid === null) {
          safeSend(ws, JSON.stringify({ type: 'error', msg: '加入房间失败，房间不存在或已满' }));
          break;
        }

        currentRoomId = rid;
        currentPlayerId = pid;
        accountSessions.set(authResult.accountId, { ws, roomId: rid, playerId: pid });

        safeSend(ws, JSON.stringify({ type: 'room_joined', roomId: rid, playerId: pid, hostId: rooms.get(rid).hostId }));
        broadcastToRoom(rid, { type: 'room_update', hostId: rooms.get(rid).hostId, players: getRoomPlayers(rooms.get(rid)) });
        break;
      }

      case 'add_ai': {
        const room = rooms.get(currentRoomId);
        if (!room || currentPlayerId === null) return;
        if (room.state !== 'waiting') { safeSend(ws, JSON.stringify({ type: 'error', msg: '游戏已开始' })); break; }
        if (room.hostId !== currentPlayerId) {
          safeSend(ws, JSON.stringify({ type: 'error', msg: '只有房主可以添加AI' }));
          break;
        }
        if (room.players.length >= 4) { safeSend(ws, JSON.stringify({ type: 'error', msg: '房间已满' })); break; }

        const aiName = (msg.aiName || ('AI-' + (room.players.length + 1))).toString().slice(0, 20);
        const aiDiff = ['easy', 'normal', 'hard'].includes(msg.diff) ? msg.diff : 'normal';
        const aiPid = joinRoom(room.id, null, aiName, null, true, aiDiff);
        if (aiPid === null) { safeSend(ws, JSON.stringify({ type: 'error', msg: '加入AI失败' })); break; }

        broadcastToRoom(currentRoomId, { type: 'room_update', hostId: room.hostId, players: getRoomPlayers(room) });

        if (room.state === 'waiting' && room.players.length >= 2 && room.players.every(pl => pl.ready)) {
          startGame(room);
        }
        break;
      }

      case 'set_ready': {
        const room = rooms.get(currentRoomId);
        if (!room || currentPlayerId === null) return;
        if (room.state !== 'waiting') return;
        const p = room.players.find(pl => pl.id === currentPlayerId);
        if (!p || p.isAI) return;
        p.ready = !!msg.ready;

        broadcastToRoom(currentRoomId, { type: 'room_update', hostId: room.hostId, players: getRoomPlayers(room) });

        if (room.state === 'waiting' && room.players.length >= 2 && room.players.every(pl => pl.ready)) {
          startGame(room);
        }
        break;
      }

      case 'start_game': {
        const room = rooms.get(currentRoomId);
        if (!room) return;
        if (room.hostId !== currentPlayerId) {
          safeSend(ws, JSON.stringify({ type: 'error', msg: '只有房主可以开始游戏' }));
          break;
        }
        if (room.players.length < 2) {
          safeSend(ws, JSON.stringify({ type: 'error', msg: '至少需要 2 名玩家' }));
          break;
        }
        if (!room.players.every(pl => pl.ready)) {
          safeSend(ws, JSON.stringify({ type: 'error', msg: '所有玩家必须先准备' }));
          break;
        }
        startGame(room);
        break;
      }

      // ===== 游戏操作 =====
      case 'rps_pick': {
        const room = rooms.get(currentRoomId);
        if (room && room.game && ['rock', 'scissors', 'paper'].includes(msg.hand)) {
          room.game.playerRpsPick(currentPlayerId, msg.hand);
          broadcastGameState(currentRoomId);
          triggerAITurns(room);
        }
        break;
      }

      case 'rps_confirm': {
        const room = rooms.get(currentRoomId);
        if (room && room.game) {
          room.game.resolveRps();
          broadcastGameState(currentRoomId);
          triggerAITurns(room);
        }
        break;
      }

      case 'action': {
        const room = rooms.get(currentRoomId);
        if (!room || !room.game) return;
        const { action, target, weapon, payload, hand } = msg;

        try {
          switch (action) {
            case 'move':       room.game.doMove(currentPlayerId, target); break;
            case 'punch':      room.game.doPunch(currentPlayerId, target); break;
            case 'strangle':   room.game.doStrangle(currentPlayerId, target); break;
            case 'weapon':     room.game.doWeaponAttack(currentPlayerId, target, weapon); break;
            case 'bomb':       room.game.doBomb(currentPlayerId); break;
            case 'use_item':   room.game.useItem(currentPlayerId, target); break;
            case 'skill':      room.game.startSkill(currentPlayerId, target); break;
            case 'loc':        room.game.doLocAction(currentPlayerId, target, payload); break;
            case 'skip':       room.game.doSkip(currentPlayerId); break;
            case 'rpsSubmit':  room.game.rpsSubmit(currentPlayerId, hand); break;
            case 'nextRound': {
              const curPhase = room.game.getState(0).phase;
              if (curPhase === 'round_end' && !room.game._internal().finished) {
                room.game.startRound();
                setTimeout(() => { if (room.game) broadcastGameState(currentRoomId); }, 1600);
              }
              break;
            }
            default:
              safeSend(ws, JSON.stringify({ type: 'error', msg: '未知动作: ' + action }));
              return;
          }
        } catch (e) {
          console.error('action error', e);
        }

        // 检查游戏是否结束
        if (room.game._internal().finished) {
          handleGameOver(room);
        }

        broadcastGameState(currentRoomId);
        triggerAITurns(room);
        break;
      }

      case 'rps_submit': {
        const room = rooms.get(currentRoomId);
        if (room && room.game && ['rock', 'scissors', 'paper'].includes(msg.hand)) {
          room.game.rpsSubmit(currentPlayerId, msg.hand);
          broadcastGameState(currentRoomId);
          triggerAITurns(room);
        }
        break;
      }

      case 'rps_skip': {
        const room = rooms.get(currentRoomId);
        if (room && room.game) {
          room.game.rpsSkip(currentPlayerId);
          broadcastGameState(currentRoomId);
          triggerAITurns(room);
        }
        break;
      }

      case 'next_round': {
        const room = rooms.get(currentRoomId);
        if (room && room.game) {
          room.game.startRound();
          broadcastGameState(currentRoomId);
        }
        break;
      }

      default:
        safeSend(ws, JSON.stringify({ type: 'error', msg: '未知消息类型' }));
    }
  }
});

console.log(`🛏️ 起床！游戏服务器启动在 ws://localhost:${PORT}`);

// ===== 房间自动清理（每5分钟）=====
setInterval(() => {
  let cleaned = 0;
  for (const [id, room] of rooms) {
    const hasHuman = room.players.some(p => !p.isAI && p.ws && p.ws.readyState === 1);
    if (!hasHuman) {
      const ageMs = Date.now() - (room.lastHumanLeftAt || Date.now());
      if (room.lastHumanLeftAt === undefined) room.lastHumanLeftAt = Date.now();
      if (ageMs > 30 * 60 * 1000) {
        if (room.game && room.state === 'playing') {
          handleGameOver(room);
        }
        rooms.delete(id);
        cleaned++;
      }
    } else {
      room.lastHumanLeftAt = undefined;
    }
  }
  if (cleaned > 0) console.log(`🧹 清理了 ${cleaned} 个空房间`);
}, 5 * 60 * 1000);
