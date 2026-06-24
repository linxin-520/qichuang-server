const { WebSocketServer } = require('ws');
const { createGame } = require('./game');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 9876;
const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });

// ===== 房间管理 =====
const rooms = new Map(); // roomId -> { players, game, hostId, config, state }

/** 安全发送消息，捕获异常 */
function safeSend(ws, data) {
  try {
    if (ws && ws.readyState === 1) ws.send(data);
  } catch (e) {
    console.error('发送消息失败:', e.message);
  }
}

function createRoom() {
  const roomId = uuidv4().slice(0, 8);
  rooms.set(roomId, {
    id: roomId,
    players: [],       // { id: <number index>, name, ws, isAI, diff, ready }
    game: null,
    hostId: null,      // 显式房主 id
    config: null,
    state: 'waiting',  // waiting | playing | finished
  });
  return roomId;
}

// 加入房间：playerId 用数字索引（与 game.js 内部对齐）
function joinRoom(roomId, ws, name, isAI = false, diff = 'normal') {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (room.players.length >= 4) return null;
  const playerId = room.players.length; // 0,1,2,3
  room.players.push({ id: playerId, name, ws, isAI, diff, ready: isAI });
  if (!room.hostId && !isAI) room.hostId = playerId; // 第一个真人 = 房主
  broadcastToRoom(roomId, { type: 'room_update', players: getRoomPlayers(room) });
  return playerId;
}

function getRoomPlayers(room) {
  return room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready, isAI: p.isAI, diff: p.diff }));
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
  room.players.forEach(p => {
    if (p.ws && p.ws.readyState === 1) {
      const state = room.game.getState(p.id);
      const myPlayer = state.players.find(pl => pl.id === p.id);
      safeSend(p.ws, JSON.stringify({ type: 'game_state', state, myPlayer }));
      // rps 阶段额外推送一份 challenge 提示
      pushRpsChallenge(room, p.id, state);
    }
  });
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
      safeSend(ws, JSON.stringify({ type: 'error', msg: '消息格式错误' }));
    }
  });

  ws.on('close', () => {
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        room.players = room.players.filter(p => p.ws !== ws);
        // 房主离开时转移给下一个真人
        if (room.hostId !== null && !room.players.find(p => p.id === room.hostId && !p.isAI && p.ws)) {
          const nextHuman = room.players.find(p => !p.isAI);
          room.hostId = nextHuman ? nextHuman.id : null;
        }
        if (room.players.length === 0) {
          rooms.delete(currentRoomId);
        } else {
          broadcastToRoom(currentRoomId, { type: 'room_update', players: getRoomPlayers(room) });
        }
      }
      currentRoomId = null;
      currentPlayerId = null;
    }
  });

  function handleMessage(ws, msg) {
    switch (msg.type) {
      // ===== 房间操作 =====
      case 'create_room': {
        const roomId = createRoom();
        const pid = joinRoom(roomId, ws, (msg.playerName || '玩家').toString().slice(0, 20), false, 'normal');
        if (pid === null) { safeSend(ws, JSON.stringify({ type: 'error', msg: '创建失败' })); break; }
        currentRoomId = roomId;
        currentPlayerId = pid;
        safeSend(ws, JSON.stringify({ type: 'room_joined', roomId, playerId: pid, hostId: rooms.get(roomId).hostId }));
        break;
      }

      case 'join_room': {
        const rid = (msg.roomId || '').toString().slice(0, 16);
        if (!rid) { safeSend(ws, JSON.stringify({ type: 'error', msg: '房间号不能为空' })); break; }
        const pid = joinRoom(rid, ws, (msg.playerName || '玩家').toString().slice(0, 20), false, 'normal');
        if (pid === null) {
          safeSend(ws, JSON.stringify({ type: 'error', msg: '加入房间失败，房间不存在或已满' }));
          break;
        }
        currentRoomId = rid;
        currentPlayerId = pid;
        safeSend(ws, JSON.stringify({ type: 'room_joined', roomId: rid, playerId: pid, hostId: rooms.get(rid).hostId }));
        break;
      }

      case 'add_ai': {
        const room = rooms.get(currentRoomId);
        if (!room || currentPlayerId === null) return;
        if (room.state !== 'waiting') { safeSend(ws, JSON.stringify({ type: 'error', msg: '游戏已开始' })); break; }
        // 显式房主校验
        if (room.hostId !== currentPlayerId) {
          safeSend(ws, JSON.stringify({ type: 'error', msg: '只有房主可以添加AI' }));
          break;
        }
        if (room.players.length >= 4) { safeSend(ws, JSON.stringify({ type: 'error', msg: '房间已满' })); break; }
        const aiName = (msg.aiName || ('AI-' + (room.players.length + 1))).toString().slice(0, 20);
        const aiDiff = ['easy', 'normal', 'hard'].includes(msg.diff) ? msg.diff : 'normal';
        const aiPid = joinRoom(room.id, null, aiName, true, aiDiff);
        if (aiPid === null) { safeSend(ws, JSON.stringify({ type: 'error', msg: '加入AI失败' })); break; }
        // AI 自动准备；2 人就自动开局
        if (room.players.every(p => p.ready) && room.players.length >= 2) startGame(room);
        break;
      }

      case 'set_ready': {
        const room = rooms.get(currentRoomId);
        if (!room || currentPlayerId === null) return;
        if (room.state !== 'waiting') return;
        const p = room.players.find(pl => pl.id === currentPlayerId);
        if (!p || p.isAI) return;
        p.ready = !!msg.ready;
        broadcastToRoom(currentRoomId, { type: 'room_update', players: getRoomPlayers(room) });
        if (room.players.every(pl => pl.ready) && room.players.length >= 2) {
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
        if (room.players.length >= 2) startGame(room);
        break;
      }

      // ===== 游戏操作 =====
      case 'rps_pick': {
        const room = rooms.get(currentRoomId);
        if (room && room.game && ['rock','scissors','paper'].includes(msg.hand)) {
          room.game.playerRpsPick(currentPlayerId, msg.hand);
          broadcastGameState(currentRoomId);
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
        const { action, target, weapon, payload } = msg;
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
            default:
              safeSend(ws, JSON.stringify({ type: 'error', msg: '未知动作: ' + action }));
              return;
          }
        } catch (e) {
          console.error('action error', e);
        }
        broadcastGameState(currentRoomId);
        triggerAITurns(room);
        break;
      }

      case 'rps_submit': {
        const room = rooms.get(currentRoomId);
        if (room && room.game && ['rock','scissors','paper'].includes(msg.hand)) {
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

  function startGame(room) {
    if (room.state === 'playing') return;
    room.state = 'playing';
    const names = room.players.map(p => p.name);
    const ais = room.players.map(p => p.isAI);
    const diffs = room.players.map(p => p.diff || 'normal');
    room.game = createGame({ playerNames: names, playerAIs: ais, playerDiff: diffs, enableEvents: true });
    room.game.startRound();
    broadcastToRoom(room.id, { type: 'game_started' });
    broadcastGameState(room.id);
    triggerAITurns(room);
  }

  function triggerAITurns(room) {
    if (!room || !room.game) return;
    const G = room.game;
    let pending = false;
    const tryAI = () => {
      // 找当前行动者
      const winnerId = G.winners && G.winners[G.winnerIdx];
      const cur = winnerId !== undefined ? room.players.find(p => p.id === winnerId) : null;
      const state = G.getState(0);
      if (pending) return;
      pending = true;
      try {
        // 阶段 1：开局猜拳 — 让还没出拳的 AI 自动出
        if (state.phase === 'rps_cover' || state.phase === 'rps_pick') {
          const aliveNow = G.getState(0).players.filter(p => p.status !== 'dead');
          const aiToPick = aliveNow.filter(p => p.isAI && !G.rpsChoices[p.id]);
          if (aiToPick.length > 0) {
            aiToPick.forEach(p => { G.aiRpsPick(p.id); });
            broadcastGameState(room.id);
            // 若仍有 AI 未出拳，继续
            const st2 = G.getState(0);
            if ((st2.phase === 'rps_cover' || st2.phase === 'rps_pick')) {
              const remain = st2.players.filter(p => p.status !== 'dead' && p.isAI && !G.rpsChoices[p.id]);
              if (remain.length > 0) setTimeout(tryAI, 100);
            }
          }
          return;
        }

        if (!cur || !cur.isAI) return;
        if (state.phase !== 'act_turn') return;

        room.game.aiTurn(cur.id);
        broadcastGameState(room.id);
        // 若仍是 AI 阶段，立即递归（避免 600ms 延迟）
        const st2 = G.getState(0);
        if (st2.phase === 'act_turn') {
          const nextWinner = G.winners[G.winnerIdx];
          const nextP = room.players.find(p => p.id === nextWinner);
          if (nextP && nextP.isAI) setTimeout(tryAI, 50);
        } else if (st2.phase === 'act_rps') {
          // rps 阶段也需要 AI 出拳
          const rpsPlayer = st2.rpsPhasePlayer;
          const rpsP = room.players.find(p => p.id === rpsPlayer);
          if (rpsP && rpsP.isAI) {
            const hand = ['rock','scissors','paper'][Math.floor(Math.random()*3)];
            setTimeout(() => {
              room.game.rpsSubmit(rpsPlayer, hand);
              broadcastGameState(room.id);
              setTimeout(tryAI, 50);
            }, 300);
          }
        }
      } finally {
        pending = false;
      }
    };
    setTimeout(tryAI, 300);
  }
});

console.log(`🛏️ 起床！游戏服务器启动在 ws://localhost:${PORT}`);

// ===== 房间自动清理（每5分钟清理真人全断开的房间；AI-only 房间延长保留）=====
setInterval(() => {
  let cleaned = 0;
  for (const [id, room] of rooms) {
    const hasHuman = room.players.some(p => !p.isAI && p.ws && p.ws.readyState === 1);
    if (!hasHuman) {
      // AI-only 房间再宽限 30 分钟
      const ageMs = Date.now() - (room.lastHumanLeftAt || Date.now());
      if (room.lastHumanLeftAt === undefined) room.lastHumanLeftAt = Date.now();
      if (ageMs > 30 * 60 * 1000) {
        rooms.delete(id);
        cleaned++;
      }
    } else {
      room.lastHumanLeftAt = undefined;
    }
  }
  if (cleaned > 0) console.log(`🧹 清理了 ${cleaned} 个空房间`);
}, 5 * 60 * 1000);
