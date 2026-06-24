// ===== WebSocket 连接管理 =====
let ws = null;
let handlers = {};  // type -> [fn, fn, ...]

function connect(url) {
  return new Promise((resolve, reject) => {
    if (ws) disconnect();
    let settled = false;

    console.log('[ws] 开始连接:', url);

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.error('[ws] 超时 - 8秒未连接成功');
        reject(new Error('连接超时，请确认游戏服务器已启动'));
      }
    }, 8000);

    const task = wx.connectSocket({
      url,
      timeout: 5000,
      fail: (err) => {
        console.error('[ws] connectSocket fail:', JSON.stringify(err));
        if (!settled) { settled = true; reject(new Error('连接失败: ' + (err.errMsg || '未知错误'))); }
      },
    });

    task.onOpen(() => {
      console.log('[ws] onOpen 连接成功');
      if (!settled) { settled = true; clearTimeout(timeoutId); resolve(); }
    });

    task.onError((err) => {
      console.error('[ws] onError:', JSON.stringify(err));
      if (!settled) { settled = true; clearTimeout(timeoutId); reject(new Error('连接错误: ' + (err.errMsg || '未知错误'))); }
    });

    task.onMessage((res) => {
      try {
        const msg = JSON.parse(res.data);
        const fns = handlers[msg.type];
        if (fns) fns.forEach(fn => fn(msg));
        const allFns = handlers['*'];
        if (allFns) allFns.forEach(fn => fn(msg));
      } catch (e) {
        console.error('[ws] 解析失败', e);
      }
    });

    task.onClose(() => {
      console.log('[ws] 连接关闭');
      ws = null;
      const closeFns = handlers['close'];
      if (closeFns) closeFns.forEach(fn => fn());
    });

    ws = task;
  });
}

function send(data) {
  if (ws && ws.readyState === 1) {
    const str = JSON.stringify(data);
    ws.send({ data: str });
  } else {
    console.warn('[ws] 发送失败, 状态:', ws ? ws.readyState : 'null');
  }
}

/** 注册监听器（支持多个同类型） */
function on(type, fn) {
  if (!handlers[type]) handlers[type] = [];
  handlers[type].push(fn);
}

/** 移除指定监听器 */
function off(type, fn) {
  if (!handlers[type]) return;
  handlers[type] = handlers[type].filter(f => f !== fn);
  if (handlers[type].length === 0) delete handlers[type];
}

function disconnect() {
  if (ws) ws.close();
  ws = null;
  handlers = {};
}

module.exports = { connect, send, on, off, disconnect };
