// ===== 客户端游戏常量（展示用）=====
const RPS_EMOJI = { rock: '✊', scissors: '✌️', paper: '✋' };
const RPS_NAME = { rock: '石头', scissors: '剪刀', paper: '布' };
const MAX_HP = 3;
const MAX_ITEMS = 5;

const MAP_ORDER = [
  'shop', 'park', 'range', 'hospital', 'church',
  'lab', 'ruins', 'warehouse', 'bar', 'blackmarket'
];

const LOCS = {
  shop:       { id: 'shop',       name: '商店',   icon: '🏪' },
  park:       { id: 'park',       name: '公园',   icon: '🌳' },
  range:      { id: 'range',      name: '靶场',   icon: '🎯' },
  hospital:   { id: 'hospital',   name: '医院',   icon: '🏥' },
  church:     { id: 'church',     name: '教堂',   icon: '⛪' },
  lab:        { id: 'lab',        name: '实验室', icon: '🔬' },
  ruins:      { id: 'ruins',      name: '废墟',   icon: '🏚️' },
  warehouse:  { id: 'warehouse',  name: '仓库',   icon: '📦' },
  bar:        { id: 'bar',        name: '酒吧',   icon: '🍺' },
  blackmarket:{ id: 'blackmarket',name: '黑市',   icon: '🏴' },
};

module.exports = { RPS_EMOJI, RPS_NAME, MAX_HP, MAX_ITEMS, MAP_ORDER, LOCS };
