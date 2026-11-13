import type { Request, Response } from 'express';
import { credentialsSchema, parseOrThrow } from '../utils/validate.js';
import * as authService from '../services/auth.service.js';

export const signupController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const creds = parseOrThrow(credentialsSchema, req.body);
  const user = await authService.signup(creds);
  res.status(201).json({ user });
};

export const loginController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const creds = parseOrThrow(credentialsSchema, req.body);
  const result = await authService.login(creds);
  res.status(200).json(result);
};
