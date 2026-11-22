function sanitize(message) {
  if (typeof message !== 'string') return message;
  const token = process.env.DISCORD_TOKEN;
  if (token && token.length > 5) {
    return message.split(token).join('[REDACTED_TOKEN]');
  }
  return message;
}

const logger = {
  info: (msg, ...args) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${sanitize(typeof msg === 'string' ? msg : JSON.stringify(msg))}`, ...args);
  },
  warn: (msg, ...args) => {
    console.warn(`[WARN] ${new Date().toISOString()} - ${sanitize(typeof msg === 'string' ? msg : JSON.stringify(msg))}`, ...args);
  },
  error: (msg, error) => {
    const formattedMsg = sanitize(typeof msg === 'string' ? msg : JSON.stringify(msg));
    if (error instanceof Error) {
      const formattedStack = sanitize(error.stack || error.message);
      console.error(`[ERROR] ${new Date().toISOString()} - ${formattedMsg}\n${formattedStack}`);
    } else if (error) {
      console.error(`[ERROR] ${new Date().toISOString()} - ${formattedMsg}`, sanitize(String(error)));
    } else {
      console.error(`[ERROR] ${new Date().toISOString()} - ${formattedMsg}`);
    }
  },
};

module.exports = logger;
