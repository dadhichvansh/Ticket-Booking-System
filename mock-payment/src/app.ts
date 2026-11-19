import express from 'express';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFound } from './middlewares/notFound.js';
import { healthRouter } from './routes/health.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { chargesRouter } from './routes/charges.routes.js';

export const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

app.use('/health', healthRouter);
app.use('/admin', adminRouter);
app.use('/charges', chargesRouter);

app.use(notFound);
app.use(errorHandler);
