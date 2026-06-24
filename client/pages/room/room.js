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
      this.setData({ players: msg.players });
      // 自己是列表中第一个玩家才是房主
      if (msg.players.length > 0 && msg.players[0].id === myId) {
        this.setData({ isHost: true });
      }
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
});
