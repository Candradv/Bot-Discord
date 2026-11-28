const { Events, PermissionFlagsBits } = require('discord.js');
const { config } = require('../config');
const { startRaidScheduler } = require('../utils/raidScheduler');
const logger = require('../utils/logger');

/**
 * Validasi apakah bot memiliki izin yang diperlukan di suatu channel
 */
async function validateChannel(client, channelId, label) {
  if (!channelId || channelId.trim() === '') {
    logger.error(`[CONFIG ERROR] ${label} belum diatur di .env! Tambahkan channel ID yang valid.`);
    return false;
  }

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch {
    logger.error(`[CONFIG ERROR] ${label} (${channelId}) tidak ditemukan atau bot tidak dapat mengaksesnya.`);
    return false;
  }

  if (!channel || !channel.isTextBased()) {
    logger.error(`[CONFIG ERROR] ${label} (${channelId}) bukan channel teks yang valid.`);
    return false;
  }

  const me = channel.guild?.members?.me;
  if (me) {
    const perms = channel.permissionsFor(me);
    const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    const missing = required.filter((p) => !perms?.has(p));
    if (missing.length > 0) {
      const names = { [PermissionFlagsBits.ViewChannel]: 'View Channel', [PermissionFlagsBits.SendMessages]: 'Send Messages', [PermissionFlagsBits.EmbedLinks]: 'Embed Links' };
      logger.error(`[CONFIG ERROR] Bot kekurangan izin di ${label} (${channelId}): ${missing.map((p) => names[p]).join(', ')}`);
      return false;
    }
  }

  logger.info(`[CONFIG OK] ${label} → #${channel.name} (${channelId})`);
  return true;
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`Client ready! Logged in as ${client.user.tag} (${client.user.id})`);

    // Validasi semua channel yang diperlukan
    logger.info('Memvalidasi konfigurasi channel...');
    await validateChannel(client, config.joinAppealChannelId, 'JOIN_APPEAL_CHANNEL_ID');
    await validateChannel(client, config.guildAppealChannelId, 'GUILD_APPEAL_CHANNEL_ID');
    await validateChannel(client, config.appealLogChannelId, 'APPEAL_LOG_CHANNEL_ID');
    if (config.raidReminderChannelId) {
      await validateChannel(client, config.raidReminderChannelId, 'RAID_REMINDER_CHANNEL_ID');
    }

    // Aktifkan Background Scheduler Notifikasi Raid Otomatis
    startRaidScheduler(client);
  },
};
