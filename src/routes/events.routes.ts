import { Router } from 'express';
import {
  getEventController,
  listEventsController,
} from '../controllers/events.controller.js';

const eventsRouter = Router();

eventsRouter.get('/', listEventsController);
eventsRouter.get('/:eventId', getEventController);

export { eventsRouter };
