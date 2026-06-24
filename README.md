# 🛏️ 起床！大逃杀桌游 - 微信小程序版

> 本地传屏版 → 远程联机版

## 📦 项目结构

```
qichuang-miniapp/
├── server/                # Node.js WebSocket 服务端
│   ├── package.json
│   ├── index.js           # WebSocket 服务器 + 房间管理
│   ├── game.js            # 游戏引擎（逻辑仲裁）
│   └── constants.js       # 游戏常量
├── client/                # 微信小程序前端
│   ├── app.js / app.json / app.wxss
│   ├── project.config.json
│   ├── pages/
│   │   ├── index/         # 首页（创建/加入房间）
│   │   ├── room/          # 房间等待页
│   │   └── game/          # 游戏主界面
│   └── utils/
│       ├── constants.js   # 客户端常量
│       └── ws.js          # WebSocket 连接管理
└── README.md
```

## 🚀 开发环境搭建

### 1. 安装依赖

```bash
# 服务端
cd qichuang-miniapp/server
npm install
```

### 2. 启动服务端

```bash
cd qichuang-miniapp/server
node index.js
```

服务端默认运行在 `ws://localhost:3001`

### 3. 配置微信小程序

1. 下载安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 打开开发者工具 → 导入项目 → 选择 `qichuang-miniapp/client` 目录
3. 修改 `client/app.js` 中的 `serverUrl` 为你的服务器地址
4. 修改 `client/project.config.json` 中的 `appid` 为你的微信小程序 AppID

### 4. 联机测试

- 本地测试：启动服务端 + 微信开发者工具
- 多设备：部署服务端到云服务器（推荐 [Railway](https://railway.app/) 或 [Render](https://render.com/)），然后修改 `serverUrl`

## 🧪 服务端部署（生产环境）

推荐使用 Railway 一键部署：

1. 在 Railway 新建项目 → Deploy from GitHub repo
2. 设置 Start Command: `cd server && node index.js`
3. 部署完成后获得 URL，如 `wss://qichuang.up.railway.app`
4. 修改 `client/app.js` 中的 `serverUrl` 为该地址

## 📱 游戏特色

- **信息迷雾**：联机版看不到别人位置和道具，望远镜才有效
- **10个地点**：靶场、教堂、酒吧等新地点
- **道具合成**：淬毒匕首、速射手枪
- **蹲伏埋伏**：隐藏伏击路过的玩家
- **通缉系统**：杀人太多会被通缉
- **随机事件**：空投、暴雨、火灾等
- **心理博弈**：猜别人会去哪里，规划路线

## 🗺️ 路线图

- [x] 第一阶段：项目搭建 + 服务端 + 基础联机
- [ ] 第二阶段：完善游戏UI、道具操作、AI
- [ ] 第三阶段：信息隐藏、望远镜生效
- [ ] 第四阶段：心理战系统（诈死、留言、替身）
- [ ] 第五阶段：复杂地图（分支路线、秘密通道）
