// ===== 轻量级数据库模块 (SQLite) =====
// 使用 better-sqlite3，数据存储在 data/game.db
// Railway 上重启会丢失，建议后续升级 PostgreSQL

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'game.db');
let db;

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode=WAL');
  db.pragma('foreign_keys=ON');

  // ===== 表定义 =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      token         TEXT UNIQUE,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login    DATETIME
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    INTEGER NOT NULL UNIQUE,
      display_name  TEXT NOT NULL DEFAULT '玩家',
      avatar_idx    INTEGER DEFAULT 0,
      total_games   INTEGER DEFAULT 0,
      total_wins    INTEGER DEFAULT 0,
      total_kills   INTEGER DEFAULT 0,
      total_deaths  INTEGER DEFAULT 0,
      max_kills_game INTEGER DEFAULT 0,
      total_damage  INTEGER DEFAULT 0,
      total_coins   INTEGER DEFAULT 0,
      streak_wins   INTEGER DEFAULT 0,
      best_streak   INTEGER DEFAULT 0,
      bomb_kills    INTEGER DEFAULT 0,
      ranged_kills  INTEGER DEFAULT 0,
      trap_triggers INTEGER DEFAULT 0,
      poison_times  INTEGER DEFAULT 0,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      key           TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL,
      icon          TEXT NOT NULL DEFAULT '🏆',
      category      TEXT DEFAULT 'general',
      target_value  INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS player_achievements (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id    INTEGER NOT NULL,
      achievement_id INTEGER NOT NULL,
      progress      INTEGER DEFAULT 0,
      unlocked      INTEGER DEFAULT 0,
      unlocked_at   DATETIME,
      FOREIGN KEY (profile_id) REFERENCES profiles(id),
      FOREIGN KEY (achievement_id) REFERENCES achievements(id),
      UNIQUE(profile_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS game_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id    INTEGER,
      result        TEXT NOT NULL,  -- win / loss / draw
      kills         INTEGER DEFAULT 0,
      damage_dealt  INTEGER DEFAULT 0,
      coins_earned  INTEGER DEFAULT 0,
      round_count   INTEGER DEFAULT 0,
      player_count  INTEGER DEFAULT 0,
      played_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );
  `);

  // 如果成就表为空，初始化所有成就
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM achievements').get();
  if (count.cnt === 0) {
    seedAchievements();
  }

  console.log('[DB] 数据库初始化完成:', DB_PATH);
}

// ===== 成就定义 =====
function seedAchievements() {
  const achievements = [
    // 胜利类
    { key: 'first_win',       name: '初露锋芒',     description: '赢得第一场游戏',               icon: '👑',  category: 'win',   target_value: 1 },
    { key: 'win_10',          name: '常胜将军',     description: '累计赢得10场游戏',              icon: '🏅',  category: 'win',   target_value: 10 },
    { key: 'win_50',          name: '百战之王',     description: '累计赢得50场游戏',              icon: '🏆',  category: 'win',   target_value: 50 },
    { key: 'streak_3',        name: '三连胜',       description: '连续赢得3场游戏',                icon: '🔥',  category: 'win',   target_value: 3 },
    { key: 'streak_5',        name: '五连绝世',     description: '连续赢得5场游戏',                icon: '💫',  category: 'win',   target_value: 5 },

    // 击杀类
    { key: 'first_kill',      name: '初次见血',     description: '完成第一次击杀',                 icon: '🩸',  category: 'kill',  target_value: 1 },
    { key: 'kill_10',         name: '杀手新星',     description: '累计击杀10人',                  icon: '🔪',  category: 'kill',  target_value: 10 },
    { key: 'kill_50',         name: '杀人狂魔',     description: '累计击杀50人',                  icon: '💀',  category: 'kill',  target_value: 50 },
    { key: 'kill_100',        name: '百人斩',       description: '累计击杀100人',                 icon: '☠️',  category: 'kill',  target_value: 100 },
    { key: 'bomb_10',         name: '爆破专家',     description: '累计用炸弹击杀10人',              icon: '💣',  category: 'kill',  target_value: 10 },
    { key: 'sniper_10',       name: '狙击精英',     description: '累计用远程武器击杀10人',          icon: '🎯',  category: 'kill',  target_value: 10 },
    { key: 'quadra_kill',     name: '四杀！',       description: '单场游戏击杀4人',                icon: '⚡',  category: 'kill',  target_value: 4 },

    // 游戏参与
    { key: 'games_10',        name: '小试牛刀',     description: '游玩10场游戏',                  icon: '🎮',  category: 'game',  target_value: 10 },
    { key: 'games_50',        name: '老玩家',       description: '游玩50场游戏',                  icon: '🎲',  category: 'game',  target_value: 50 },
    { key: 'games_100',       name: '逃杀专家',     description: '游玩100场游戏',                 icon: '🛡️',  category: 'game',  target_value: 100 },

    // 特殊
    { key: 'bare_handed',     name: '赤手空拳',     description: '不带任何武器赢得游戏',            icon: '✊',  category: 'special', target_value: 1 },
    { key: 'trap_master',     name: '陷阱大师',     description: '累计触发5次陷阱',                icon: '🪤',  category: 'special', target_value: 5 },
    { key: 'poison_survivor', name: '百毒不侵',     description: '累计中毒后存活5次',              icon: '🧪',  category: 'special', target_value: 5 },
    { key: 'rich_guy',        name: '富豪',         description: '单局游戏拥有50金币以上',          icon: '💰',  category: 'special', target_value: 1 },
    { key: 'avenger',         name: '复仇者',       description: '击杀上一回合击杀你的人',          icon: '🗡️',  category: 'special', target_value: 1 },
  ];

  const stmt = db.prepare(
    'INSERT INTO achievements (key, name, description, icon, category, target_value) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertMany = db.transaction((items) => {
    for (const a of items) {
      stmt.run(a.key, a.name, a.description, a.icon, a.category, a.target_value);
    }
  });
  insertMany(achievements);
  console.log('[DB] 已初始化', achievements.length, '个成就');
}

// ===== 账户操作 =====

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pw, salt, 100000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.pbkdf2Sync(pw, salt, 100000, 64, 'sha512').toString('hex');
  return hash === check;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** 注册新账号 */
function register(username, password, displayName) {
  const existing = db.prepare('SELECT id FROM accounts WHERE username = ?').get(username);
  if (existing) return { ok: false, error: '用户名已存在' };
  if (username.length < 2 || username.length > 20) return { ok: false, error: '用户名长度需在2-20字符' };
  if (password.length < 4) return { ok: false, error: '密码至少4位' };

  const hash = hashPassword(password);
  const token = generateToken();

  const result = db.prepare(
    "INSERT INTO accounts (username, password_hash, token, last_login) VALUES (?, ?, ?, datetime('now'))"
  ).run(username, hash, token);

  const accountId = result.lastInsertRowid;

  // 创建默认 profile
  db.prepare(
    'INSERT INTO profiles (account_id, display_name) VALUES (?, ?)'
  ).run(accountId, displayName || username);

  // 初始化成就进度
  const achievements = db.prepare('SELECT id FROM achievements').all();
  const paStmt = db.prepare(
    'INSERT OR IGNORE INTO player_achievements (profile_id, achievement_id, progress, unlocked) VALUES (?, ?, 0, 0)'
  );
  const paInsert = db.transaction((pId, achList) => {
    for (const a of achList) {
      paStmt.run(pId, a.id);
    }
  });
  paInsert(accountId, achievements);

  return { ok: true, accountId, token };
}

/** 登录 */
function login(username, password) {
  const account = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
  if (!account) return { ok: false, error: '用户名不存在' };
  if (!verifyPassword(password, account.password_hash)) return { ok: false, error: '密码错误' };

  const token = generateToken();
  db.prepare("UPDATE accounts SET token = ?, last_login = datetime('now') WHERE id = ?")
    .run(token, account.id);

  const profile = db.prepare('SELECT * FROM profiles WHERE account_id = ?').get(account.id);

  return { ok: true, accountId: account.id, token, profile };
}

/** 通过 token 恢复会话（断线重连） */
function reconnect(token) {
  const account = db.prepare('SELECT * FROM accounts WHERE token = ?').get(token);
  if (!account) return { ok: false, error: '登录已过期，请重新登录' };

  db.prepare("UPDATE accounts SET last_login = datetime('now') WHERE id = ?").run(account.id);
  const profile = db.prepare('SELECT * FROM profiles WHERE account_id = ?').get(account.id);

  return { ok: true, accountId: account.id, token, profile };
}

/** 获取账号简要信息 */
function getAccountInfo(accountId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE account_id = ?').get(accountId);
  const account = db.prepare('SELECT id, username, created_at, last_login FROM accounts WHERE id = ?').get(accountId);
  if (!profile || !account) return null;
  // 最近 5 场战绩
  const recent_games = db.prepare(
    'SELECT result, kills, damage_dealt, played_at FROM game_history WHERE profile_id = ? ORDER BY played_at DESC LIMIT 5'
  ).all(profile.id);
  return { ...account, ...profile, recent_games };
}

// ===== 战绩更新 =====

function recordGame(accountId, result, kills, damageDealt, coinsEarned, roundCount, playerCount) {
  const profile = db.prepare('SELECT * FROM profiles WHERE account_id = ?').get(accountId);
  if (!profile) return;

  const tx = db.transaction(() => {
    // 更新 profile 统计数据
    db.prepare(`
      UPDATE profiles SET
        total_games = total_games + 1,
        total_wins = total_wins + ?,
        total_kills = total_kills + ?,
        total_deaths = total_deaths + ?,
        total_damage = total_damage + ?,
        total_coins = total_coins + ?,
        max_kills_game = MAX(max_kills_game, ?),
        streak_wins = CASE WHEN ? THEN streak_wins + 1 ELSE 0 END,
        best_streak = MAX(best_streak, CASE WHEN ? THEN streak_wins + 1 ELSE 0 END)
      WHERE account_id = ?
    `).run(
      result === 'win' ? 1 : 0,
      kills,
      result === 'loss' ? 1 : 0,
      damageDealt,
      coinsEarned,
      kills,
      result === 'win' ? 1 : 0,
      result === 'win' ? 1 : 0,
      accountId
    );

    // 记录历史
    db.prepare(`
      INSERT INTO game_history (profile_id, result, kills, damage_dealt, coins_earned, round_count, player_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(profile.id, result, kills, damageDealt, coinsEarned, roundCount, playerCount);
  });
  tx();
  return { ok: true };
}

// ===== 成就系统 =====

/** 检查并更新成就进度 */
function checkAchievements(accountId, event, value = 1) {
  const profile = db.prepare('SELECT id FROM profiles WHERE account_id = ?').get(accountId);
  if (!profile) return [];

  const newlyUnlocked = [];

  // 根据事件类型查找相关成就
  let achievements = [];
  switch (event) {
    case 'game_win':
      achievements = db.prepare(`
        SELECT pa.*, a.* FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        WHERE pa.profile_id = ? AND a.key IN ('first_win', 'win_10', 'win_50', 'streak_3', 'streak_5')
      `).all(profile.id);
      break;
    case 'kill':
      achievements = db.prepare(`
        SELECT pa.*, a.* FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        WHERE pa.profile_id = ? AND a.key IN ('first_kill', 'kill_10', 'kill_50', 'kill_100')
      `).all(profile.id);
      break;
    case 'bomb_kill':
      achievements = db.prepare(`
        SELECT pa.*, a.* FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        WHERE pa.profile_id = ? AND a.key = 'bomb_10'
      `).all(profile.id);
      break;
    case 'ranged_kill':
      achievements = db.prepare(`
        SELECT pa.*, a.* FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        WHERE pa.profile_id = ? AND a.key = 'sniper_10'
      `).all(profile.id);
      break;
    case 'trap_trigger':
      achievements = db.prepare(`
        SELECT pa.*, a.* FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        WHERE pa.profile_id = ? AND a.key = 'trap_master'
      `).all(profile.id);
      break;
    case 'poison_survive':
      achievements = db.prepare(`
        SELECT pa.*, a.* FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        WHERE pa.profile_id = ? AND a.key = 'poison_survivor'
      `).all(profile.id);
      break;
    case 'game_count':
      achievements = db.prepare(`
        SELECT pa.*, a.* FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        WHERE pa.profile_id = ? AND a.key IN ('games_10', 'games_50', 'games_100')
      `).all(profile.id);
      break;
    case 'quadra_kill':
      achievements = db.prepare(`
        SELECT pa.*, a.* FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        WHERE pa.profile_id = ? AND a.key = 'quadra_kill'
      `).all(profile.id);
      break;
    case 'bare_handed':
      achievements = db.prepare(`
        SELECT pa.*, a.* FROM player_achievements pa
        JOIN achievements a ON pa.achievement_id = a.id
        WHERE pa.profile_id = ? AND a.key = 'bare_handed'
      `).all(profile.id);
      break;
    default:
      return [];
  }

  for (const row of achievements) {
    if (row.unlocked) continue; // 已完成

    const newProgress = Math.min(row.target_value, row.progress + value);
    db.prepare('UPDATE player_achievements SET progress = ? WHERE profile_id = ? AND achievement_id = ?')
      .run(newProgress, profile.id, row.achievement_id);

    if (newProgress >= row.target_value) {
      db.prepare("UPDATE player_achievements SET unlocked = 1, unlocked_at = datetime('now') WHERE profile_id = ? AND achievement_id = ?")
        .run(profile.id, row.achievement_id);
      newlyUnlocked.push({
        key: row.key,
        name: row.name,
        description: row.description,
        icon: row.icon,
      });
    }
  }

  return newlyUnlocked;
}

/** 获取玩家全部成就状态 */
function getPlayerAchievements(accountId) {
  const profile = db.prepare('SELECT id FROM profiles WHERE account_id = ?').get(accountId);
  if (!profile) return [];

  return db.prepare(`
    SELECT a.key, a.name, a.description, a.icon, a.category, a.target_value,
           pa.progress, pa.unlocked, pa.unlocked_at
    FROM player_achievements pa
    JOIN achievements a ON pa.achievement_id = a.id
    WHERE pa.profile_id = ?
    ORDER BY a.category, a.id
  `).all(profile.id);
}

/** 获取排行榜 */
function getLeaderboard(limit = 20) {
  return db.prepare(`
    SELECT a.username, p.display_name, p.total_wins, p.total_games,
           p.total_kills, p.total_damage, p.best_streak
    FROM profiles p
    JOIN accounts a ON p.account_id = a.id
    WHERE p.total_games > 0
    ORDER BY p.total_wins DESC, p.total_kills DESC
    LIMIT ?
  `).all(limit);
}

// ===== 导出 =====
module.exports = {
  init,
  register,
  login,
  reconnect,
  getAccountInfo,
  recordGame,
  checkAchievements,
  getPlayerAchievements,
  getLeaderboard,
};
