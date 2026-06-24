const WebSocket = require('ws');
const SRV = 'wss://qichuang-server-production.up.railway.app';
let roomId = null;

// Player 1
const ws1 = new WebSocket(SRV);
ws1.on('open', () => ws1.send(JSON.stringify({type:'create_room',playerName:'P1'})));
ws1.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.type === 'room_joined') {
    roomId = m.roomId;
    console.log('Room:', roomId);
    ws1.send(JSON.stringify({type:'set_ready',ready:true}));
    // Player 2 joins
    const ws2 = new WebSocket(SRV);
    ws2.on('open', () => ws2.send(JSON.stringify({type:'join_room',roomId,playerName:'P2'})));
    ws2.on('message', d2 => {
      const m2 = JSON.parse(d2.toString());
      if (m2.type === 'room_joined') {
        ws2.send(JSON.stringify({type:'set_ready',ready:true}));
      }
    });
  }
  if (m.type === 'game_state') {
    console.log('GAME STATE phase:', m.state.phase);
    console.log('  winners:', m.state.winners ? '✓' : '✗ MISSING');
    console.log('  winnerIdx:', m.state.winnerIdx !== undefined ? m.state.winnerIdx : '✗ MISSING');
    console.log('  actionsLeft:', m.state.actionsLeft !== undefined ? m.state.actionsLeft : '✗ MISSING');
    console.log('  rpsChoices:', m.state.rpsChoices ? '✓' : '✗ MISSING');
    console.log('  pendingRps:', m.state.pendingRps ? '✓' : '✗ MISSING');
    ws1.close(); process.exit(0);
  }
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 15000);
