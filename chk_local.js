// 探测本地 server (ws://localhost:9876)，验证新版代码
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:9876');
let picked = false;
let sawAiAdded = false;
let sawRpsPhase = false;

ws.on('open', () => {
  console.log('[open] 连接成功');
  ws.send(JSON.stringify({ type: 'create_room', playerName: '测试玩家' }));
});

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'room_joined') {
    console.log(`[room_joined] playerId=${m.playerId} (类型=${typeof m.playerId}) hostId=${m.hostId}`);
    if (typeof m.playerId === 'number') console.log('  ✅ playerId 是数字（新版本）');
    else console.log('  ❌ playerId 是 ' + typeof m.playerId + '（旧版 bug）');
    if (m.hostId !== undefined) console.log('  ✅ hostId 字段存在（新版本）');
  }
  if (m.type === 'room_update') {
    console.log(`[room_update] 玩家数=${m.players.length} ready=${m.players.map(p => p.ready).join(',')}`);
    if (m.players.length === 1 && !sawAiAdded) {
      sawAiAdded = true;
      setTimeout(() => ws.send(JSON.stringify({ type: 'add_ai', diff: 'normal' })), 200);
    }
    if (m.players.length === 2 && !m.players.every(p => p.ready)) {
      setTimeout(() => ws.send(JSON.stringify({ type: 'set_ready', ready: true })), 200);
    }
  }
  if (m.type === 'game_state') {
    const s = m.state;
    console.log(`[game_state] phase=${s.phase} players=${s.players.length} rpsChoices=${JSON.stringify(s.rpsChoices)}`);
    if (s.phase === 'rps_cover' || s.phase === 'rps_pick') {
      sawRpsPhase = true;
      const myId = s.players[0].id;
      if (!picked && !s.rpsChoices[myId]) {
        picked = true;
        console.log(`  → 我 (id=${myId}) 出石头`);
        setTimeout(() => ws.send(JSON.stringify({ type: 'rps_pick', hand: 'rock' })), 200);
      }
    }
    if (s.phase === 'rps_reveal') {
      console.log('  → 发送 rps_confirm 进入结算');
      setTimeout(() => ws.send(JSON.stringify({ type: 'rps_confirm' })), 200);
    }
    if (s.phase === 'act_turn') {
      console.log('  ✅✅✅ 进入行动阶段！游戏逻辑通了');
      ws.close();
      process.exit(0);
    }
    if (s.phase === 'finished') {
      console.log('  ⚠️ 游戏已结束 phase=finished');
      ws.close();
      process.exit(0);
    }
  }
  if (m.type === 'error') console.log('[error]', m.message);
});

ws.on('error', (e) => { console.log('[ws error]', e.message); process.exit(1); });
ws.on('close', () => console.log('[close] 连接关闭'));

setTimeout(() => {
  console.log('⏱️ 超时');
  console.log('sawRpsPhase=' + sawRpsPhase + ' picked=' + picked);
  process.exit(1);
}, 10000);