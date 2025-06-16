const sqlite3 = require('sqlite3').verbose();
const DB_SOURCE = "./approved_users.db";

const db = new sqlite3.Database(DB_SOURCE, (err) => {
  if (err) throw err;
  console.log("SQLiteデータベースに接続しました。");
});

db.run(`CREATE TABLE IF NOT EXISTS approved_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  reading TEXT,
  minecraft_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL UNIQUE,
  discord_user_id TEXT NOT NULL UNIQUE,
  invite_code TEXT NOT NULL UNIQUE,
  approved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

module.exports = db;