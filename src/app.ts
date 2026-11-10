import express from 'express';
import { correlationId } from './middleware/correlationId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.routes.js';

export const app = express();

app.disable('x-powered-by');
app.use(correlationId);
app.use(requestLogger);
app.use('/health', healthRouter);
app.use(express.json({ limit: '10kb' }));

app.use(notFound);
app.use(errorHandler); // always last
