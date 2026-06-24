const WebSocket = require('ws');
const url = 'wss://qichuang-server-production.up.railway.app';
console.log('测试连接:', url);
const ws = new WebSocket(url);
ws.on('open', () => {
  console.log('✅ 连接成功！服务器正常');
  ws.send(JSON.stringify({ type: 'create_room', playerName: 'tester' }));
});
ws.on('message', (data) => {
  console.log('收到:', data.toString());
  ws.close();
});
ws.on('error', (err) => {
  console.error('❌ 连接失败:', err.message);
});
ws.on('close', () => {
  console.log('连接关闭');
  process.exit(0);
});
setTimeout(() => {
  console.log('❌ 超时 - 服务器无响应');
  process.exit(1);
}, 10000);
