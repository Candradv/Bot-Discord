const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with bot status and latency check.'),
  async execute(interaction) {
    const sent = await interaction.reply({
      content: 'Pinging...',
      fetchReply: true,
      ephemeral: true,
    });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply({
      content: `Pong! Latency: ${latency}ms.`,
    });
  },
};
