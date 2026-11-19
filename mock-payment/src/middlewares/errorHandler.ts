import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (typeof err === 'object' && err !== null && 'type' in err) {
    if (err.type === 'entity.parse.failed') {
      return new AppError('invalid_json', 'Invalid JSON');
    }
    if (err.type === 'entity.too.large') {
      return new AppError('body_too_large', 'Request body too large');
    }
  }

  return new AppError('internal_error', 'Something went wrong');
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const appErr = toAppError(err);

  if (appErr.status >= 500) {
    logger.error({ err }, 'request failed'); // full detail, log only
  } else {
    logger.warn({ code: appErr.code }, 'request rejected');
  }

  res.status(appErr.status).json({
    error: { code: appErr.code, message: appErr.message },
  });
};
