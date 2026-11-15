import { Router } from 'express';
import {
  getEventController,
  getSeatMapController,
  listEventsController,
} from '../controllers/events.controller.js';

const eventsRouter = Router();

eventsRouter.get('/', listEventsController);
eventsRouter.get('/:eventId', getEventController);
eventsRouter.get('/:eventId/seats', getSeatMapController);

export { eventsRouter };
