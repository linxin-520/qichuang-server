const { WebSocketServer } = require('ws');
const { createGame } = require('./game');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 9876;
const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });

// ===== 房间管理 =====
const rooms = new Map(); // roomId -> { players, game, config, state }

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
    players: [],       // { id, name, ws, isAI, diff, ready }
    game: null,
    config: null,
    state: 'waiting',  // waiting | playing | finished
  });
  return roomId;
}

function joinRoom(roomId, ws, name) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (room.players.length >= 4) return null;
  const playerId = uuidv4().slice(0, 6);
  room.players.push({ id: playerId, name, ws, isAI: false, diff: 'normal', ready: false });
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
      // 补充玩家能看到自己的视角
      const myPlayer = state.players.find(pl => pl.id === p.id);
      safeSend(p.ws, JSON.stringify({ type: 'game_state', state, myPlayer }));
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
        if (room.players.length === 0) {
          rooms.delete(currentRoomId);
        } else {
          broadcastToRoom(currentRoomId, { type: 'room_update', players: getRoomPlayers(room) });
        }
      }
    }
  });

  function handleMessage(ws, msg) {
    switch (msg.type) {
      // ===== 房间操作 =====
      case 'create_room': {
        const roomId = createRoom();
        const pid = joinRoom(roomId, ws, msg.playerName || '玩家');
        currentRoomId = roomId;
        currentPlayerId = pid;
        safeSend(ws, JSON.stringify({ type: 'room_joined', roomId, playerId: pid }));
        break;
      }

      case 'join_room': {
        const pid = joinRoom(msg.roomId, ws, msg.playerName || '玩家');
        if (pid) {
          currentRoomId = msg.roomId;
          currentPlayerId = pid;
          safeSend(ws, JSON.stringify({ type: 'room_joined', roomId: msg.roomId, playerId: pid }));
        } else {
          safeSend(ws, JSON.stringify({ type: 'error', msg: '加入房间失败，房间不存在或已满' }));
        }
        break;
      }

      case 'set_ready': {
        const room = rooms.get(currentRoomId);
        if (!room) return;
        const p = room.players.find(pl => pl.id === currentPlayerId);
        if (p) p.ready = msg.ready;
        broadcastToRoom(currentRoomId, { type: 'room_update', players: getRoomPlayers(room) });
        // 所有人准备 → 自动开始
        if (room.players.every(pl => pl.ready) && room.players.length >= 2) {
          startGame(room);
        }
        break;
      }

      case 'start_game': {
        const room = rooms.get(currentRoomId);
        if (room && room.players.length >= 2) startGame(room);
        break;
      }

      // ===== 游戏操作 =====
      case 'rps_pick': {
        const room = rooms.get(currentRoomId);
        if (room && room.game) {
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
          // 如果开始了行动阶段，让AI自动操作
          triggerAITurns(room);
        }
        break;
      }

      case 'action': {
        const room = rooms.get(currentRoomId);
        if (!room || !room.game) return;
        const { action, target, weapon } = msg;
        switch (action) {
          case 'move': room.game.doMove(currentPlayerId, target); break;
          case 'punch': room.game.doPunch(currentPlayerId, target); break;
          case 'strangle': room.game.doStrangle(currentPlayerId, target); break;
          case 'weapon': room.game.doWeaponAttack(currentPlayerId, target, weapon); break;
          case 'bomb': room.game.doBomb(currentPlayerId); break;
          case 'use_item': room.game.useItem(currentPlayerId, target); break;
          case 'skip': room.game.doSkip(currentPlayerId); break;
          default: room.game.doSkip(currentPlayerId); break;
        }
        broadcastGameState(currentRoomId);
        triggerAITurns(room);
        break;
      }

      case 'rps_submit': {
        const room = rooms.get(currentRoomId);
        if (room && room.game) {
          room.game.rpsSubmit(currentPlayerId, msg.hand);
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
    }
  }

  function startGame(room) {
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
    // 简单版AI轮询
    const tryAI = () => {
      const state = G.getState(0); // 随便拿个viewerId看phase
      if (state.phase === 'act_turn') {
        const cur = G.getState(0).players.find(p => p.id === G.winners[G.winnerIdx]);
        if (cur && cur.isAI) {
          room.game.aiTurn(cur.id);
          broadcastGameState(room.id);
          setTimeout(tryAI, 600);
        }
      }
    };
    setTimeout(tryAI, 300);
  }
});

console.log(`🛏️ 起床！游戏服务器启动在 ws://localhost:${PORT}`);

// ===== 房间自动清理（每5分钟清理空房间）=====
setInterval(() => {
  let cleaned = 0;
  for (const [id, room] of rooms) {
    const hasPlayers = room.players.some(p => p.ws && p.ws.readyState === 1);
    if (!hasPlayers) {
      rooms.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`🧹 清理了 ${cleaned} 个空房间`);
}, 5 * 60 * 1000);
