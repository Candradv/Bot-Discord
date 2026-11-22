const { SlashCommandBuilder } = require('discord.js');
const { isOwnerOrAdmin } = require('../utils/appealInteractions');
const db = require('../database/db');
const { sendAppealLog } = require('../utils/appealLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('appeal-unblock')
    .setDescription('Remove a member’s permanent block from submitting appeals')
    .addUserOption((option) =>
      option.setName('member').setDescription('Member to unblock from appeals').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for removing the appeal block')
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

    if (!db.unblockAppealUser(member.id, interaction.user.id, reason)) {
      return interaction.editReply({
        content: `ℹ️ **${member.tag}** does not have an active appeal block.`,
      });
    }

    await sendAppealLog(client, {
      title: '✅ Member Unblocked from Appeals',
      color: 0x2ecc71,
      fields: [
        { name: '👤 Member', value: `<@${member.id}> (${member.tag})`, inline: true },
        { name: '🛡️ Unblocked By', value: `<@${interaction.user.id}>`, inline: true },
        { name: '📝 Reason', value: reason, inline: false },
      ],
    });

    return interaction.editReply({
      content: `✅ **${member.tag}** can submit appeals again.`,
    });
  },
};
