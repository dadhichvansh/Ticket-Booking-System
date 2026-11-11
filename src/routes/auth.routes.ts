import { Router } from 'express';
import { credentialsSchema, parseOrThrow } from '../utils/validate.js';
import * as authService from '../services/auth.service.js';

export const authRouter = Router();

authRouter.post('/signup', async (req, res) => {
  const creds = parseOrThrow(credentialsSchema, req.body);
  const user = await authService.signup(creds);
  res.status(201).json({ user });
});
