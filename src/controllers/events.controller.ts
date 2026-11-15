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

export const getSeatMapController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { eventId } = parseOrThrow(eventIdParamsSchema, req.params);
  const seatMap = await eventsService.getSeatMap(eventId);
  // The browser must not add its own cache on top of ours (05 section 3.5)
  res.set('Cache-Control', 'no-store');
  res.status(200).json(seatMap);
};