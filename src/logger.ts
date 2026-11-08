import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { config } from './config.js';

export const requestContext = new AsyncLocalStorage<{
  correlationId: string;
}>();

export const logger = pino({
  level: config.LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: [
    'req.headers.authorization', // Remove Authorization header from logs
    'password', // Remove password from logs
    '*.password', // Remove any nested password fields from logs
  ],
  mixin() {
    const store = requestContext.getStore();
    return store ? { correlationId: store.correlationId } : {};
  },
});
