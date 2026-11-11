import argon2 from 'argon2';
import { query } from '../db.js';
import { AppError } from '../errors.js';
import type { Credentials } from '../utils/validate.js';

type UserRow = { id: string; email: string };

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
