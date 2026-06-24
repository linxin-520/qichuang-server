const { WebSocketServer } = require('ws');
const { createGame } = require('./game');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 9876;
const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });

const rooms = new Map();

function createRoom() {
  const roomId = uuidv4().slice(0, 8);
  rooms.set(roomId, {
    id: roomId,
    players: [],
    game: null,
    config: null,
    state: 'waiting',
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
    if (p.ws && p.ws.readyState === 1 && p.ws !== excludeWs) p.ws.send(data);
  });
}

wss.on('connection', (ws) => {
  let currentRoomId = null;
  let currentPlayerId = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case 'create_room': {
          const roomId = createRoom();
          const pid = joinRoom(roomId, ws, msg.playerName || '玩家');
          currentRoomId = roomId;
          currentPlayerId = pid;
          ws.send(JSON.stringify({ type: 'room_joined', roomId, playerId: pid }));
          break;
        }
        case 'join_room': {
          const pid = joinRoom(msg.roomId, ws, msg.playerName || '玩家');
          if (pid) {
            currentRoomId = msg.roomId;
            currentPlayerId = pid;
            ws.send(JSON.stringify({ type: 'room_joined', roomId: msg.roomId, playerId: pid }));
          } else {
            ws.send(JSON.stringify({ type: 'error', msg: '加入房间失败' }));
          }
          break;
        }
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', msg: '消息格式错误' }));
    }
  });

  ws.on('close', () => {
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        room.players = room.players.filter(p => p.ws !== ws);
        if (room.players.length === 0) rooms.delete(currentRoomId);
      }
    }
  });
});

console.log('✅ 起床！游戏服务器启动在 ws://0.0.0.0:' + PORT);
