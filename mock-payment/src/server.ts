import { app } from './app.js';
import { config } from './config.js';
import { closeDb } from './db.js';
import { logger } from './logger.js';

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'mock payment service listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');

  setTimeout(() => {
    logger.error('forced shutdown');
    process.exit(1);
  }, 10_000).unref();

  server.close(() => {
    try {
      closeDb();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error while closing database');
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught exception');
  process.exit(1);
});
