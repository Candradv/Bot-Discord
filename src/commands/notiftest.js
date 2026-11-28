const { SlashCommandBuilder } = require('discord.js');
const { config } = require('../config');
const { isStaff } = require('../utils/appealInteractions');
const { RAIDS, sendRaidNotification } = require('../utils/raidScheduler');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notiftest')
    .setDescription('Send a test Boss Raid reminder notification (Staff/Owner only)')
    .addIntegerOption((option) =>
      option
        .setName('minutes')
        .setDescription('Select the reminder time window')
        .setRequired(false)
        .addChoices(
          { name: '10 Minutes Before', value: 10 },
          { name: '5 Minutes Before', value: 5 },
          { name: '1 Minute Before', value: 1 },
          { name: '0 Minutes (Raid Started)', value: 0 },
        )
    )
    .addStringOption((option) =>
      option
        .setName('raid')
        .setDescription('Select which raid schedule to test')
        .setRequired(false)
        .addChoices(
          { name: '🌅 Morning Raid (06:30)', value: 'morning' },
          { name: '☀️ Afternoon Raid (12:30)', value: 'afternoon' },
          { name: '🌆 Evening Raid (18:30)', value: 'evening' },
          { name: '🌙 Night Raid (19:30)', value: 'night' },
        )
    ),

  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'This command can only be used inside a Discord server.',
        ephemeral: true,
      });
    }

    // Only Staff/Owner can run the test command
    if (!isStaff(interaction.member, interaction.guild)) {
      return interaction.reply({
        content: '⛔ You do not have permission to run this test command.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const minutesBefore = interaction.options.getInteger('minutes') ?? 10;
    const raidId = interaction.options.getString('raid') || 'morning';
    const selectedRaid = RAIDS.find((r) => r.id === raidId) || RAIDS[0];

    // Create target simulation timestamp
    const targetUnix = Math.floor(Date.now() / 1000) + minutesBefore * 60;

    const success = await sendRaidNotification(client, {
      raid: selectedRaid,
      targetUnix,
      minutesBefore,
      isTest: true,
    });

    if (success) {
      return interaction.editReply({
        content: `✅ **Test notification successfully sent!**\n\n• **Raid:** ${selectedRaid.icon} ${selectedRaid.name}\n• **Category:** ${minutesBefore === 0 ? 'Raid Starting Now' : `${minutesBefore} Minutes Before`}\n• **Target Channel:** <#${config.raidReminderChannelId}>\n• **Role Tag:** <@&${config.raidReminderRoleId}>`,
      });
    } else {
      return interaction.editReply({
        content: `❌ Failed to send test notification. Please verify that the bot has permission to send messages in <#${config.raidReminderChannelId}>.`,
      });
    }
  },
};
