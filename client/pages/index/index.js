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
    let onJoined, onError;
    try {
      await ws.connect(app.globalData.serverUrl);

      // 发送创建房间请求，等待服务器回复
      const res = await new Promise((resolve, reject) => {
        onJoined = (msg) => resolve(msg);
        onError = (msg) => reject(new Error(msg.msg || '创建失败'));
        ws.on('room_joined', onJoined);
        ws.on('error', onError);
        ws.send({ type: 'create_room', playerName: name });
      });

      wx.hideLoading();
      app.globalData.roomId = res.roomId;
      app.globalData.playerId = res.playerId;
      app.globalData.hostId = res.hostId;
      if (onJoined) ws.off('room_joined', onJoined);
      if (onError)  ws.off('error', onError);
      wx.navigateTo({ url: `/pages/room/room?roomId=${res.roomId}` });
    } catch (e) {
      wx.hideLoading();
      if (onJoined) ws.off('room_joined', onJoined);
      if (onError)  ws.off('error', onError);
      wx.showToast({ title: e.message || '创建失败', icon: 'none' });
    }
  },

  async joinRoom() {
    const roomId = this.data.roomIdInput.trim();
    if (!roomId) { wx.showToast({ title: '请输入房间号', icon: 'none' }); return; }
    const name = this.data.playerName.trim() || '玩家' + Math.floor(Math.random() * 1000);
    wx.showLoading({ title: '加入房间…' });
    const app = getApp();
    let onJoined, onError;
    try {
      await ws.connect(app.globalData.serverUrl);

      // 发送加入房间请求，等待服务器回复
      const res = await new Promise((resolve, reject) => {
        onJoined = (msg) => resolve(msg);
        onError = (msg) => reject(new Error(msg.msg || '加入失败'));
        ws.on('room_joined', onJoined);
        ws.on('error', onError);
        ws.send({ type: 'join_room', roomId, playerName: name });
      });

      wx.hideLoading();
      app.globalData.roomId = res.roomId;
      app.globalData.playerId = res.playerId;
      app.globalData.hostId = res.hostId;
      if (onJoined) ws.off('room_joined', onJoined);
      if (onError)  ws.off('error', onError);
      wx.navigateTo({ url: `/pages/room/room?roomId=${res.roomId}` });
    } catch (e) {
      wx.hideLoading();
      if (onJoined) ws.off('room_joined', onJoined);
      if (onError)  ws.off('error', onError);
      wx.showToast({ title: e.message || '加入失败', icon: 'none' });
    }
  },
});
