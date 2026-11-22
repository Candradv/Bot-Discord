const { EmbedBuilder } = require('discord.js');
const { config } = require('../config');
const logger = require('./logger');

/**
 * Mengirim log audit aktivitas appeal ke APPEAL_LOG_CHANNEL_ID
 */
async function sendAppealLog(client, { title, description, color = 0x3498db, fields = [] }) {
  const logChannelId = config.appealLogChannelId;
  if (!logChannelId || logChannelId.trim() === '') return;

  try {
    const channel = await client.channels.fetch(logChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(`📋 [LOG] ${title}`)
      .setColor(color)
      .setTimestamp();

    if (description) {
      embed.setDescription(description);
    }

    if (fields && fields.length > 0) {
      embed.addFields(fields);
    }

    await channel.send({ embeds: [embed] });
  } catch (error) {
    logger.warn(`Gagal mengirim log ke APPEAL_LOG_CHANNEL_ID (${logChannelId}): ${error.message}`);
  }
}

module.exports = {
  sendAppealLog,
};
