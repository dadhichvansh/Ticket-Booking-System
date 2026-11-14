import type { Request, Response } from 'express';
import { eventIdParamsSchema, parseOrThrow } from '../utils/validate.js';
import * as eventsService from '../services/events.service.js';

export const listEventsController = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  const events = await eventsService.listEvents();
  res.status(200).json({ events });
};

export const getEventController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { eventId } = parseOrThrow(eventIdParamsSchema, req.params);
  const event = await eventsService.getEvent(eventId);
  res.status(200).json({ event });
};
