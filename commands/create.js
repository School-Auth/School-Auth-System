const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { v4: uuidv4 } = require("uuid");
const qrcode = require("qrcode");
const axios = require("axios");
const firebaseDb = require("../firebase.js");
const { encrypt } = require("../utils/encryption.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("create")
    .setDescription("管理者への登録申請用QRコードを生成します。"),

  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId(`create-invite-modal-${interaction.user.id}`)
      .setTitle("ユーザー情報入力");
    
    const nameInput = new TextInputBuilder().setCustomId("name-input").setLabel("名前").setStyle(TextInputStyle.Short).setRequired(true);
    const readingInput = new TextInputBuilder().setCustomId("reading-input").setLabel("読み仮名").setStyle(TextInputStyle.Short).setRequired(true);
    const minecraftIdInput = new TextInputBuilder().setCustomId("minecraft-id-input").setLabel("Minecraft ID").setStyle(TextInputStyle.Short).setRequired(true);
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(readingInput),
      new ActionRowBuilder().addComponents(minecraftIdInput)
    );
    await interaction.showModal(modal);

    // モーダル送信を待つためのtry-catch
    let modalInteraction;
    try {
        modalInteraction = await interaction.awaitModalSubmit({ 
            filter: (i) => i.customId === `create-invite-modal-${interaction.user.id}`, 
            time: 120_000 
        });
    } catch (error) {
        // ユーザーが時間内にモーダルを送信しなかった場合
        // この時点ではdeferされていないので、followUpでOK
        await interaction.followUp({ content: "時間内に応答がなかったため、処理をキャンセルしました。", ephemeral: true });
        return;
    }

    // ★★★ここから先の処理全体をtry-catchで囲む★★★
    try {
      // 最初に一度だけ応答を保留する
      await modalInteraction.deferReply({ ephemeral: true });

      const name = modalInteraction.fields.getTextInputValue("name-input");
      const reading = modalInteraction.fields.getTextInputValue("reading-input");
      const minecraftId = modalInteraction.fields.getTextInputValue("minecraft-id-input");
      
      // --- Minecraft IDの検証とエラーハンドリング ---
      let minecraftUuid;
      try {
        const response = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${minecraftId}`);
        minecraftUuid = response.data.id;
      } catch (error) {
        // axiosのエラーかどうかを判定
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          // 404エラー（IDが見つからない）の場合、専用のメッセージを表示して処理を終了
          await modalInteraction.editReply({
            content: `❌ **エラー:** Minecraft ID \`${minecraftId}\` は見つかりませんでした。\n実在するIDを、大文字・小文字を正確に入力してください。`,
          });
        } else {
          // その他のAPIエラー（ネットワーク障害など）
          console.error("Mojang APIエラー:", error);
          await modalInteraction.editReply({
            content: 'Minecraft IDの確認中に外部APIでエラーが発生しました。しばらくしてからもう一度お試しください。',
          });
        }
        // ★エラーがあった場合は、ここで処理を完全に停止する
        return; 
      }

      // --- データベース処理と応答 ---
      const inviteCode = uuidv4().split("-")[0].toUpperCase();
      const userData = { name, reading, minecraftId, minecraftUuid, discordUserId: interaction.user.id };
      const encryptedData = encrypt(JSON.stringify(userData), inviteCode);

      // Firebaseに暗号化データを保存
      await firebaseDb.collection('pending_applications').doc(inviteCode).set({
        encryptedData: encryptedData,
        createdAt: new Date()
      });

      const approvalUrl = `http://localhost:${process.env.PORT || 3000}/approve?code=${inviteCode}`;
      const qrCodeBuffer = await qrcode.toBuffer(approvalUrl);
      const attachment = new AttachmentBuilder(qrCodeBuffer, { name: "approval-qr.png" });

      const embed = new EmbedBuilder()
        .setTitle("✅ 管理者への申請用QRコード")
        .setDescription("このQRコードをロイロノートで提出箱に提出し、登録を承認してもらってください。")
        .setImage("attachment://approval-qr.png")
        .setColor(0x5865F2);
      
      // deferを編集して最終的な応答を返す
      await modalInteraction.editReply({ embeds: [embed], files: [attachment] });

    } catch (error) {
      console.error("コマンド処理中に予期せぬエラー:", error);
      // 既にdeferされているはずなので、editReplyでエラーメッセージを返す
      if (modalInteraction && !modalInteraction.replied) {
          await modalInteraction.editReply({
            content: 'コマンドの実行中に予期せぬエラーが発生しました。開発者に連絡してください。',
          });
      }
    }
  },
};