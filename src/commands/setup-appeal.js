const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { config } = require('../config');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-appeal')
    .setDescription('Setup panel permohonan bergabung guild (Khusus Owner)')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel tujuan panel (opsional, default: APPEAL_CHANNEL_ID)')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'Perintah ini hanya dapat dijalankan di dalam server Discord.',
        ephemeral: true,
      });
    }

    // 1. Validasi konfigurasi OWNER_ROLE_ID di .env
    if (!config.ownerRoleId || config.ownerRoleId.trim() === '') {
      return interaction.reply({
        content: '⚠️ `OWNER_ROLE_ID` belum diatur pada file konfigurasi (.env). Silakan isi ID role Owner terlebih dahulu.',
        ephemeral: true,
      });
    }

    // 2. Validasi izin Owner (Role Owner atau Pemilik Server)
    const isServerOwner = interaction.guild.ownerId === interaction.user.id;
    const hasOwnerRole = interaction.member?.roles?.cache?.has(config.ownerRoleId);

    if (!isServerOwner && !hasOwnerRole) {
      return interaction.reply({
        content: '⛔ Anda tidak memiliki izin untuk menjalankan perintah ini. Fitur ini khusus untuk pengguna dengan role Owner.',
        ephemeral: true,
      });
    }

    // 3. Tentukan channel tujuan: dari opsi, atau default ke APPEAL_CHANNEL_ID, atau channel saat ini
    const optionChannel = interaction.options.getChannel('channel');
    let targetChannel = optionChannel;

    const defaultChannelId = config.joinAppealChannelId || config.appealChannelId;
    if (!targetChannel && defaultChannelId && defaultChannelId.trim() !== '') {
      targetChannel = await interaction.guild.channels.fetch(defaultChannelId).catch(() => null);
    }

    if (!targetChannel) {
      targetChannel = interaction.channel;
    }

    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.reply({
        content: '❌ Channel tujuan tidak ditemukan. Harap pilih opsi channel atau isi `APPEAL_CHANNEL_ID` pada file .env.',
        ephemeral: true,
      });
    }

    // 4. Validasi izin bot di channel tujuan
    const botMember = interaction.guild.members.me;
    const channelPermissions = targetChannel.permissionsFor(botMember);

    if (
      !channelPermissions ||
      !channelPermissions.has(PermissionFlagsBits.ViewChannel) ||
      !channelPermissions.has(PermissionFlagsBits.SendMessages) ||
      !channelPermissions.has(PermissionFlagsBits.EmbedLinks)
    ) {
      return interaction.reply({
        content: `❌ Bot tidak memiliki izin yang cukup di channel ${targetChannel}. Pastikan bot memiliki izin: \`View Channel\`, \`Send Messages\`, dan \`Embed Links\`.`,
        ephemeral: true,
      });
    }

    // 5. Susun Embed Panel Guild Join Appeal
    const panelEmbed = new EmbedBuilder()
      .setTitle('🛡️ Guild Join Appeal')
      .setDescription(
        'Welcome to the guild membership application portal!\n\n' +
        'We welcome active, committed players who are ready to contribute positively to the community. ' +
        'If you would like to join, start your application using the button below.\n\n' +
        '📌 **Requirements before applying:**\n' +
        '• An active game account and willingness to participate in guild activities.\n' +
        '• Respectful communication and good sportsmanship.\n' +
        '• Compliance with guild and Discord server rules.\n' +
        '• A minimum Gear Score of 6,000.\n' +
        '• Read and agree to the guild rules before submitting the form.\n\n' +
        '*Press the button below to review the rules and start your application.*'
      )
      .setColor(0x3498db)
      .setFooter({ text: 'Guild Join Appeal System • Please review the rules before applying' })
      .setTimestamp();

    // 6. Susun Tombol Pendaftaran
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('appeal_btn_start')
        .setLabel('Make a Join Appeal')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝'),
    );

    try {
      await targetChannel.send({
        embeds: [panelEmbed],
        components: [actionRow],
      });

      return interaction.reply({
        content: `✅ Panel Guild Join Appeal berhasil dikirim ke channel ${targetChannel}.`,
        ephemeral: true,
      });
    } catch (error) {
      logger.error(`Gagal mengirim panel appeal ke channel ${targetChannel.id}:`, error);
      return interaction.reply({
        content: '❌ Terjadi kendala saat mengirimkan panel ke channel tujuan.',
        ephemeral: true,
      });
    }
  },
};
