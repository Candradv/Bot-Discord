const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const loadedEvents = new Set();

function loadEvents(client) {
  const eventsPath = path.join(__dirname, '..', 'events');
  if (!fs.existsSync(eventsPath)) {
    logger.warn(`Events directory not found: ${eventsPath}`);
    return;
  }

  const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));
  let count = 0;

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);

    // Prevent duplicate event registrations
    if (loadedEvents.has(filePath)) {
      continue;
    }

    try {
      const event = require(filePath);

      if (!event.name || typeof event.execute !== 'function') {
        logger.warn(`Skipping event '${file}': Missing 'name' or 'execute' function.`);
        continue;
      }

      const executeWrapper = async (...args) => {
        try {
          await event.execute(...args, client);
        } catch (error) {
          logger.error(`Error occurred while executing event '${event.name}' (${file}):`, error);
        }
      };

      if (event.once) {
        client.once(event.name, executeWrapper);
      } else {
        client.on(event.name, executeWrapper);
      }

      loadedEvents.add(filePath);
      count++;
    } catch (err) {
      logger.error(`Failed to load event file '${file}':`, err);
    }
  }

  logger.info(`Loaded ${count} event(s) successfully.`);
}

module.exports = { loadEvents };
