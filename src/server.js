import { createApp } from './app.js';
import { config } from './config.js';
import { getDb } from './db.js';

getDb();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`Consumable API listening on http://${config.host}:${config.port}`);
  console.log(`Public API base URL: ${config.publicApiBaseUrl}`);
  console.log(`API prefix: /api/v1`);
});

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));