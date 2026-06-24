const WebSocket = require('ws');
const ws = new WebSocket('wss://qichuang-server-production.up.railway.app');
ws.on('open',()=>{
  console.log('CONNECTED');
  ws.send(JSON.stringify({type:'create_room',playerName:'test'}));
});
let msgCount=0;
ws.on('message',d=>{
  const m=JSON.parse(d.toString());
  msgCount++;
  console.log(msgCount+'.',m.type, m.type==='game_state'?'phase='+m.state.phase+' winners='+(m.state.winners||'MISSING'):'');
  if(m.type==='room_joined'){
    // Set ready and start game to get game_state
    ws.send(JSON.stringify({type:'set_ready',ready:true}));
    setTimeout(()=>{
      ws.send(JSON.stringify({type:'start_game'}));
    },300);
  }
  if(m.type==='game_state'){
    console.log('  winners:',m.state.winners?'EXISTS':'MISSING');
    console.log('  winnerIdx:',m.state.winnerIdx);
    console.log('  actionsLeft:',m.state.actionsLeft);
    console.log('  rpsChoices:',m.state.rpsChoices?'EXISTS':'MISSING');
    ws.close();process.exit(0);
  }
});
ws.on('error',e=>{console.log('ERR:',e.message);process.exit(1);});
setTimeout(()=>{console.log('TIMEOUT');process.exit(1);},15000);
