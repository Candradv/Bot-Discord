const { Events } = require('discord.js');
const logger = require('../utils/logger');
const {
  handleAppealButton,
  handleAppealModal,
  handleCommunityVoteButton,
  handleStaffReviewButton,
  handleStaffRejectModal,
  handleStaffWarnModal,
} = require('../utils/appealInteractions');

module.exports = {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction, client) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = client.commands ? client.commands.get(interaction.commandName) : null;
        if (!command) {
          logger.warn(`Slash command not found: /${interaction.commandName}`);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: 'This command is currently unavailable.',
              ephemeral: true,
            });
          }
          return;
        }

        await command.execute(interaction, client);
      } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('appeal_btn_vote_')) {
          await handleCommunityVoteButton(interaction);
        } else if (
          interaction.customId.startsWith('appeal_btn_manage_') ||
          interaction.customId.startsWith('appeal_btn_approve_') ||
          interaction.customId.startsWith('appeal_btn_reject_') ||
          interaction.customId.startsWith('appeal_btn_warn_')
        ) {
          await handleStaffReviewButton(interaction);
        } else if (interaction.customId.startsWith('appeal_btn_')) {
          await handleAppealButton(interaction);
        } else {
          logger.info(`Generic button interaction received: ${interaction.customId} by ${interaction.user.tag}`);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: 'Button interaction received.',
              ephemeral: true,
            });
          }
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('appeal_modal_warn_')) {
          await handleStaffWarnModal(interaction);
        } else if (interaction.customId.startsWith('appeal_modal_reject_')) {
          await handleStaffRejectModal(interaction);
        } else if (interaction.customId === 'appeal_modal_form') {
          await handleAppealModal(interaction);
        } else {
          logger.info(`Generic modal submission received: ${interaction.customId} by ${interaction.user.tag}`);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: 'Form submission received.',
              ephemeral: true,
            });
          }
        }
      } else if (interaction.isAnySelectMenu()) {
        if (interaction.customId.startsWith('appeal_select_status_')) {
          await handleStaffReviewButton(interaction);
        } else {
          logger.info(`Select menu interaction received: ${interaction.customId} by ${interaction.user.tag}`);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.deferUpdate();
          }
        }
      }
    } catch (error) {
      // 10062: Unknown interaction (expired past Discord's 3-second window)
      // 40060: Interaction has already been acknowledged
      if (error.code === 10062) {
        logger.warn(`Interaction '${interaction.id}' expired before response could be delivered.`);
        return;
      }
      if (error.code === 40060) {
        logger.warn(`Interaction '${interaction.id}' was already acknowledged.`);
        return;
      }

      logger.error(`Error processing interaction '${interaction.id}':`, error);

      // Respond safely to user without double-acknowledging
      try {
        const errorPayload = {
          content: 'There was an error while executing this action.',
          ephemeral: true,
        };

        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply(errorPayload);
        } else if (!interaction.replied) {
          await interaction.reply(errorPayload);
        }
      } catch (replyError) {
        if (replyError.code !== 10062 && replyError.code !== 40060) {
          logger.error('Failed to notify user of interaction failure:', replyError);
        }
      }
    }
  },
};
