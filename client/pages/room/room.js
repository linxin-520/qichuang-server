const ws = require('../../utils/ws');

Page({
  data: {
    roomId: '',
    players: [],
    myReady: false,
    isHost: false,
  },

  onLoad(options) {
    this.setData({ roomId: options.roomId || '' });
    const app = getApp();
    const myId = app.globalData.playerId;

    ws.on('room_update', (msg) => {
      // 服务端不再附带 hostId，所以从 app 全局读（创建时存）
      this.setData({
        players: msg.players,
        isHost: (app.globalData.hostId !== undefined)
          ? app.globalData.hostId === myId
          : (msg.players.length > 0 && msg.players[0].id === myId),
      });
    });

    ws.on('game_started', () => {
      wx.redirectTo({ url: '/pages/game/game' });
    });

    ws.on('close', () => {
      wx.showToast({ title: '连接断开', icon: 'none' });
      wx.redirectTo({ url: '/pages/index/index' });
    });
  },

  toggleReady() {
    const newReady = !this.data.myReady;
    this.setData({ myReady: newReady });
    ws.send({ type: 'set_ready', ready: newReady });
  },

  startGame() {
    ws.send({ type: 'start_game' });
  },

  addAI() {
    const diffs = ['easy', 'normal', 'hard'];
    const diff = diffs[Math.floor(Math.random() * diffs.length)];
    ws.send({ type: 'add_ai', diff });
  },
});
