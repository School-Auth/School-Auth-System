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

    // モーダルの送信を待機します。
    let modalInteraction;
    try {
        modalInteraction = await interaction.awaitModalSubmit({ 
            filter: (i) => i.customId === `create-invite-modal-${interaction.user.id}`, 
            time: 120_000 // 2分間
        });
    } catch (error) {
        // タイムアウトした場合はユーザーに通知して処理を終了します。
        await interaction.followUp({ content: "時間内に応答がなかったため、処理をキャンセルしました。", ephemeral: true });
        return;
    }

    // QRコード生成など時間のかかる処理が続くため、応答を一度保留にします。
    await modalInteraction.deferReply({ ephemeral: true });

    try {
      const name = modalInteraction.fields.getTextInputValue("name-input");
      const reading = modalInteraction.fields.getTextInputValue("reading-input");
      const minecraftId = modalInteraction.fields.getTextInputValue("minecraft-id-input");
      
      // Mojang APIを使用してMinecraft IDの有効性を検証します。
      let minecraftUuid;
      try {
        const response = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${minecraftId}`);
        minecraftUuid = response.data.id;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          await modalInteraction.editReply({
            content: `❌ **エラー:** Minecraft ID \`${minecraftId}\` は見つかりませんでした。\n実在するIDを、大文字・小文字を正確に入力してください。`,
          });
        } else {
          console.error("Mojang API Error:", error);
          await modalInteraction.editReply({
            content: 'Minecraft IDの確認中に外部APIでエラーが発生しました。しばらくしてからもう一度お試しください。',
          });
        }
        return;
      }

      // 承認ページのURLに必要な環境変数が設定されているか確認します。
      const serverIp = process.env.SERVER_IP;
      if (!serverIp) {
        console.error("Error: SERVER_IP is not set in environment variables.");
        await modalInteraction.editReply({
          content: 'サーバーの設定に問題があるため、QRコードを生成できませんでした。管理者に連絡してください。',
        });
        return;
      }

      // 申請データを生成し、暗号化してデータベースに保存します。
      const inviteCode = uuidv4().split("-")[0].toUpperCase();
      const userData = { name, reading, minecraftId, minecraftUuid, discordUserId: interaction.user.id };
      const encryptedData = encrypt(JSON.stringify(userData), inviteCode);

      await firebaseDb.collection('pending_applications').doc(inviteCode).set({
        encryptedData: encryptedData,
        createdAt: new Date()
      });

      // 承認用URLからQRコードとDiscord埋め込みメッセージを作成します。
      const port = process.env.PORT || 3000;
      const approvalUrl = `http://${serverIp}:${port}/approve?code=${inviteCode}`;
      const qrCodeBuffer = await qrcode.toBuffer(approvalUrl);
      const attachment = new AttachmentBuilder(qrCodeBuffer, { name: "approval-qr.png" });

      const embed = new EmbedBuilder()
        .setTitle("✅ 管理者への申請用QRコード")
        .setDescription("このQRコードをロイロノートで提出箱に提出し、登録を承認してもらってください。")
        .setImage("attachment://approval-qr.png")
        .setColor(0x5865F2);
      
      // QRコードを含む最終的な応答を送信します。
      await modalInteraction.editReply({ embeds: [embed], files: [attachment] });

    } catch (error) {
      console.error("コマンド処理中に予期せぬエラーが発生しました:", error);
      // 応答が保留中のままエラーになった場合、ユーザーにエラーを通知します。
      if (modalInteraction && !modalInteraction.replied) {
          await modalInteraction.editReply({
              content: 'コマンドの実行中に予期せぬエラーが発生しました。開発者に連絡してください。',
          });
      }
    }
  },
};
