require('dotenv').config();

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  ownerRoleId: process.env.OWNER_ROLE_ID,
  staffRoleId: process.env.STAFF_ROLE_ID,
  // Channel IDs (Format Revisi)
  joinAppealChannelId: process.env.JOIN_APPEAL_CHANNEL_ID || process.env.APPEAL_CHANNEL_ID,
  guildAppealChannelId: process.env.GUILD_APPEAL_CHANNEL_ID || process.env.STAFF_CHANNEL_ID,
  appealLogChannelId: process.env.APPEAL_LOG_CHANNEL_ID,
  // Backwards compatibility aliases
  appealChannelId: process.env.JOIN_APPEAL_CHANNEL_ID || process.env.APPEAL_CHANNEL_ID,
  staffChannelId: process.env.GUILD_APPEAL_CHANNEL_ID || process.env.STAFF_CHANNEL_ID,
};

function validateConfig({
  requireClientId = false,
  requireGuildId = false,
  requireOwnerRoleId = false,
  requireJoinAppealChannelId = false,
  requireGuildAppealChannelId = false,
  requireAppealLogChannelId = false,
} = {}) {
  const missing = [];

  if (!config.token || config.token.trim() === '') {
    missing.push('DISCORD_TOKEN');
  }
  if (requireClientId && (!config.clientId || config.clientId.trim() === '')) {
    missing.push('CLIENT_ID');
  }
  if (requireGuildId && (!config.guildId || config.guildId.trim() === '')) {
    missing.push('GUILD_ID');
  }
  if (requireOwnerRoleId && (!config.ownerRoleId || config.ownerRoleId.trim() === '')) {
    missing.push('OWNER_ROLE_ID');
  }
  if (requireJoinAppealChannelId && (!config.joinAppealChannelId || config.joinAppealChannelId.trim() === '')) {
    missing.push('JOIN_APPEAL_CHANNEL_ID');
  }
  if (requireGuildAppealChannelId && (!config.guildAppealChannelId || config.guildAppealChannelId.trim() === '')) {
    missing.push('GUILD_APPEAL_CHANNEL_ID');
  }
  if (requireAppealLogChannelId && (!config.appealLogChannelId || config.appealLogChannelId.trim() === '')) {
    missing.push('APPEAL_LOG_CHANNEL_ID');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s) in .env: ${missing.join(', ')}`);
  }

  return true;
}

module.exports = {
  config,
  validateConfig,
};
