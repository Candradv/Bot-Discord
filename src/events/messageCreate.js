const { Events } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
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

        const proofEmbed = new EmbedBuilder()
          .setTitle(`📸 Gear Score Proof — ${updatedAppeal.appeal_code}`)
          .setDescription(
            `Applicant: <@${updatedAppeal.user_id}>\n` +
            `Submitted Gear Score: **${updatedAppeal.gear_score?.toLocaleString('en-US') || 'Not provided'} GS**`
          )
          .setImage(imageAttachment.url)
          .setColor(0xf1c40f)
          .setFooter({ text: `Appeal ID: ${updatedAppeal.appeal_code}` })
          .setTimestamp();

        await channel.send({
          content:
            `⚔️ Gear Score screenshot received for <@${updatedAppeal.user_id}>.\n` +
            `Appeal: **${updatedAppeal.appeal_code}**`,
          embeds: [proofEmbed],
          files: [{
            attachment: imageAttachment.url,
            name: `gear-score-${updatedAppeal.appeal_code.replace(/[^a-z0-9]/gi, '-')}.png`,
          }],
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
