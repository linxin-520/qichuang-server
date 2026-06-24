const ws = require('../../utils/ws');

Page({
  data: {
    playerName: '',
    roomIdInput: '',
  },

  onNameInput(e) { this.setData({ playerName: e.detail.value }); },
  onRoomIdInput(e) { this.setData({ roomIdInput: e.detail.value }); },

  async createRoom() {
    const name = this.data.playerName.trim() || '玩家' + Math.floor(Math.random() * 1000);
    wx.showLoading({ title: '创建房间…' });
    const app = getApp();
    try {
      await ws.connect(app.globalData.serverUrl);

      // 发送创建房间请求，等待服务器回复
      const res = await new Promise((resolve, reject) => {
        // 一次性监听 room_joined
        const onJoined = (msg) => { resolve(msg); };
        const onError = (msg) => { reject(new Error(msg.msg)); };
        ws.on('room_joined', onJoined);
        ws.on('error', onError);
        ws.send({ type: 'create_room', playerName: name });
      });

      wx.hideLoading();
      app.globalData.roomId = res.roomId;
      app.globalData.playerId = res.playerId;
      wx.navigateTo({ url: `/pages/room/room?roomId=${res.roomId}` });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  async joinRoom() {
    const roomId = this.data.roomIdInput.trim();
    if (!roomId) { wx.showToast({ title: '请输入房间号', icon: 'none' }); return; }
    const name = this.data.playerName.trim() || '玩家' + Math.floor(Math.random() * 1000);
    wx.showLoading({ title: '加入房间…' });
    const app = getApp();
    try {
      await ws.connect(app.globalData.serverUrl);

      // 发送加入房间请求，等待服务器回复
      const res = await new Promise((resolve, reject) => {
        const onJoined = (msg) => { resolve(msg); };
        const onError = (msg) => { reject(new Error(msg.msg)); };
        ws.on('room_joined', onJoined);
        ws.on('error', onError);
        ws.send({ type: 'join_room', roomId, playerName: name });
      });

      wx.hideLoading();
      app.globalData.roomId = res.roomId;
      app.globalData.playerId = res.playerId;
      wx.navigateTo({ url: `/pages/room/room?roomId=${res.roomId}` });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },
});
