const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { config, validateConfig } = require('./config');
const logger = require('./utils/logger');

async function deployCommands() {
  try {
    // Validate that DISCORD_TOKEN, CLIENT_ID, and GUILD_ID exist
    validateConfig({ requireClientId: true, requireGuildId: true });

    const commands = [];
    const commandsPath = path.join(__dirname, 'commands');

    if (fs.existsSync(commandsPath)) {
      const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

      for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if (command.data && typeof command.data.toJSON === 'function') {
          commands.push(command.data.toJSON());
        } else {
          logger.warn(`Skipping '${file}': Missing 'data' SlashCommandBuilder with toJSON() method.`);
        }
      }
    }

    const rest = new REST({ version: '10' }).setToken(config.token);

    logger.info(`Deploying ${commands.length} application command(s) to guild: ${config.guildId}...`);

    const data = await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands },
    );

    logger.info(`Successfully registered ${data.length} application (/) command(s) in guild: ${config.guildId}`);
  } catch (error) {
    logger.error('Failed to deploy application commands:', error);
    process.exitCode = 1;
  }
}

deployCommands();
