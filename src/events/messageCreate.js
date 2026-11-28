const { Events } = require('discord.js');
const db = require('../database/db');
const logger = require('../utils/logger');
const { config } = require('../config');
const {
  buildStaffEmbed,
  buildAppealActionRows,
} = require('../utils/appealInteractions');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (!message.guildId && !message.author.bot) {
      const appeal = db.getActiveAppealByUser(message.author.id);
      if (!appeal) {
        logger.warn(`Gear Score DM received from user ${message.author.id}, but no active appeal was found.`);
        await message.reply(
          'I could not find an active appeal for your account. Please submit a Guild Join Appeal first.'
        ).catch(() => {});
        return;
      }

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

      try {
        const staffChannelId =
          config.guildAppealChannelId ||
          config.staffChannelId ||
          updatedAppeal.channel_id;
        const channel = await client.channels.fetch(staffChannelId);
        const voteCounts = db.getVoteCounts(updatedAppeal.id);
        if (updatedAppeal.channel_id && updatedAppeal.message_id) {
          const staffMessage = await channel.messages.fetch(updatedAppeal.message_id);
          await staffMessage.edit({
            embeds: [buildStaffEmbed(updatedAppeal, voteCounts)],
            components: buildAppealActionRows(updatedAppeal.id, voteCounts, false),
          });
        }

        await message.reply(
          `✅ Your Gear Score screenshot was received and attached directly to your appeal (**${updatedAppeal.appeal_code}**).`
        );
        logger.info(`Gear Score screenshot updated in appeal ${updatedAppeal.appeal_code} from user ${message.author.id}`);
      } catch (error) {
        logger.warn(`Could not attach Gear Score screenshot to appeal ${updatedAppeal.appeal_code}: ${error.message}`);
      }
    }
  },
};
