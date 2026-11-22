const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { config, validateConfig } = require('./config');
const { loadEvents } = require('./handlers/eventHandler');
const { loadCommands } = require('./handlers/commandHandler');
const logger = require('./utils/logger');

// Global process error handlers
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
});

// Initialize Discord Client with minimal required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Command registry collection
client.commands = new Collection();

// Initialize database
require('./database/db');

// Load event and command handlers
loadEvents(client);
loadCommands(client);

// Bootstrap bot login
async function start() {
  try {
    validateConfig();
    await client.login(config.token);
  } catch (error) {
    logger.error('Failed to start Discord bot client:', error);
    process.exitCode = 1;
  }
}

start();

module.exports = { client };
