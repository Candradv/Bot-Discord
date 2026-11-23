const { SlashCommandBuilder } = require('discord.js');
const { isStaff, sendWarningDm } = require('../utils/appealInteractions');
const { sendAppealLog } = require('../utils/appealLogger');

const REQUIREMENTS = [
  { name: 'Weekly Guild XP (minimum 5,000/week)', value: 'Weekly Guild XP' },
  { name: 'Daily Donation', value: 'Daily Donation' },
  { name: 'Guild Raid', value: 'Guild Raid' },
  { name: 'Boss Raid Schedule', value: 'Boss Raid Schedule' },
  { name: 'Minimum GS (6,000+)', value: 'Minimum GS Requirement' },
  { name: 'Activity (maximum 3 days offline)', value: 'Activity Requirement' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('guild-warning')
    .setDescription('Send a guild requirement warning to a member')
    .addUserOption((option) =>
      option.setName('member').setDescription('Member to warn').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('requirement')
        .setDescription('Guild requirement that needs attention')
        .setRequired(true)
        .addChoices(...REQUIREMENTS),
    )
    .addStringOption((option) =>
      option
        .setName('catatan')
        .setDescription('Additional staff note (optional)')
        .setMaxLength(700)
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName('kirim_dm')
        .setDescription('Send the warning to the member by DM (default: yes)')
        .setRequired(false),
    ),

  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'Perintah ini hanya dapat digunakan di dalam server Discord.',
        ephemeral: true,
      });
    }

    if (!isStaff(interaction.member, interaction.guild)) {
      return interaction.reply({
        content: '⛔ Hanya staff, owner, atau administrator yang dapat mengirim warning.',
        ephemeral: true,
      });
    }

    const member = interaction.options.getUser('member');
    const requirement = interaction.options.getString('requirement');
    const note = interaction.options.getString('catatan')?.trim();
    const dmOption = interaction.options.getBoolean('kirim_dm');
    const shouldSendDm = dmOption === null ? true : dmOption;

    if (!interaction.options.getMember('member')) {
      return interaction.reply({
        content: 'Select a member who is currently in this server.',
        ephemeral: true,
      });
    }

    if (member.bot) {
      return interaction.reply({
        content: 'Select a member account, not a bot.',
        ephemeral: true,
      });
    }

    const warningMessage =
      `**Requirement:** ${requirement}\n\n` +
      'Please improve your progress and meet this guild requirement as soon as possible. ' +
      'Contact guild staff if you need help.\n\n' +
      'Continued non-compliance may result in a guild kick. The bot does not kick members automatically.' +
      (note ? `\n\n**Staff note:** ${note}` : '');

    await interaction.deferReply({ ephemeral: true });

    const dmSent = shouldSendDm
      ? await sendWarningDm(client, member.id, warningMessage, interaction.user.tag)
      : false;
    const dmStatus = !shouldSendDm
      ? '⏭️ Skipped'
      : dmSent
        ? '✅ Sent'
        : '❌ Failed (DMs closed)';
    await sendAppealLog(client, {
      title: '📄 Guild Warning',
      color: 0xe67e22,
      fields: [
        { name: '👤 Member', value: `<@${member.id}> (${member.tag})`, inline: true },
        { name: '📋 Requirement', value: requirement, inline: true },
        { name: '🛡️ Sent By', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: false },
        { name: '📩 DM Status', value: dmStatus, inline: false },
      ],
    });

    return interaction.editReply({
      content: !shouldSendDm
        ? `✅ Warning for **${member.tag}** was recorded. DM was skipped.`
        : dmSent
          ? `✅ Warning for **${member.tag}** was sent via DM.`
          : `⚠️ Warning was recorded, but the DM to **${member.tag}** failed (DMs may be closed).`,
    });
  },
};
