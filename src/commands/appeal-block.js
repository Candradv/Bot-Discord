const { SlashCommandBuilder } = require('discord.js');
const { isOwnerOrAdmin } = require('../utils/appealInteractions');
const db = require('../database/db');
const { sendAppealLog } = require('../utils/appealLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('appeal-block')
    .setDescription('Permanently block a member from submitting appeals')
    .addUserOption((option) =>
      option.setName('member').setDescription('Member to block from appeals').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for the appeal block')
        .setMinLength(5)
        .setMaxLength(500)
        .setRequired(true),
    ),

  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
    }

    if (!isOwnerOrAdmin(interaction.member, interaction.guild)) {
      return interaction.reply({
        content: 'Only the server owner, an Owner role member, or an administrator can manage permanent appeal blocks.',
        ephemeral: true,
      });
    }

    const member = interaction.options.getUser('member');
    const guildMember = interaction.options.getMember('member');
    const reason = interaction.options.getString('reason').trim();

    if (!guildMember || member.bot) {
      return interaction.reply({
        content: 'Select a non-bot member who is currently in this server.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const result = db.blockAppealUser(member.id, reason, interaction.user.id);
    if (!result.success) {
      return interaction.editReply({
        content: `⚠️ **${member.tag}** is already blocked from submitting appeals.`,
      });
    }

    await sendAppealLog(client, {
      title: '⛔ Member Blocked from Appeals',
      color: 0xe74c3c,
      fields: [
        { name: '👤 Member', value: `<@${member.id}> (${member.tag})`, inline: true },
        { name: '🛡️ Blocked By', value: `<@${interaction.user.id}>`, inline: true },
        { name: '📝 Reason', value: reason, inline: false },
      ],
    });

    return interaction.editReply({
      content: `⛔ **${member.tag}** is now permanently blocked from submitting appeals. This does not kick or ban them from the server.`,
    });
  },
};
