const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const { isStaff } = require('../utils/appealInteractions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('find-player')
    .setDescription('Search player appeal history by Roblox username or Discord account (Officer/Owner only)')
    .addStringOption((option) =>
      option
        .setName('roblox_username')
        .setDescription('Search by Roblox username')
        .setRequired(false)
        .setMinLength(2)
        .setMaxLength(50)
    )
    .addUserOption((option) =>
      option
        .setName('discord_user')
        .setDescription('Search by selecting a Discord user/member')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('discord_name')
        .setDescription('Search by typing Discord username, tag, or ID')
        .setRequired(false)
        .setMinLength(2)
        .setMaxLength(50)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'This command can only be used inside a Discord server.',
        ephemeral: true,
      });
    }

    // Hanya Staff/Owner yang boleh mengakses data pemain
    if (!isStaff(interaction.member, interaction.guild)) {
      return interaction.reply({
        content: '⛔ You do not have permission to use this lookup command (Officer/Owner only).',
        ephemeral: true,
      });
    }

    const robloxUsername = interaction.options.getString('roblox_username')?.trim();
    const discordUser = interaction.options.getUser('discord_user');
    const discordName = interaction.options.getString('discord_name')?.trim();

    // Validasi: Pengguna harus mengisi setidaknya salah satu opsi
    if (!robloxUsername && !discordUser && !discordName) {
      return interaction.reply({
        content:
          '⚠️ Please provide at least one search option:\n' +
          '• `roblox_username` — Search by Roblox username\n' +
          '• `discord_user` — Select a Discord user\n' +
          '• `discord_name` — Type a Discord username, tag, or ID',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    let results = [];
    let searchLabel = '';

    if (discordUser) {
      results = db.searchAppealsByDiscord(discordUser.id);
      searchLabel = `Discord User: <@${discordUser.id}> (${discordUser.tag})`;
    } else if (discordName) {
      results = db.searchAppealsByDiscord(discordName);
      searchLabel = `Discord Name/ID: "${discordName}"`;
    } else if (robloxUsername) {
      results = db.searchAppealsByRoblox(robloxUsername);
      searchLabel = `Roblox Username: "${robloxUsername}"`;
    }

    if (!results || results.length === 0) {
      const notFoundEmbed = new EmbedBuilder()
        .setTitle('🔍 Player Lookup Results')
        .setColor(0xe74c3c)
        .setDescription(
          `❌ No appeal history found for **${searchLabel}**.\n\n` +
          `*Note: The user may have never submitted an appeal, or the name does not match.*`
        )
        .setFooter({ text: 'Guild Appeal Database • Officer Lookup' })
        .setTimestamp();

      return interaction.editReply({ embeds: [notFoundEmbed] });
    }

    // Jika ditemukan tepat 1 riwayat appeal
    if (results.length === 1) {
      const appeal = results[0];
      const robloxName = appeal.roblox_username || appeal.ign || 'Unknown';

      let statusBadge = '⏳ `Pending Review`';
      let statusColor = 0xf1c40f;

      if (appeal.status === 'APPROVED') {
        statusBadge = '✅ `Approved`';
        statusColor = 0x2ecc71;
      } else if (appeal.status === 'REJECTED') {
        statusBadge = '❌ `Rejected`';
        statusColor = 0xe74c3c;
      }

      const embed = new EmbedBuilder()
        .setTitle(`🔍 Player Found: ${robloxName}`)
        .setColor(statusColor)
        .setDescription(
          `Found **1** record matching **${searchLabel}**:`
        )
        .addFields(
          {
            name: '👤 Discord Account',
            value: `<@${appeal.user_id}> (${appeal.user_tag || 'Unknown'})\nID: \`${appeal.user_id}\``,
            inline: true,
          },
          {
            name: '🎮 Roblox Username',
            value: `**${robloxName}**`,
            inline: true,
          },
          {
            name: '📌 Appeal Status',
            value: statusBadge,
            inline: true,
          },
          {
            name: '⚔️ Gear Score',
            value: appeal.gear_score ? `**${appeal.gear_score.toLocaleString('en-US')} GS**` : '*Not recorded*',
            inline: true,
          },
          {
            name: '📋 Appeal Code',
            value: `\`${appeal.appeal_code}\``,
            inline: true,
          },
          {
            name: '📅 Submitted At',
            value: `<t:${Math.floor(appeal.created_at / 1000)}:f> (<t:${Math.floor(appeal.created_at / 1000)}:R>)`,
            inline: true,
          }
        )
        .setFooter({ text: 'Guild Appeal Database • Officer Lookup' })
        .setTimestamp();

      if (appeal.screenshot_url) {
        embed.setThumbnail(appeal.screenshot_url);
        embed.addFields({
          name: '🖼️ Screenshot Proof',
          value: `[View Uploaded Screenshot](${appeal.screenshot_url})`,
          inline: false,
        });
      }

      if (appeal.status === 'APPROVED' || appeal.status === 'REJECTED') {
        embed.addFields({
          name: '🛡️ Reviewed By',
          value: `<@${appeal.reviewed_by}> • <t:${Math.floor(appeal.reviewed_at / 1000)}:R>`,
          inline: true,
        });
      }

      if (appeal.status === 'REJECTED' && appeal.rejection_reason) {
        embed.addFields({
          name: '📝 Rejection Reason',
          value: appeal.rejection_reason,
          inline: false,
        });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // Jika ditemukan beberapa riwayat appeal (lebih dari 1)
    const listEmbed = new EmbedBuilder()
      .setTitle(`🔍 Multiple Records Found (${results.length})`)
      .setColor(0x3498db)
      .setDescription(
        `Found **${results.length}** appeal record(s) matching **${searchLabel}**:\n`
      )
      .setFooter({ text: 'Guild Appeal Database • Officer Lookup' })
      .setTimestamp();

    results.slice(0, 10).forEach((appeal, index) => {
      let statusEmoji = '⏳';
      if (appeal.status === 'APPROVED') statusEmoji = '✅';
      else if (appeal.status === 'REJECTED') statusEmoji = '❌';

      const robloxName = appeal.roblox_username || appeal.ign || '-';
      const gsText = appeal.gear_score ? `${appeal.gear_score.toLocaleString('en-US')} GS` : 'N/A';

      listEmbed.addFields({
        name: `#${index + 1} — ${appeal.appeal_code} (${statusEmoji} ${appeal.status})`,
        value:
          `• **Discord:** <@${appeal.user_id}> (\`${appeal.user_id}\`)\n` +
          `• **Roblox:** **${robloxName}** | **GS:** ${gsText}\n` +
          `• **Date:** <t:${Math.floor(appeal.created_at / 1000)}:d> (<t:${Math.floor(appeal.created_at / 1000)}:R>)` +
          (appeal.screenshot_url ? ` | [Screenshot](${appeal.screenshot_url})` : ''),
        inline: false,
      });
    });

    return interaction.editReply({ embeds: [listEmbed] });
  },
};
