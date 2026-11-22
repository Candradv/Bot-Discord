const { Events } = require('discord.js');
const db = require('../database/db');
const logger = require('../utils/logger');
const {
  buildStaffEmbed,
  buildAppealActionRows,
} = require('../utils/appealInteractions');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (!message.guildId && !message.author.bot) {
      const appeal = db.getActiveAppealByUser(message.author.id);
      if (!appeal) return;

      const imageAttachment = message.attachments.find((attachment) =>
        (attachment.contentType && attachment.contentType.startsWith('image/')) ||
        /\.(png|jpe?g|webp|gif)$/i.test(attachment.url)
      );

      if (!imageAttachment) {
        await message.reply(
          'Please send a clear screenshot/image of your Gear Score for staff verification.'
        );
        return;
      }

      const updatedAppeal = db.updateAppealScreenshot(appeal.id, imageAttachment.url);
      if (!updatedAppeal.channel_id || !updatedAppeal.message_id) return;

      try {
        const channel = await client.channels.fetch(updatedAppeal.channel_id);
        const staffMessage = await channel.messages.fetch(updatedAppeal.message_id);
        const voteCounts = db.getVoteCounts(updatedAppeal.id);
        await staffMessage.edit({
          embeds: [buildStaffEmbed(updatedAppeal, voteCounts)],
          components: buildAppealActionRows(updatedAppeal.id, voteCounts, false),
        });

        await message.reply(
          `✅ Your Gear Score screenshot was received for **${updatedAppeal.appeal_code}** and sent to staff for verification.`
        );
        logger.info(`Gear Score screenshot received for appeal ${updatedAppeal.appeal_code} from user ${message.author.id}`);
      } catch (error) {
        logger.warn(`Could not attach Gear Score screenshot to appeal ${updatedAppeal.appeal_code}: ${error.message}`);
      }
    }
  },
};
