// ===== 游戏常量 =====
const MAX_HP = 3;
const MAX_ITEMS = 5;
const START_MONEY = 12;

const RPS = ['rock', 'scissors', 'paper'];
const HAND_BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

const MAP_ORDER = [
  'shop', 'park', 'range', 'hospital', 'church',
  'lab', 'ruins', 'warehouse', 'bar', 'blackmarket'
];

const LOCS = {
  shop:       { id: 'shop',       name: '商店',   icon: '🏪', desc: '购买基础装备和物资' },
  park:       { id: 'park',       name: '公园',   icon: '🌳', desc: '锻炼身体或搜索特殊物资' },
  range:      { id: 'range',      name: '靶场',   icon: '🎯', desc: '练习射击，提升远程命中率' },
  hospital:   { id: 'hospital',   name: '医院',   icon: '🏥', desc: '治疗伤势和状态' },
  church:     { id: 'church',     name: '教堂',   icon: '⛪', desc: '祈祷庇护或忏悔赎罪' },
  lab:        { id: 'lab',        name: '实验室', icon: '🔬', desc: '制造高级道具' },
  ruins:      { id: 'ruins',      name: '废墟',   icon: '🏚️', desc: '高风险探索，可能找到稀有道具' },
  warehouse:  { id: 'warehouse',  name: '仓库',   icon: '📦', desc: '翻找物资或设置陷阱' },
  bar:        { id: 'bar',        name: '酒吧',   icon: '🍺', desc: '花钱买情报或赌博' },
  blackmarket:{ id: 'blackmarket',name: '黑市',   icon: '🏴', desc: '花费HP购买高级道具' },
};

const ITEMS = {
  dagger:          { id: 'dagger',          name: '匕首',     icon: '🔪', desc: '近战1伤害，可复用',               dmg: 1, range: 'melee' },
  gun:             { id: 'gun',             name: '手枪',     icon: '🔫', desc: '远程1伤害，2发子弹',              dmg: 1, range: 'ranged', ammo: 2 },
  enhanced:        { id: 'enhanced',        name: '强化匕首', icon: '⚔️', desc: '近战2伤害，无视防弹衣',            dmg: 2, range: 'melee', ignoreVest: true },
  bomb:            { id: 'bomb',            name: '炸弹',     icon: '💣', desc: '同位置所有人3伤害',               dmg: 3, range: 'melee' },
  sniper:          { id: 'sniper',          name: '狙击枪',   icon: '🎯', desc: '远程2伤害，仅1发',                dmg: 2, range: 'ranged', ammo: 1 },
  taser:           { id: 'taser',           name: '电击枪',   icon: '⚡', desc: '远程眩晕，一次性',                dmg: 0, range: 'ranged', stun: true, ammo: 1 },
  vest:            { id: 'vest',            name: '防弹衣',   icon: '🛡️', desc: '吸收2伤害后损坏',                 durability: 2 },
  medkit:          { id: 'medkit',          name: '急救包',   icon: '💊', desc: '恢复2HP' },
  bandage:         { id: 'bandage',         name: '绷带',     icon: '🩹', desc: '恢复1HP' },
  poison:          { id: 'poison',          name: '毒药',     icon: '🧪', desc: '投放在地点，到达的人中毒' },
  stimulant:       { id: 'stimulant',       name: '兴奋剂',   icon: '💉', desc: '立即+2行动点' },
  beartrap:        { id: 'beartrap',        name: '捕兽夹',   icon: '🪤', desc: '触发者受1伤+眩晕' },
  poisoned_dagger: { id: 'poisoned_dagger', name: '淬毒匕首', icon: '🗡️', desc: '1伤+中毒，可复用',                dmg: 1, range: 'melee', poisonOnHit: true },
  burst_gun:       { id: 'burst_gun',       name: '速射手枪', icon: '🔫', desc: '远程1伤害，3发子弹',              dmg: 1, range: 'ranged', ammo: 3 },
  binoculars:      { id: 'binoculars',      name: '望远镜',   icon: '🔭', desc: '侦查敌人位置' },
  talisman:        { id: 'talisman',        name: '护身符',   icon: '📿', desc: '抵挡一次伤害' },
};

const EVENTS = [
  { id: 'airdrop',  icon: '🚁', name: '空投补给', desc: '随机地点掉落稀有道具！' },
  { id: 'rain',     icon: '🌧️', name: '暴雨',     desc: '所有人本回合不能远程攻击' },
  { id: 'fire',     icon: '🔥', name: '火灾',     desc: '随机一个地点被封锁' },
  { id: 'cleanse',  icon: '🧹', name: '大扫除',   desc: '所有陷阱和毒药被清除' },
  { id: 'discount', icon: '💲', name: '黑市折扣', desc: '黑市交易不消耗HP' },
];

const SHOP_ITEMS = [
  { id: 'dagger', cost: 3, icon: '🔪', name: '购买匕首', desc: '近战1伤害，可复用' },
  { id: 'gun',    cost: 5, icon: '🔫', name: '购买手枪', desc: '远程1伤害，2发子弹' },
  { id: 'vest',   cost: 4, icon: '🛡️', name: '购买防弹衣', desc: '吸收2伤害后损坏' },
  { id: 'medkit', cost: 3, icon: '💊', name: '购买急救包', desc: '恢复2HP' },
];

module.exports = {
  MAX_HP, MAX_ITEMS, START_MONEY,
  RPS, HAND_BEATS,
  MAP_ORDER, LOCS, ITEMS, EVENTS, SHOP_ITEMS,
};
