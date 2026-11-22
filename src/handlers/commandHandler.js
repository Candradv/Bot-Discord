const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

function loadCommands(client) {
  const commandsPath = path.join(__dirname, '..', 'commands');
  if (!fs.existsSync(commandsPath)) {
    return;
  }

  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
  let count = 0;

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    try {
      const command = require(filePath);

      if (!command.data || !command.data.name || typeof command.execute !== 'function') {
        logger.warn(`Skipping command '${file}': Missing 'data.name' or 'execute' function.`);
        continue;
      }

      client.commands.set(command.data.name, command);
      count++;
    } catch (err) {
      logger.error(`Failed to load command file '${file}':`, err);
    }
  }

  if (count > 0) {
    logger.info(`Loaded ${count} command(s) successfully.`);
  }
}

module.exports = { loadCommands };
