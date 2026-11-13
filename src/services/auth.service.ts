import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { AppError } from '../errors.js';
import type { Credentials } from '../utils/validate.js';

type UserRow = {
  id: string;
  email: string;
};

type UserWithHash = UserRow & {
  password_hash: string;
};

// A real argon2 hash of a throwaway password. When the email does not exist,
// we still verify against this, so the response time looks the same.
const DUMMY_HASH = await argon2.hash('dummy-password-for-timing-only');

export async function signup({
  email,
  password,
}: Credentials): Promise<UserRow> {
  const passwordHash = await argon2.hash(password); // argon2id by default (D-12)

  try {
    const rows = await query<UserRow>(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, passwordHash],
    );
    const user = rows[0];
    if (!user) throw new Error('insert returned no row');
    return user;
  } catch (err) {
    // 23505 = unique violation. On `users` the only unique column besides id is email.
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      err.code === '23505'
    ) {
      throw new AppError('email_taken', 'Email already registered');
    }
    throw err;
  }
}

export async function login({
  email,
  password,
}: {
  email: string;
  password: string;
}): Promise<{
  token: string;
  expiresInSeconds: number;
  user: UserRow;
}> {
  const rows = await query<UserWithHash>(
    'SELECT id, email, password_hash FROM users WHERE email = $1',
    [email],
  );
  const user = rows[0];

  const passwordOk = await argon2.verify(
    user ? user.password_hash : DUMMY_HASH,
    password,
  );

  if (!user || !passwordOk) {
    throw new AppError('invalid_credentials', 'Invalid email or password');
  }

  const token = jwt.sign({}, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: user.id,
    expiresIn: config.JWT_EXPIRES_IN_SECONDS,
  });

  return {
    token,
    expiresInSeconds: config.JWT_EXPIRES_IN_SECONDS,
    user: {
      id: user.id,
      email: user.email,
    },
  };
}

export function verifyToken(token: string): { id: string } {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'],
    });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      throw new AppError('unauthorized', 'Invalid token');
    }
    return { id: payload.sub };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError('token_expired', 'Token has expired');
    }
    throw new AppError('unauthorized', 'Invalid token');
  }
}
