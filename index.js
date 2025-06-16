// =================================================================================
// モジュールのインポート
// =================================================================================
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
dotenv.config();

// Discord
const { Client, GatewayIntentBits, Collection, Events } = require("discord.js");

// Webサーバー
const express = require('express');

// データベース & ユーティリティ
const firebaseDb = require('./firebase.js'); // Firebase (申請用)
const sqliteDb = require('./database.js');   // SQLite (承認済み用)
const { decrypt } = require('./utils/encryption.js');

// =================================================================================
// Discord.js ボット部分
// =================================================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
  try {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ("data" in command && "execute" in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`[警告] ${filePath} のコマンドは不正な形式です。`);
    }
  } catch (error) {
    console.error(`[エラー] コマンドファイルの読み込みに失敗: ${error.message}`);
  }
}

// ボット起動時の処理
client.once(Events.ClientReady, c => {
  console.log(`✅ ボット起動完了: ${c.user.tag}`);
  c.application.commands.set(client.commands.map(cmd => cmd.data.toJSON()));
});

// コマンド実行時の処理
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`コマンドエラー (${interaction.commandName}):`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'コマンドの実行中にエラーが発生しました。', ephemeral: true });
    } else {
      await interaction.reply({ content: 'コマンドの実行中にエラーが発生しました。', ephemeral: true });
    }
  }
});


// =================================================================================
// Express Webサーバー部分
// =================================================================================
const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.json()); // APIでJSONを扱えるようにする
app.use(express.urlencoded({ extended: true })); // フォームからのデータを受け取れるようにする

// ---------------------------------------------------------------------------------
// ページ表示用ルート
// ---------------------------------------------------------------------------------

// 承認ページ：Firebaseからデータを取得・復号して表示
app.get('/approve', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send("承認コードが指定されていません。");
  }

  try {
    const docRef = firebaseDb.collection('pending_applications').doc(code);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).send("<h2>申請が見つからないか、既に処理済みです。</h2><p>ページを閉じてください。</p>");
    }

    const decryptedData = decrypt(doc.data().encryptedData, code);
    if (!decryptedData) {
      return res.status(500).send("データの復号に失敗しました。マスターキーが正しいか確認してください。");
    }

    res.render('approve', { user: JSON.parse(decryptedData), invite_code: code });
  } catch (error) {
    console.error("承認ページエラー:", error);
    res.status(500).send("サーバー内部でエラーが発生しました。");
  }
});

// 管理ダッシュボード：SQLiteから承認済みデータを表示 (検索・並べ替え機能付き)
app.get('/admin', (req, res) => {
  const searchQuery = req.query.search || '';
  const sort = req.query.sort || 'approved_at';
  const order = req.query.order || 'DESC';

  const allowedSortColumns = ['id', 'name', 'minecraft_id', 'discord_user_id', 'invite_code', 'approved_at'];
  const sortColumn = allowedSortColumns.includes(sort) ? sort : 'approved_at';
  const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  
  const params = [];
  let sql = `SELECT * FROM approved_users `;

  if (searchQuery) {
    sql += `WHERE name LIKE ? OR minecraft_id LIKE ? OR discord_user_id LIKE ? OR invite_code LIKE ? `;
    params.push(...Array(4).fill(`%${searchQuery}%`));
  }

  sql += `ORDER BY ${sortColumn} ${sortOrder}`;

  sqliteDb.all(sql, params, (err, rows) => {
    if (err) {
      console.error("管理ダッシュボード DBエラー:", err.message);
      return res.status(500).send("データベースエラーが発生しました。");
    }
    res.render('admin', {
      users: rows,
      searchQuery: searchQuery,
      currentSort: sort,
      currentOrder: order.toLowerCase()
    });
  });
});


// ---------------------------------------------------------------------------------
// APIエンドポイント
// ---------------------------------------------------------------------------------

// データを承認し、Firebase -> SQLite へ「保存し直す」API
app.post('/api/finalize-approval', async (req, res) => {
  const { invite_code, userData } = req.body;
  if (!invite_code || !userData) {
    return res.status(400).json({ success: false, message: "リクエストデータが不足しています。" });
  }

  try {
    const { name, reading, minecraftId, minecraftUuid, discordUserId } = userData;
    const sql = `INSERT INTO approved_users (name, reading, minecraft_id, minecraft_uuid, discord_user_id, invite_code) VALUES (?, ?, ?, ?, ?, ?)`;
    
    sqliteDb.run(sql, [name, reading, minecraftId, minecraftUuid, discordUserId, invite_code], async function(err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(409).json({ success: false, message: "このMinecraft UUIDまたはDiscord IDは既に登録済みです。" });
        }
        console.error("SQLite挿入エラー:", err.message);
        return res.status(500).json({ success: false, message: "ローカルデータベースへの保存に失敗しました。" });
      }
      
      // SQLiteへの保存が成功したらFirebaseから削除
      await firebaseDb.collection('pending_applications').doc(invite_code).delete();
      
      res.json({ success: true, message: "承認し、ローカルDBに保存しました。" });
    });
  } catch (error) {
    console.error("承認APIエラー:", error);
    res.status(500).json({ success: false, message: "サーバー内部でエラーが発生しました。" });
  }
});

// 申請を否認する（Firebaseから削除する）API
app.post('/api/deny-application', async (req, res) => {
    const { invite_code } = req.body;
    if (!invite_code) {
        return res.status(400).json({ success: false, message: '招待コードが指定されていません。' });
    }
    try {
        await firebaseDb.collection('pending_applications').doc(invite_code).delete();
        res.json({ success: true, message: '申請を否認し、Firebaseから削除しました。' });
    } catch (error) {
        console.error('申請否認APIエラー:', error);
        res.status(500).json({ success: false, message: 'サーバーエラーが発生しました。' });
    }
});

// 承認済みユーザーを削除するAPI (SQLiteから)
app.post('/api/delete-user', (req, res) => {
    const { id } = req.body;
    if (!id) {
        return res.status(400).json({ success: false, message: 'IDが指定されていません。'});
    }
    const sql = `DELETE FROM approved_users WHERE id = ?`;
    sqliteDb.run(sql, id, function(err) {
        if (err) {
            console.error("SQLite削除エラー:", err.message);
            return res.status(500).json({ success: false, message: 'データベースからの削除に失敗しました。'});
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, message: '削除対象のユーザーが見つかりませんでした。'});
        }
        res.json({ success: true, message: `ユーザー(ID: ${id})を削除しました。`});
    });
});


// =================================================================================
// 起動
// =================================================================================
// Discordボットをログインさせる
client.login(process.env.DISCORD_TOKEN);

// Webサーバーを起動する
app.listen(PORT, () => {
  console.log(`[情報] Webサーバー起動完了: http://localhost:${PORT}/admin`);
});