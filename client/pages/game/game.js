const ws = require('../../utils/ws');
const { RPS_EMOJI, RPS_NAME, LOCS } = require('../../utils/constants');

Page({
  data: {
    phase: 'loading',
    round: 0,
    players: [],
    myId: '',
    myMoney: 0,
    myItems: [],
    actionsLeft: 0,
    myTurn: false,
    moveTargets: [],
    nearby: [],
    rpsChoices: {},
    rpsLabel: '',
    rpsMyTurn: false,
    event: null,
    winner: null,
    logs: [],

    // 优化新增字段
    displayOverride: null,     // 临时覆盖显示的阶段（用于动画）
    displayTitle: '',          // 当前显示阶段的标题
    displayDesc: '',           // 当前显示阶段的描述
    rpsType: '',               // 'order' | 'combat' | 'skill' | 'bomb'
    roundStartAnim: false,     // 是否正在播放回合开始动画
  },

  onLoad() {
    const app = getApp();
    this.setData({ myId: app.globalData.playerId });

    ws.on('game_state', (msg) => {
      const state = msg.state;
      const my = state.players.find(p => p.id === this.data.myId);
      if (!my) return;

      const isMyTurn = state.phase === 'act_turn' &&
        state.winners && state.winners[state.winnerIdx] === this.data.myId;

      // 生成移动目标
      const moveTargets = Object.values(state.locs).filter(l =>
        l.id !== my.loc && l.id !== state.blockedLoc
      ).map(l => ({
        id: l.id, icon: l.icon, name: l.name,
        players: state.players.filter(p => p.loc === l.id && p.id !== this.data.myId).map(p => p.name).join(','),
      }));

      // 同位置敌人
      const nearby = state.players.filter(p =>
        p.id !== this.data.myId && p.loc === my.loc && p.status !== 'dead'
      );

      // 血条
      const players = state.players.map(p => ({
        ...p,
        hpDisplay: '❤️'.repeat(p.hp) + '🖤'.repeat(Math.max(0, 3 - p.hp)),
      }));

      // === 检测新回合开始 ===
      const newRound = state.round > this.data.round;
      const enteringRps = state.phase === 'rps_cover' || state.phase === 'rps_pick';

      if (newRound && enteringRps) {
        // 显示回合转场动画（1.5秒后自动消失）
        this.setData({
          displayOverride: 'round_start',
          roundStartAnim: true,
          round: state.round,
        });
        setTimeout(() => {
          this.setData({ displayOverride: null, roundStartAnim: false });
        }, 1500);
      }

      // 判断 RPS 类型
      let rpsType = '';
      if (state.phase === 'rps_cover' || state.phase === 'rps_pick' || state.phase === 'rps_reveal') {
        rpsType = 'order';
      } else if (state.phase === 'act_rps') {
        if (state.pendingRps && state.pendingRps.type) {
          rpsType = state.pendingRps.type;
        } else {
          rpsType = 'combat';
        }
      }

      // 生成阶段标题和描述
      let displayTitle = '';
      let displayDesc = '';

      switch (state.phase) {
        case 'rps_cover':
          displayTitle = '🏁 决定行动顺序';
          displayDesc = '猜拳获胜者获得更多行动点！等待所有人出拳...';
          break;
        case 'rps_pick':
          displayTitle = '🏁 决定行动顺序';
          displayDesc = '出拳！获胜者将优先行动';
          break;
        case 'rps_reveal':
          displayTitle = '📊 猜拳结果';
          displayDesc = '猜拳获胜者获得更多行动点';
          break;
        case 'act_rps':
          displayTitle = '⚔️ 战斗对决！';
          displayDesc = '出拳击败对手！';
          break;
        case 'act_turn':
          displayTitle = isMyTurn ? '🎯 你的回合' : '⏳ 等待中';
          displayDesc = isMyTurn ? '选择一个行动' : '其他玩家正在操作...';
          break;
        case 'round_end':
          displayTitle = `📯 第 ${state.round} 回合结束`;
          displayDesc = '点击继续下一回合';
          break;
        default:
          displayTitle = '';
          displayDesc = '';
      }

      this.setData({
        phase: state.phase,
        round: state.round,
        players,
        myMoney: my.money || 0,
        myItems: my.items || [],
        actionsLeft: state.actionsLeft,
        myTurn: isMyTurn,
        moveTargets,
        nearby,
        rpsChoices: state.rpsChoices || {},
        event: state.currentEvent,
        winner: state.winner,
        logs: state.log || [],
        displayTitle,
        displayDesc,
        rpsType,
      });
    });

    ws.on('rps_challenge', (msg) => {
      this.setData({
        rpsLabel: msg.label,
        rpsMyTurn: msg.myTurn,
      });
    });
  },

  getLocName(locId) {
    if (locId && locId.startsWith('home')) return '🏠家';
    return LOCS[locId] ? LOCS[locId].icon + LOCS[locId].name : locId;
  },

  getItemIcons(items) {
    if (!items || !items.length) return '';
    return items.map(i => i.icon).join('');
  },

  rpsPick(e) {
    const hand = e.currentTarget.dataset.hand;
    ws.send({ type: 'rps_pick', hand });
  },

  confirmRps() {
    ws.send({ type: 'rps_confirm' });
  },

  doAction(e) {
    const { action, target, weapon } = e.currentTarget.dataset;
    ws.send({ type: 'action', action, target, weapon });
  },

  rpsSubmit(e) {
    const hand = e.currentTarget.dataset.hand;
    ws.send({ type: 'rps_submit', hand });
  },

  nextRound() {
    ws.send({ type: 'next_round' });
  },

  backToLobby() {
    wx.redirectTo({ url: '/pages/index/index' });
  },
});
